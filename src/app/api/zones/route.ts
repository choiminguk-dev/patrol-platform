import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { execute, queryMany, queryOne } from "@/lib/db";

/** 구역 목록 (선택: ?category=xxx 필터) */
export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "인증 필요" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const category = searchParams.get("category");

  let zones;
  if (category) {
    zones = await queryMany(
      `SELECT id, "seqNo", address, landmark, notes, "referencePhotoUrls",
              category, "discoveredFrom", "createdAt", "updatedAt"
       FROM patrol_zones
       WHERE "tenantId" = 'huam' AND (category IS NULL OR category = $1)
       ORDER BY "seqNo"`,
      [category]
    );
  } else {
    zones = await queryMany(
      `SELECT id, "seqNo", address, landmark, notes, "referencePhotoUrls",
              category, "discoveredFrom", "createdAt", "updatedAt"
       FROM patrol_zones
       WHERE "tenantId" = 'huam'
       ORDER BY "seqNo"`
    );
  }
  return NextResponse.json(zones);
}

/** 신규 구역 생성 */
export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "인증 필요" }, { status: 401 });
  if (user.role !== "ADMIN") {
    return NextResponse.json({ error: "관리자만 가능" }, { status: 403 });
  }

  const body = await request.json();
  const { seqNo, address, landmark, notes, category, discoveredFrom } = body;

  if (!seqNo || !address || !landmark) {
    return NextResponse.json({ error: "연번·주소·장소특징 필수" }, { status: 400 });
  }

  // 연번 중복 체크
  const existing = await queryOne(
    `SELECT id FROM patrol_zones WHERE "tenantId" = 'huam' AND "seqNo" = $1`,
    [seqNo]
  );
  if (existing) {
    return NextResponse.json({ error: "이미 존재하는 연번" }, { status: 409 });
  }

  const id = crypto.randomUUID();
  await execute(
    `INSERT INTO patrol_zones (id, "tenantId", "seqNo", address, landmark, notes, category, "discoveredFrom")
     VALUES ($1, 'huam', $2, $3, $4, $5, $6, $7)`,
    [id, seqNo, address, landmark, notes || null, category || null, discoveredFrom || "manual"]
  );

  const zone = await queryOne(
    `SELECT * FROM patrol_zones WHERE id = $1`,
    [id]
  );
  return NextResponse.json(zone);
}
