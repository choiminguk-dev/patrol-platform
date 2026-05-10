import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { execute, queryOne, queryMany } from "@/lib/db";

interface PromoteRequest {
  statId: string;       // category_address_stats.id
  landmark?: string;    // 사용자가 부여한 장소 특징 (선택)
}

/**
 * 후보 주소를 정식 zone으로 승격
 * POST /api/zones/promote
 */
export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "인증 필요" }, { status: 401 });
  if (user.role !== "ADMIN") {
    return NextResponse.json({ error: "관리자만 가능" }, { status: 403 });
  }

  const body = (await request.json()) as PromoteRequest;
  const { statId, landmark } = body;

  const stat = await queryOne<{
    category: string;
    displayAddress: string;
    promotedZoneId: string | null;
  }>(
    `SELECT category, "displayAddress", "promotedZoneId"
     FROM category_address_stats WHERE id = $1`,
    [statId]
  );
  if (!stat) return NextResponse.json({ error: "후보 없음" }, { status: 404 });
  if (stat.promotedZoneId) {
    return NextResponse.json({ error: "이미 승격됨" }, { status: 409 });
  }

  // 다음 seqNo 계산 (해당 카테고리 + NULL 합친 zones 중 최대값 + 1)
  const last = await queryMany<{ max: number }>(
    `SELECT COALESCE(MAX("seqNo"), 0) AS max FROM patrol_zones WHERE "tenantId" = 'huam'`
  );
  const seqNo = (last[0]?.max || 0) + 1;

  // 새 zone 생성
  const zoneId = crypto.randomUUID();
  await execute(
    `INSERT INTO patrol_zones
       (id, "tenantId", "seqNo", address, landmark, category, "discoveredFrom")
     VALUES ($1, 'huam', $2, $3, $4, $5, 'auto')`,
    [zoneId, seqNo, stat.displayAddress, landmark || stat.displayAddress, stat.category]
  );

  // stat에 promote 표시
  await execute(
    `UPDATE category_address_stats SET "promotedZoneId" = $1 WHERE id = $2`,
    [zoneId, statId]
  );

  const created = await queryOne(
    `SELECT * FROM patrol_zones WHERE id = $1`,
    [zoneId]
  );
  return NextResponse.json(created);
}
