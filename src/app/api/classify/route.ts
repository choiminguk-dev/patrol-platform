import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { classifyPhoto } from "@/lib/classify";
import { queryMany } from "@/lib/db";
import { CATEGORY_MAP } from "@/lib/categories";

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "인증 필요" }, { status: 401 });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "API 키 미설정" }, { status: 503 });
  }

  const { image, mediaType } = await request.json();

  if (!image) {
    return NextResponse.json({ error: "이미지 필요" }, { status: 400 });
  }

  try {
    // 최근 카테고리 분포 + 주소 패턴 병렬 조회
    const [recent, recentAddresses] = await Promise.all([
      queryMany<{ category: string; cnt: string }>(
        `SELECT category, COUNT(*) as cnt FROM patrol_entries
         WHERE "createdAt" > NOW() - INTERVAL '14 days'
         GROUP BY category ORDER BY cnt DESC LIMIT 5`
      ),
      queryMany<{ addressText: string }>(
        `SELECT "addressText" FROM patrol_entries
         WHERE "addressText" IS NOT NULL AND "addressText" != ''
         AND "createdAt" > NOW() - INTERVAL '30 days'
         GROUP BY "addressText"
         ORDER BY MAX("createdAt") DESC LIMIT 20`
      ),
    ]);

    let recentContext: string | undefined;
    const parts: string[] = [];
    if (recent.length > 0) {
      const lines = recent.map(
        (r) => `${CATEGORY_MAP[r.category]?.label || r.category}: ${r.cnt}건`
      );
      parts.push(`최근 2주간 등록 패턴: ${lines.join(", ")}. 유사한 사진은 기존 패턴의 카테고리로 분류해주세요.`);
    }
    parts.push(`주소 보정: "우암로"→"후암로", "두턴바위로"→"두텁바위로". 이 보정을 반드시 적용하세요.`);
    if (recentAddresses.length > 0) {
      const addrs = recentAddresses.map((a) => a.addressText).join(", ");
      parts.push(`최근 등록 주소: ${addrs}`);
    }
    if (parts.length > 0) recentContext = `참고 - ${parts.join("\n")}`;

    const result = await classifyPhoto(
      image,
      mediaType || "image/jpeg",
      recentContext
    );
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: "분류 실패", detail: e instanceof Error ? e.message : "unknown" },
      { status: 500 }
    );
  }
}
