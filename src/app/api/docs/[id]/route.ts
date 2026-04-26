import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getDocument } from "@/lib/doc-generator";
import { execute } from "@/lib/db";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "인증 필요" }, { status: 401 });

  const { id } = await params;
  const doc = await getDocument(id);
  if (!doc) return NextResponse.json({ error: "문서 없음" }, { status: 404 });

  return NextResponse.json(doc);
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "인증 필요" }, { status: 401 });

  // 문서 삭제는 ADMIN만 가능
  if (user.role !== "ADMIN") {
    return NextResponse.json({ error: "삭제 권한이 없습니다" }, { status: 403 });
  }

  const { id } = await params;
  await execute(`DELETE FROM generated_docs WHERE id = $1`, [id]);
  return NextResponse.json({ ok: true });
}
