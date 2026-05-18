import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { queryOne, execute } from "@/lib/db";
import { CATEGORY_MAP } from "@/lib/categories";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "인증 필요" }, { status: 401 });

  const { id } = await params;
  const entry = await queryOne(
    `SELECT e.*, u.name as "userName"
     FROM patrol_entries e
     JOIN users u ON u.id = e."userId"
     WHERE e.id = $1`,
    [id]
  );

  if (!entry) return NextResponse.json({ error: "없음" }, { status: 404 });
  return NextResponse.json(entry);
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "인증 필요" }, { status: 401 });

  const { id } = await params;
  const body = await request.json();
  const { category, memo, addressText, photoUrls, zoneId, entryDate, categorySource } = body;

  // 권한: ADMIN 또는 본인
  if (user.role !== "ADMIN") {
    const owner = await queryOne<{ userId: string }>(
      `SELECT "userId" FROM patrol_entries WHERE id = $1`,
      [id]
    );
    if (!owner) return NextResponse.json({ error: "없음" }, { status: 404 });
    if (owner.userId !== user.id) {
      return NextResponse.json({ error: "수정 권한이 없습니다" }, { status: 403 });
    }
  }

  const fields: string[] = [];
  const values: unknown[] = [];
  let i = 1;

  if (category !== undefined) {
    const cat = CATEGORY_MAP[category];
    if (!cat) return NextResponse.json({ error: "유효하지 않은 카테고리" }, { status: 400 });
    fields.push(`category = $${i++}`); values.push(category);
    fields.push(`"evalItem" = $${i++}`); values.push(cat.eval);
    fields.push(`"evalPoints" = $${i++}`); values.push(cat.points);
    // B안: 사용자 카테고리 변경 = manual (명시 source 송신 없을 때만 자동 'manual').
    // categorySource 가 body 에 명시되면 그 값 우선 (아래 분기에서 처리).
    if (categorySource === undefined) {
      fields.push(`"categorySource" = $${i++}`); values.push("manual");
    }
  }
  if (categorySource !== undefined) {
    // B안: "✓ 확정" 액션은 { categorySource: 'confirmed' } 송신.
    // 카테고리 동시 변경 시 사용자가 명시한 source 가 'manual' 자동 채움보다 우선.
    if (!["suggested", "confirmed", "manual"].includes(categorySource)) {
      return NextResponse.json({ error: "유효하지 않은 categorySource" }, { status: 400 });
    }
    fields.push(`"categorySource" = $${i++}`); values.push(categorySource);
  }
  if (memo !== undefined) {
    fields.push(`memo = $${i++}`);
    values.push(memo || null);
  }
  if (addressText !== undefined) {
    fields.push(`"addressText" = $${i++}`);
    values.push(addressText || null);
  }
  if (zoneId !== undefined) {
    fields.push(`"zoneId" = $${i++}`);
    values.push(zoneId || null);
  }
  if (entryDate !== undefined) {
    // YYYY-MM-DD 형식 검증
    if (!/^\d{4}-\d{2}-\d{2}$/.test(entryDate)) {
      return NextResponse.json({ error: "날짜 형식이 올바르지 않습니다 (YYYY-MM-DD)" }, { status: 400 });
    }
    fields.push(`"entryDate" = $${i++}`);
    values.push(entryDate);
  }
  if (photoUrls !== undefined && Array.isArray(photoUrls)) {
    const urls = photoUrls as string[];
    if (urls.length === 0) {
      return NextResponse.json({ error: "최소 1장 이상 필요" }, { status: 400 });
    }
    const quantity = Math.max(1, Math.ceil(urls.length / 5));
    fields.push(`"photoUrls" = $${i++}`); values.push(urls);
    fields.push(`"photoCount" = $${i++}`); values.push(urls.length);
    fields.push(`quantity = $${i++}`); values.push(quantity);
  }

  if (fields.length === 0) {
    return NextResponse.json({ error: "변경 사항이 없습니다" }, { status: 400 });
  }

  values.push(id);
  await execute(
    `UPDATE patrol_entries SET ${fields.join(", ")} WHERE id = $${i}`,
    values
  );

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "인증 필요" }, { status: 401 });

  const { id } = await params;

  // 권한 확인: ADMIN은 전체 삭제 가능, 나머지는 자기 것만
  if (user.role !== "ADMIN") {
    const entry = await queryOne<{ userId: string }>(
      `SELECT "userId" FROM patrol_entries WHERE id = $1`,
      [id]
    );
    if (!entry) return NextResponse.json({ error: "없음" }, { status: 404 });
    if (entry.userId !== user.id) {
      return NextResponse.json({ error: "삭제 권한이 없습니다" }, { status: 403 });
    }
  }

  await execute(`DELETE FROM patrol_entries WHERE id = $1`, [id]);
  return NextResponse.json({ ok: true });
}
