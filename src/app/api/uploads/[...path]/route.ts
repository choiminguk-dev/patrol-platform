import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { join } from "path";

const UPLOAD_DIR = join(process.cwd(), "uploads");

/**
 * 사진 서빙 — 기본: 블러 버전(_blur) 우선 / ?original=true: 원본
 * - 앱 UI에서 자연스럽게 블러된 사진 표시
 * - 공문용 원본이 필요할 때만 ?original=true
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  const filePath = join(UPLOAD_DIR, ...path);

  const { searchParams } = new URL(request.url);
  const wantOriginal = searchParams.get("original") === "true";

  const ext = filePath.split(".").pop()?.toLowerCase() || "jpg";
  const contentType =
    ext === "png" ? "image/png" :
    ext === "gif" ? "image/gif" :
    ext === "webp" ? "image/webp" :
    "image/jpeg";

  // _blur 파일이 아닌 요청 + original 아닐 때 → _blur 우선
  if (!wantOriginal && !path[path.length - 1]?.includes("_blur.")) {
    const blurPath = filePath.replace(`.${ext}`, `_blur.${ext}`);
    try {
      const data = await readFile(blurPath);
      return new NextResponse(data, {
        headers: { "Content-Type": contentType, "Cache-Control": "public, max-age=3600" },
      });
    } catch {
      // _blur 없으면 원본 폴백
    }
  }

  try {
    const data = await readFile(filePath);
    return new NextResponse(data, {
      headers: { "Content-Type": contentType, "Cache-Control": "public, max-age=31536000" },
    });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
