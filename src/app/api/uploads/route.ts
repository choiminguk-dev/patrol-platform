import { NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { todayKr } from "@/lib/date";
import sharp from "sharp";

const UPLOAD_DIR = join(process.cwd(), "uploads");

export async function POST(request: Request) {
  const formData = await request.formData();
  const files = formData.getAll("photos") as File[];

  if (!files.length) {
    return NextResponse.json({ error: "사진을 선택하세요" }, { status: 400 });
  }

  // 클라이언트에서 추출한 EXIF (Canvas 압축 전 원본에서 추출)
  let clientExif: ({ lat?: number; lng?: number; date?: string } | null)[] = [];
  const exifJson = formData.get("exifData");
  if (exifJson && typeof exifJson === "string") {
    try { clientExif = JSON.parse(exifJson); } catch { /* ignore */ }
  }

  // 클라이언트에서 감지한 얼굴 좌표 (퍼센트 기준)
  let clientFaces: ({ x: number; y: number; w: number; h: number }[])[] = [];
  const faceJson = formData.get("faceData");
  if (faceJson && typeof faceJson === "string") {
    try { clientFaces = JSON.parse(faceJson); } catch { /* ignore */ }
  }

  const dateStr = todayKr();
  const dir = join(UPLOAD_DIR, dateStr);
  await mkdir(dir, { recursive: true });

  const results: {
    filename: string;
    url: string;
    exif: { lat?: number; lng?: number; date?: string; heading?: number } | null;
  }[] = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    const ext = file.name.split(".").pop() || "jpg";
    const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const filepath = join(dir, filename);

    await writeFile(filepath, buffer);

    // 클라이언트가 감지한 얼굴 좌표로 _blur 버전 생성 (sharp만 사용, AI 불필요)
    const faces = clientFaces[i] || [];
    if (faces.length > 0) {
      try {
        const meta = await sharp(buffer).metadata();
        const imgW = meta.width || 1280;
        const imgH = meta.height || 960;
        const composites: sharp.OverlayOptions[] = [];

        for (const f of faces) {
          const margin = 0.3; // 머리/귀/목까지 커버
          const left = Math.max(0, Math.round(((f.x - f.w * margin) / 100) * imgW));
          const top = Math.max(0, Math.round(((f.y - f.h * margin) / 100) * imgH));
          const width = Math.min(imgW - left, Math.round((f.w * (1 + margin * 2) / 100) * imgW));
          const height = Math.min(imgH - top, Math.round((f.h * (1 + margin * 2) / 100) * imgH));
          if (width < 10 || height < 10) continue;

          // 강한 익명화: 6px 모자이크 → 업스케일(복원 불가) → Gaussian 블러 덮어씌움
          const region = sharp(buffer).extract({ left, top, width, height });
          const pixelated = await region
            .clone()
            .resize(6, 6, { kernel: "cubic" })
            .resize(width, height, { kernel: "nearest" })
            .toBuffer();
          const blurredRegion = await sharp(pixelated)
            .blur(Math.max(20, Math.round(Math.min(width, height) / 4)))
            .toBuffer();
          composites.push({ input: blurredRegion, left, top });
        }

        if (composites.length > 0) {
          const blurred = await sharp(buffer).composite(composites).jpeg({ quality: 85 }).toBuffer();
          await writeFile(filepath.replace(`.${ext}`, `_blur.${ext}`), blurred);
        }
      } catch { /* 블러 실패 시 무시 — 원본은 이미 저장됨 */ }
    }

    // 클라이언트 EXIF 우선 사용 (압축 전 원본에서 추출한 것)
    const exif = clientExif[i] || null;

    results.push({
      filename,
      url: `/api/uploads/${dateStr}/${filename}`,
      exif,
    });
  }

  return NextResponse.json({ files: results, count: results.length });
}
