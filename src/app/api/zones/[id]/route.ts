import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { execute, queryOne } from "@/lib/db";

/** 구역 단건 조회 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "인증 필요" }, { status: 401 });

  const { id } = await params;
  const zone = await queryOne(
    `SELECT id, "seqNo", address, landmark, notes, "referencePhotoUrls",
            category, "discoveredFrom", "createdAt", "updatedAt"
     FROM patrol_zones WHERE id = $1`,
    [id]
  );
  if (!zone) return NextResponse.json({ error: "구역 없음" }, { status: 404 });
  return NextResponse.json(zone);
}

/** 구역 수정 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "인증 필요" }, { status: 401 });
  if (user.role !== "ADMIN") {
    return NextResponse.json({ error: "관리자만 가능" }, { status: 403 });
  }

  const { id } = await params;
  const body = await request.json();
  const { seqNo, address, landmark, notes, referencePhotoUrls } = body;

  const fields: string[] = [];
  const values: unknown[] = [];
  let i = 1;

  if (seqNo !== undefined) { fields.push(`"seqNo" = $${i++}`); values.push(seqNo); }
  if (address !== undefined) { fields.push(`address = $${i++}`); values.push(address); }
  if (landmark !== undefined) { fields.push(`landmark = $${i++}`); values.push(landmark); }
  if (notes !== undefined) { fields.push(`notes = $${i++}`); values.push(notes); }
  if (referencePhotoUrls !== undefined) {
    if (!Array.isArray(referencePhotoUrls)) {
      return NextResponse.json({ error: "referencePhotoUrls는 배열이어야 함" }, { status: 400 });
    }
    fields.push(`"referencePhotoUrls" = $${i++}`);
    values.push(referencePhotoUrls);
  }

  if (fields.length === 0) {
    return NextResponse.json({ error: "변경 없음" }, { status: 400 });
  }

  fields.push(`"updatedAt" = CURRENT_TIMESTAMP`);
  values.push(id);

  await execute(
    `UPDATE patrol_zones SET ${fields.join(", ")} WHERE id = $${i}`,
    values
  );

  const updated = await queryOne(
    `SELECT * FROM patrol_zones WHERE id = $1`,
    [id]
  );
  return NextResponse.json(updated);
}

/** 구역 삭제 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "인증 필요" }, { status: 401 });
  if (user.role !== "ADMIN") {
    return NextResponse.json({ error: "관리자만 가능" }, { status: 403 });
  }

  const { id } = await params;
  await execute(`DELETE FROM patrol_zones WHERE id = $1`, [id]);
  return NextResponse.json({ ok: true });
}
