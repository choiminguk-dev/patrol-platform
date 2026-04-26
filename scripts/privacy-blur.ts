import sharp from "sharp";

interface BBox {
  x: number; // 픽셀 좌표
  y: number;
  w: number;
  h: number;
}

// face-api 동적 로드 (WASM 백엔드)
let faceApiReady: Promise<any> | null = null;

async function ensureFaceApi() {
  if (faceApiReady) return faceApiReady;

  faceApiReady = (async () => {
    const tf = require("@tensorflow/tfjs");
    require("@tensorflow/tfjs-backend-wasm");
    const faceapi = require("@vladmandic/face-api/dist/face-api.node-wasm.js");
    const canvas = require("canvas");

    faceapi.env.monkeyPatch({
      Canvas: canvas.Canvas,
      Image: canvas.Image,
      ImageData: canvas.ImageData,
    });

    await tf.setBackend("wasm");
    await tf.ready();

    const path = require("path");
    const modelPath = path.join(process.cwd(), "models", "face-api");
    await faceapi.nets.ssdMobilenetv1.loadFromDisk(modelPath);

    return { faceapi, canvas };
  })();

  return faceApiReady;
}

/**
 * 로컬 얼굴 감지 (해외 서버 전송 없음)
 * - face-api.js + WASM 백엔드 (서버 내 처리)
 * - 번호판은 순찰 사진에 드물어 생략 (필요 시 별도 추가)
 */
async function detectFacesLocal(
  imageBuffer: Buffer
): Promise<BBox[]> {
  const { faceapi, canvas } = await ensureFaceApi();
  const sharp = (await import("sharp")).default;

  // 원본 크기 확인
  const meta = await sharp(imageBuffer).metadata();
  const origW = meta.width || 1280;
  const origH = meta.height || 960;

  // 416px로 축소 후 감지 (속도 ~5배 향상)
  const TARGET = 416;
  const resized = await sharp(imageBuffer)
    .resize(TARGET, TARGET, { fit: "inside" })
    .jpeg({ quality: 70 })
    .toBuffer();

  const img = await canvas.loadImage(resized);
  const detectW = img.width;
  const detectH = img.height;
  const c = canvas.createCanvas(detectW, detectH);
  c.getContext("2d").drawImage(img, 0, 0);

  const detections = await faceapi.detectAllFaces(
    c,
    new faceapi.SsdMobilenetv1Options({ minConfidence: 0.3 })
  );

  // 축소 좌표 → 원본 좌표로 스케일링
  const scaleX = origW / detectW;
  const scaleY = origH / detectH;

  return detections.map((d: any) => ({
    x: Math.round(d.box.x * scaleX),
    y: Math.round(d.box.y * scaleY),
    w: Math.round(d.box.width * scaleX),
    h: Math.round(d.box.height * scaleY),
  }));
}

/**
 * 이미지 배열에서 얼굴을 감지하여 블러 처리
 * - 100% 로컬 처리 (해외 서버 전송 없음)
 * @param images - {index: 1-based photo number, buffer: original image buffer}[]
 * @returns 블러 처리된 버퍼 배열 (같은 순서)
 */
export async function blurPrivacyRegions(
  images: { index: number; buffer: Buffer }[]
): Promise<Buffer[]> {
  if (images.length === 0) return [];

  const results: Buffer[] = [];

  for (const img of images) {
    let faces: BBox[];
    try {
      faces = await detectFacesLocal(img.buffer);
    } catch (_e) {
      // 감지 실패 시 원본 반환
      results.push(img.buffer);
      continue;
    }

    if (faces.length === 0) {
      results.push(img.buffer);
      continue;
    }

    try {
      const metadata = await sharp(img.buffer).metadata();
      const imgW = metadata.width || 1280;
      const imgH = metadata.height || 960;

      const composites: sharp.OverlayOptions[] = [];

      for (const r of faces) {
        // 10% 마진 추가
        const margin = 0.1;
        const left = Math.max(0, Math.round(r.x - r.w * margin));
        const top = Math.max(0, Math.round(r.y - r.h * margin));
        const width = Math.min(imgW - left, Math.round(r.w * (1 + margin * 2)));
        const height = Math.min(imgH - top, Math.round(r.h * (1 + margin * 2)));

        if (width < 10 || height < 10) continue;

        const blurredRegion = await sharp(img.buffer)
          .extract({ left, top, width, height })
          .blur(Math.max(15, Math.round(Math.min(width, height) / 3)))
          .toBuffer();

        composites.push({ input: blurredRegion, left, top });
      }

      if (composites.length > 0) {
        const blurred = await sharp(img.buffer)
          .composite(composites)
          .jpeg({ quality: 85 })
          .toBuffer();
        results.push(blurred);
      } else {
        results.push(img.buffer);
      }
    } catch (_e) {
      results.push(img.buffer);
    }
  }

  return results;
}
