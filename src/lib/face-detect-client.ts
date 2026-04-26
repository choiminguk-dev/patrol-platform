/**
 * 브라우저 얼굴 감지 (100% 로컬, 해외 전송 없음)
 * - face-api.js SSD MobileNet v1
 * - WebGL/CPU 백엔드 (사용자 기기에서 실행)
 * - 감지 결과: 퍼센트 좌표 [{x, y, w, h}] (0~100)
 */

export interface FaceBBox {
  x: number;  // 좌상단 x (0~100 퍼센트)
  y: number;  // 좌상단 y (0~100 퍼센트)
  w: number;  // 너비 (0~100 퍼센트)
  h: number;  // 높이 (0~100 퍼센트)
}

let faceApiLoaded = false;
let faceApiLoading: Promise<void> | null = null;

/** face-api.js 동적 로드 (CDN) + 모델 로드 (SSD + Tiny 이중 감지) */
async function ensureFaceApi(): Promise<any> {
  if (faceApiLoaded && (window as any).faceapi) return (window as any).faceapi;

  if (faceApiLoading) {
    try {
      await faceApiLoading;
      return (window as any).faceapi;
    } catch {
      // 이전 시도 실패 → 리셋 후 재시도
      faceApiLoading = null;
    }
  }

  faceApiLoading = (async () => {
    // face-api.js CDN 로드 (10s 타임아웃 — 실패 시 블러 없이 업로드 계속)
    if (!(window as any).faceapi) {
      await new Promise<void>((resolve, reject) => {
        const script = document.createElement("script");
        script.src = "https://cdn.jsdelivr.net/npm/@vladmandic/face-api/dist/face-api.js";
        let settled = false;
        const done = (err?: Error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          err ? reject(err) : resolve();
        };
        const timer = setTimeout(() => done(new Error("face-api.js CDN 로드 타임아웃 10s")), 10000);
        script.onload = () => done();
        script.onerror = () => done(new Error("face-api.js 로드 실패"));
        document.head.appendChild(script);
      });
    }

    const faceapi = (window as any).faceapi;

    // SSD + TinyFaceDetector 모델 로드 (15s 타임아웃)
    await Promise.race([
      Promise.all([
        faceapi.nets.ssdMobilenetv1.isLoaded ? Promise.resolve() : faceapi.nets.ssdMobilenetv1.loadFromUri("/models"),
        faceapi.nets.tinyFaceDetector.isLoaded ? Promise.resolve() : faceapi.nets.tinyFaceDetector.loadFromUri("/models"),
      ]),
      new Promise((_, reject) => setTimeout(() => reject(new Error("모델 로드 타임아웃 15s")), 15000)),
    ]);

    faceApiLoaded = true;
  })();

  try {
    await faceApiLoading;
    return (window as any).faceapi;
  } catch (e) {
    faceApiLoading = null; // 실패 시 리셋
    throw e;
  }
}

/** 앱 접속 시 모델 사전 로드 (백그라운드, 실패 무시) */
export function preloadFaceApi(): void {
  ensureFaceApi().catch(() => {});
}

/**
 * 브라우저에서 Canvas로 블러 처리 (온디바이스, 서버 전송 전)
 * - 원본 Blob + 감지 좌표 → 블러된 Blob 반환
 * - 미리보기용 (사용자 확인 후 업로드)
 */
