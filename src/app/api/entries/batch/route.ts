import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { execute, queryMany } from "@/lib/db";
import { CATEGORY_MAP, POOL_DEFAULTS } from "@/lib/categories";
import { reverseGeocode } from "@/lib/geocode";

/**
 * Node=KST + Postgres=UTC + 컬럼 TIMESTAMP WITHOUT TZ 조합에서
 * 클라이언트가 UTC ISO 송신 → DB 에 Z 무시되어 wall clock 시프트 발생 (9:13 → 00:13).
 * server INSERT 전에 KST wall clock string ("YYYY-MM-DD HH:MM:SS") 으로 변환해
 * pg driver 가 다시 KST 로 wrap 했을 때 epoch 가 일치하도록 보장.
 */
const KST_WALL = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Asia/Seoul",
  year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit",
  hour12: false,
});
function toKstWallClock(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return KST_WALL.format(d); // "2026-05-13 09:13:45"
}

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
    // addressText 폴백 — AI OCR 없을 때 reverseGeocode → 좌표 string 순으로 채움.
    // dashboard/CSV "위치" 자동 표시 (addressTextAi 는 AI 원본 학습용으로 별도 보존).
    let addressTextFinal: string | null = entry.addressText ?? null;
    if (!addressTextFinal && entry.latitude != null && entry.longitude != null) {
      addressTextFinal = geocodedAddress
        ?? `위경도 ${entry.latitude.toFixed(5)}, ${entry.longitude.toFixed(5)}`;
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
    // KST wall clock 으로 stored (TIMESTAMP WITHOUT TZ + Postgres UTC + Node KST 조합 가드)
    let createdAtStr: string | null = toKstWallClock(entry.originalPhotoTime);
    if (!createdAtStr) {
      const baseHour = 9;
      const minuteOffset = entryIdx;
      // body.entryDate (KST date) + 09:MM:00 KST wall clock 그대로
      createdAtStr = `${body.entryDate} ${String(baseHour).padStart(2, "0")}:${String(minuteOffset % 60).padStart(2, "0")}:00`;
    }

    // originalPhotoTime 컬럼도 KST wall clock 으로 통일
    const originalPhotoTimeStr = toKstWallClock(entry.originalPhotoTime);

    // entryDate 자동 보정 — 사진 EXIF 일자가 사용자 선택 entryDate 와 다르면 EXIF 우선.
    // 사용자가 5/17 default 로 batch 업로드해도 사진이 5/13 이면 entryDate = 5/13 으로 저장.
    // KST 기준 YYYY-MM-DD 도출 (다운로드/dashboard 의 일자별 그룹화와 일치).
    let entryDateActual = body.entryDate;
    if (entry.originalPhotoTime) {
      const d = new Date(entry.originalPhotoTime);
      if (!isNaN(d.getTime())) {
        const kstDate = d.toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
        if (kstDate && /^\d{4}-\d{2}-\d{2}$/.test(kstDate)) {
          entryDateActual = kstDate;
        }
      }
    }

    values.push(
      id,
      user.id,
      entry.category,
      cat.eval,
      cat.points,
      entry.latitude ?? null,
      entry.longitude ?? null,
      addressTextFinal,
      geocodedAddress,
      entry.memo ?? null,
      quantity,
      cat.unit,
      entry.photoUrls,
      entry.photoUrls.length,
      batchId,
      originalPhotoTimeStr,
      entryDateActual,
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
