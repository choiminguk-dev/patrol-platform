import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { readdir, stat, writeFile } from "fs/promises";
import { join, extname } from "path";

const UPLOAD_DIR = join(process.cwd(), "uploads");

/** 디렉토리 내 블러 미생성 사진 목록 (재귀) */
async function findUnblurred(dir: string): Promise<string[]> {
  const results: string[] = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return results;
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await findUnblurred(fullPath)));
    } else if (entry.isFile()) {
      const ext = extname(entry.name).toLowerCase();
      if (![".jpg", ".jpeg", ".png", ".webp"].includes(ext)) continue;
      if (entry.name.includes("_blur.")) continue;
      const blurName = entry.name.replace(ext, `_blur${ext}`);
      try {
        await stat(join(dir, blurName));
        continue;
      } catch {
        // _blur 미존재 → 처리 대상
      }
      results.push(fullPath);
    }
  }
  return results;
}

/** 날짜 폴더 목록 */
async function listDateFolders(): Promise<string[]> {
  try {
    const entries = await readdir(UPLOAD_DIR, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(e.name))
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}

/**
 * GET: 미처리 현황 조회
 * - ?date=2026-04-06 → 해당 날짜만
 * - date 없으면 → 날짜별 요약
 */
export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "인증 필요" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const targetDate = searchParams.get("date");

  if (targetDate) {
    const unblurred = await findUnblurred(join(UPLOAD_DIR, targetDate));
    return NextResponse.json({ date: targetDate, remaining: unblurred.length });
  }

  const folders = await listDateFolders();
  let totalRemaining = 0;
  const dates: { date: string; remaining: number }[] = [];

  for (const folder of folders) {
    const unblurred = await findUnblurred(join(UPLOAD_DIR, folder));
    dates.push({ date: folder, remaining: unblurred.length });
    totalRemaining += unblurred.length;
  }

  return NextResponse.json({ remaining: totalRemaining, dates });
}

/**
 * POST: 로컬 PC에서 생성한 _blur 파일 업로드 수신
 * body: { path: "2026-04-06/xxxxx.jpeg", data: "base64..." }
 */
export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "인증 필요" }, { status: 401 });
  if (user.role !== "ADMIN") {
    return NextResponse.json({ error: "관리자만 가능" }, { status: 403 });
  }

  try {
    const { path: relPath, data } = await request.json();
    if (!relPath || !data) {
      return NextResponse.json({ error: "path, data 필수" }, { status: 400 });
    }

    const ext = extname(relPath);
    const blurPath = join(UPLOAD_DIR, relPath.replace(ext, `_blur${ext}`));
    const buf = Buffer.from(data, "base64");
    await writeFile(blurPath, buf);

    return NextResponse.json({ ok: true, path: blurPath });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "업로드 실패" },
      { status: 500 }
    );
  }
}