export async function applyBlurOnDevice(
  imageBlob: Blob,
  faces: FaceBBox[]
): Promise<Blob> {
  if (faces.length === 0) return imageBlob;

  const url = URL.createObjectURL(imageBlob);
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error("이미지 로드 실패"));
    el.src = url;
  });
  URL.revokeObjectURL(url);

  const canvas = document.createElement("canvas");
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0);

  // 강한 익명화: 큰 margin + 극소 픽셀화(6블록) + Gaussian 블러 조합
  for (const f of faces) {
    const margin = 0.3; // 머리/귀/목까지 커버
    const x = Math.max(0, Math.round(((f.x - f.w * margin) / 100) * img.width));
    const y = Math.max(0, Math.round(((f.y - f.h * margin) / 100) * img.height));
    const w = Math.min(img.width - x, Math.round((f.w * (1 + margin * 2) / 100) * img.width));
    const h = Math.min(img.height - y, Math.round((f.h * (1 + margin * 2) / 100) * img.height));
    if (w < 5 || h < 5) continue;

    // 1단계: 극소 해상도로 다운샘플 → 업스케일 (모자이크 6블록 고정)
    const blocks = 6;
    const tempCanvas = document.createElement("canvas");
    tempCanvas.width = blocks;
    tempCanvas.height = blocks;
    const tempCtx = tempCanvas.getContext("2d")!;
    tempCtx.drawImage(canvas, x, y, w, h, 0, 0, blocks, blocks);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(tempCanvas, 0, 0, blocks, blocks, x, y, w, h);
    ctx.imageSmoothingEnabled = true;

    // 2단계: 강한 Gaussian 블러 2패스 — 서버 sharp(sigma=min/4) 수준 맞추기
    // CSS blur(Npx)는 sharp sigma보다 약해서 2번 적용해 복합 효과 + 값 상향
    const blurPx = Math.max(30, Math.round(Math.min(w, h) / 3));
    const blurCanvas = document.createElement("canvas");
    blurCanvas.width = w;
    blurCanvas.height = h;
    const blurCtx = blurCanvas.getContext("2d")!;
    blurCtx.filter = `blur(${blurPx}px)`;
    blurCtx.drawImage(canvas, x, y, w, h, 0, 0, w, h);
    ctx.drawImage(blurCanvas, x, y);
    // 2패스: 방금 흐려진 영역을 다시 한번 블러
    blurCtx.clearRect(0, 0, w, h);
    blurCtx.filter = `blur(${blurPx}px)`;
    blurCtx.drawImage(canvas, x, y, w, h, 0, 0, w, h);
    ctx.drawImage(blurCanvas, x, y);
  }

  return new Promise<Blob>((resolve) => {
    canvas.toBlob((blob) => resolve(blob || imageBlob), "image/jpeg", 0.85);
  });
}

/**
 * Blob/File에서 얼굴 감지 → 퍼센트 좌표 배열 반환
 * - 사용자 기기에서 100% 로컬 실행
 * - 감지 실패 시 빈 배열 반환 (에러 무시)
 */
export async function detectFaces(imageBlob: Blob): Promise<FaceBBox[]> {
  try {
    const faceapi = await ensureFaceApi();

    // Blob → HTMLImageElement
    const url = URL.createObjectURL(imageBlob);
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("이미지 로드 실패"));
      el.src = url;
    });
    URL.revokeObjectURL(url);

    // 감지용 캔버스 (608px — 작은/원거리 얼굴 감지율 향상)
    const canvas = document.createElement("canvas");
    const scale = Math.min(1, 608 / Math.max(img.width, img.height));
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);

    // SSD + TinyFaceDetector 이중 감지 → 합집합 (옆모습 감지율 향상)
    const [ssdDets, tinyDets] = await Promise.all([
      faceapi.detectAllFaces(canvas, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.25 })),
      faceapi.detectAllFaces(canvas, new faceapi.TinyFaceDetectorOptions({ inputSize: 608, scoreThreshold: 0.25 })),
    ]);

    // 두 모델 결과 합치기 (중복 영역은 하나만 유지)
    const allDets = [...ssdDets, ...tinyDets];
    const toPct = (d: any): FaceBBox => ({
      x: (d.box.x / canvas.width) * 100,
      y: (d.box.y / canvas.height) * 100,
      w: (d.box.width / canvas.width) * 100,
      h: (d.box.height / canvas.height) * 100,
    });

    const merged: FaceBBox[] = [];
    for (const d of allDets) {
      const f = toPct(d);
      // 면적 30% 이상 = 오감지 (손가락/렌즈 가림)
      if ((f.w * f.h) / 10000 >= 0.3) continue;
      // 기존 감지와 50% 이상 겹치면 중복 → 스킵
      const overlap = merged.some((m) => {
        const ox = Math.max(0, Math.min(m.x + m.w, f.x + f.w) - Math.max(m.x, f.x));
        const oy = Math.max(0, Math.min(m.y + m.h, f.y + f.h) - Math.max(m.y, f.y));
        const inter = ox * oy;
        const smaller = Math.min(m.w * m.h, f.w * f.h);
        return smaller > 0 && inter / smaller > 0.5;
      });
      if (!overlap) merged.push(f);
    }

    return merged;
  } catch {
    return []; // 감지 실패 시 빈 배열 (업로드는 계속 진행)
  }
}

/**
 * 여러 Blob에서 얼굴 감지 (배치)
 * - 첫 호출 시 모델 로드 (~2초), 이후 장당 ~100-200ms
 */
export async function detectFacesBatch(
  blobs: Blob[],
  onProgress?: (done: number, total: number) => void
): Promise<FaceBBox[][]> {
  // 모델 사전 로드
  await ensureFaceApi();

  const results: FaceBBox[][] = [];
  for (let i = 0; i < blobs.length; i++) {
    results.push(await detectFaces(blobs[i]));
    onProgress?.(i + 1, blobs.length);
  }
  return results;
}
