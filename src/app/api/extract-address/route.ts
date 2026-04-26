import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { extractAddress } from "@/lib/classify";

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "인증 필요" }, { status: 401 });

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ address: null });
  }

  const { images } = await request.json();
  if (!images?.length) {
    return NextResponse.json({ address: null });
  }

  // 앞 3장만 검사 (주소판은 보통 첫 사진)
  for (const img of images.slice(0, 3)) {
    try {
      const address = await extractAddress(img.base64, img.mediaType || "image/jpeg");
      if (address) {
        return NextResponse.json({ address });
      }
    } catch {
      continue;
    }
  }

  return NextResponse.json({ address: null });
}
