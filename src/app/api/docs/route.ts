import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { generateDocument, listDocuments, type DocType } from "@/lib/doc-generator";

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "인증 필요" }, { status: 401 });

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "API 키 미설정" }, { status: 503 });
  }

  const { docType, startDate, endDate } = await request.json();

  if (!docType || !startDate || !endDate) {
    return NextResponse.json({ error: "문서 유형과 날짜 범위를 지정하세요" }, { status: 400 });
  }

  try {
    const doc = await generateDocument({ docType: docType as DocType, startDate, endDate });
    return NextResponse.json(doc);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "생성 실패" },
      { status: 500 }
    );
  }
}

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "인증 필요" }, { status: 401 });

  const docs = await listDocuments();
  return NextResponse.json(docs);
}
