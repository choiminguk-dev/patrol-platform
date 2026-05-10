import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { execute, queryMany } from "@/lib/db";
import { CATEGORY_MAP, POOL_DEFAULTS } from "@/lib/categories";
import { reverseGeocode } from "@/lib/geocode";

interface BatchEntry {
  category: string;
  photoUrls: string[];
  memo?: string;
  addressText?: string;
  addressTextAi?: string | null; // AI 첫 제안 (정정 학습용)
  latitude?: number;
  longitude?: number;
  originalPhotoTime?: string;
  zoneId?: string | null;
}

interface BatchRequest {
  entryDate: string; // YYYY-MM-DD
  entries: BatchEntry[];
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "인증 필요" }, { status: 401 });
  }

  const body: BatchRequest = await request.json();

  if (!body.entryDate || !body.entries?.length) {
    return NextResponse.json({ error: "날짜와 입력 데이터가 필요합니다" }, { status: 400 });
  }

  const batchId = crypto.randomUUID();
  const values: unknown[] = [];
  const placeholders: string[] = [];
  let paramIdx = 1;

  for (let entryIdx = 0; entryIdx < body.entries.length; entryIdx++) {
    const entry = body.entries[entryIdx];
    const cat = CATEGORY_MAP[entry.category];
    if (!cat) continue;

    // GPS → 주소 역지오코딩 (사용자/AI 주소 없을 때만)
    let geocodedAddress: string | null = null;
    if (!entry.addressText && entry.latitude != null && entry.longitude != null) {
      geocodedAddress = await reverseGeocode(entry.latitude, entry.longitude);
    }

    const quantity = Math.max(1, Math.ceil(entry.photoUrls.length / 5));
    const id = crypto.randomUUID();

    placeholders.push(
      `($${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++},
        $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++},
        $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++},
        $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++})`
    );

    // createdAt: 사진 EXIF 촬영시각 우선, 없으면 09:00 + 항목 순서 폴백
    // → 일자별 목록의 시간 표시 = 실제 촬영 시간
    let createdAtStr: string | null = null;
    if (entry.originalPhotoTime) {
      const d = new Date(entry.originalPhotoTime);
      if (!isNaN(d.getTime())) createdAtStr = d.toISOString();
    }
    if (!createdAtStr) {
      const baseHour = 9;
      const minuteOffset = entryIdx;
      createdAtStr = `${body.entryDate}T${String(baseHour).padStart(2, "0")}:${String(minuteOffset % 60).padStart(2, "0")}:00.000Z`;
    }

    values.push(
      id,
      user.id,
      entry.category,
      cat.eval,
      cat.points,
      entry.latitude ?? null,
      entry.longitude ?? null,
      entry.addressText ?? null,
      geocodedAddress,
      entry.memo ?? null,
      quantity,
      cat.unit,
      entry.photoUrls,
      entry.photoUrls.length,
      batchId,
      entry.originalPhotoTime ?? null,
      body.entryDate,
      entry.zoneId ?? null,
      createdAtStr
    );
  }

  if (!placeholders.length) {
    return NextResponse.json({ error: "유효한 카테고리가 없습니다" }, { status: 400 });
  }

  const sql = `
    INSERT INTO patrol_entries
      (id, "userId", category, "evalItem", "evalPoints",
       latitude, longitude, "addressText", address, memo, quantity,
       unit, "photoUrls", "photoCount", "batchId", "originalPhotoTime",
       "entryDate", "zoneId", "createdAt")
    VALUES ${placeholders.join(", ")}
  `;

  await execute(sql, values);

  // Phase C 학습: zone별 사진을 referencePhotoUrls에 누적 (최근 20장 유지)
  const zoneToUrls = new Map<string, string[]>();
  for (const entry of body.entries) {
    if (entry.zoneId && entry.photoUrls?.length) {
      if (!zoneToUrls.has(entry.zoneId)) zoneToUrls.set(entry.zoneId, []);
      zoneToUrls.get(entry.zoneId)!.push(...entry.photoUrls);
    }
  }
  for (const [zoneId, urls] of zoneToUrls) {
    try {
      const cur = await queryMany<{ referencePhotoUrls: string[] }>(
        `SELECT "referencePhotoUrls" FROM patrol_zones WHERE id = $1`,
        [zoneId]
      );
      const existing = cur[0]?.referencePhotoUrls || [];
      const combined = [...existing, ...urls];
      const trimmed = combined.slice(-20); // 최근 20장만 유지
      await execute(
        `UPDATE patrol_zones SET "referencePhotoUrls" = $1, "updatedAt" = NOW() WHERE id = $2`,
        [trimmed, zoneId]
      );
    } catch { /* zone 학습 실패 — entry 생성은 성공 */ }
  }

  // 자체 학습 zone 발견용: 카테고리별 주소 빈도 누적
  // (이면도로 청소 등 ground truth 없는 카테고리에서 자동 zone 발견)
  for (const entry of body.entries) {
    if (!entry.addressText || !entry.category) continue;
    if (entry.zoneId) continue; // 이미 zone에 매칭된 건 제외 (이중 카운트 방지)
    const normalized = entry.addressText.replace(/\s/g, "");
    if (!normalized) continue;
    try {
      await execute(
        `INSERT INTO category_address_stats
          (id, "tenantId", category, "normalizedAddress", "displayAddress", frequency)
         VALUES ($1, 'huam', $2, $3, $4, 1)
         ON CONFLICT ("tenantId", category, "normalizedAddress")
         DO UPDATE SET frequency = category_address_stats.frequency + 1, "lastSeenAt" = NOW()`,
        [crypto.randomUUID(), entry.category, normalized, entry.addressText]
      );
    } catch { /* 통계 실패 무시 */ }
  }

  // 주소 정정 학습: AI 첫 제안 ≠ 사용자 최종 주소 → 정정 패턴 누적
  for (const entry of body.entries) {
    const ai = (entry.addressTextAi || "").trim();
    const final = (entry.addressText || "").trim();
    if (!ai || !final || ai === final) continue;
    try {
      await execute(
        `INSERT INTO address_corrections
          (id, "tenantId", "originalAddress", "correctedAddress", frequency)
         VALUES ($1, 'huam', $2, $3, 1)
         ON CONFLICT ("tenantId", "originalAddress", "correctedAddress")
         DO UPDATE SET frequency = address_corrections.frequency + 1, "lastSeenAt" = NOW()`,
        [crypto.randomUUID(), ai, final]
      );
    } catch { /* 정정 학습 실패 무시 */ }
  }

  // 삽입된 레코드 조회
  const inserted = await queryMany(
    `SELECT id, category, "photoCount", quantity FROM patrol_entries WHERE "batchId" = $1`,
    [batchId]
  );

  return NextResponse.json({
    batchId,
    count: inserted.length,
    entries: inserted,
  });
}
