import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { queryOne, queryMany, execute } from "@/lib/db";

interface Assignment {
  photoUrl: string;
  zoneId: string | null;
}

interface OriginalEntry {
  id: string;
  userId: string;
  category: string;
  evalItem: string | null;
  evalPoints: number | null;
  latitude: number | null;
  longitude: number | null;
  memo: string | null;
  unit: string;
  photoUrls: string[];
  inputTrack: string;
  entryDate: string;
  zoneId: string | null;
}

interface ZoneRow {
  id: string;
  seqNo: number;
  address: string;
  landmark: string;
}

/**
 * 잘못 묶인 entry를 사진별 zone 할당으로 재분배 → zone별 새 entry 생성, 원본 삭제
 *
 * Body: { assignments: [{ photoUrl, zoneId | null }] }
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "인증 필요" }, { status: 401 });

  const { id } = await params;
  const body = await request.json();
  const assignments = (body.assignments || []) as Assignment[];

  if (!assignments.length) {
    return NextResponse.json({ error: "할당 정보가 없습니다" }, { status: 400 });
  }

  const original = await queryOne<OriginalEntry>(
    `SELECT id, "userId", category, "evalItem", "evalPoints",
            latitude, longitude, memo, unit, "photoUrls", "inputTrack",
            "entryDate", "zoneId"
     FROM patrol_entries WHERE id = $1`,
    [id]
  );
  if (!original) return NextResponse.json({ error: "없음" }, { status: 404 });

  // 권한: ADMIN 또는 본인
  if (user.role !== "ADMIN" && original.userId !== user.id) {
    return NextResponse.json({ error: "권한 없음" }, { status: 403 });
  }

  // zone 정보 조회 (사용된 zoneId만)
  const zoneIds = Array.from(
    new Set(assignments.map((a) => a.zoneId).filter(Boolean) as string[])
  );
  const zonesById = new Map<string, ZoneRow>();
  if (zoneIds.length > 0) {
    const zones = await queryMany<ZoneRow>(
      `SELECT id, "seqNo", address, landmark FROM patrol_zones WHERE id = ANY($1)`,
      [zoneIds]
    );
    for (const z of zones) zonesById.set(z.id, z);
  }

  // 할당을 zoneId별로 그룹화 (null도 별도 그룹)
  const groups = new Map<string, string[]>();
  for (const a of assignments) {
    const key = a.zoneId || "__none__";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(a.photoUrl);
  }

  // 메모 cleanup: 검토 필요/landmark prefix 등 분배 후 의미 없는 토큰 제거
  function cleanMemo(m: string | null | undefined): string {
    if (!m) return "";
    return m
      .replace(/\[검토 필요:[^\]]*\]\s*/g, "") // [검토 필요: 8장]
      .replace(/\[[^\]]+\]\s*$/g, "")           // 끝에 있는 [landmark]
      .trim();
  }
  const cleanedOriginalMemo = cleanMemo(original.memo);

  // 새 entry 생성
  const newBatchId = `redist-${crypto.randomUUID()}`;
  const created: string[] = [];

  for (const [key, urls] of groups) {
    const zone = key === "__none__" ? null : zonesById.get(key);
    const newId = crypto.randomUUID();
    const addr = zone?.address || null;
    // 분배 후 메모: zone landmark 우선, 원본 메모는 cleanup 후 사용
    const memo = zone
      ? `[${zone.landmark}]${cleanedOriginalMemo ? ` ${cleanedOriginalMemo}` : ""}`
      : cleanedOriginalMemo || null;
    const quantity = Math.max(1, Math.ceil(urls.length / 5));

    await execute(
      `INSERT INTO patrol_entries
        (id, "userId", category, "evalItem", "evalPoints",
         latitude, longitude, "addressText", memo, quantity,
         unit, "photoUrls", "photoCount", "inputTrack", "entryDate",
         "zoneId", "batchId")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
      [
        newId,
        original.userId,
        original.category,
        original.evalItem,
        original.evalPoints,
        original.latitude,
        original.longitude,
        addr,
        memo,
        quantity,
        original.unit,
        urls,
        urls.length,
        original.inputTrack,
        original.entryDate,
        zone?.id || null,
        newBatchId,
      ]
    );
    created.push(newId);
  }

  // 원본 삭제
  await execute(`DELETE FROM patrol_entries WHERE id = $1`, [id]);

  // Phase C 학습: 분배 결과를 zone에 referencePhoto로 누적
  const zoneToUrls = new Map<string, string[]>();
  for (const a of assignments) {
    if (a.zoneId) {
      if (!zoneToUrls.has(a.zoneId)) zoneToUrls.set(a.zoneId, []);
      zoneToUrls.get(a.zoneId)!.push(a.photoUrl);
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
      const trimmed = combined.slice(-20);
      await execute(
        `UPDATE patrol_zones SET "referencePhotoUrls" = $1, "updatedAt" = NOW() WHERE id = $2`,
        [trimmed, zoneId]
      );
    } catch { /* 학습 실패 무시 */ }
  }

  return NextResponse.json({
    ok: true,
    created: created.length,
    batchId: newBatchId,
  });
}
