/** 클라이언트 사진 압축 */
import exifr from "exifr";
import { detectFacesBatch, applyBlurOnDevice, type FaceBBox } from "./face-detect-client";

/** 이미지를 maxSize px로 리사이즈 + JPEG 압축 → Blob 반환 */
export function compressImage(
  file: File,
  maxSize: number = 1280,
  quality: number = 0.7
): Promise<Blob | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    let done = false;
    const finish = (blob: Blob | null) => {
      if (done) return;
      done = true;
      URL.revokeObjectURL(url);
      resolve(blob);
    };
    const timer = setTimeout(() => {
      console.warn("[compressImage] 타임아웃 20s:", file.name, file.type);
      finish(null);
    }, 20000);

    img.onload = () => {
      clearTimeout(timer);
      const canvas = document.createElement("canvas");
      let w = img.width;
      let h = img.height;

      if (w <= maxSize && h <= maxSize) {
        canvas.width = w;
        canvas.height = h;
      } else if (w > h) {
        h = Math.round((h * maxSize) / w);
        w = maxSize;
        canvas.width = w;
        canvas.height = h;
      } else {
        w = Math.round((w * maxSize) / h);
        h = maxSize;
        canvas.width = w;
        canvas.height = h;
      }

      canvas.getContext("2d")!.drawImage(img, 0, 0, w, h);
      canvas.toBlob((blob) => finish(blob), "image/jpeg", quality);
    };
    img.onerror = () => {
      clearTimeout(timer);
      console.warn("[compressImage] 이미지 로드 실패:", file.name, file.type);
      finish(null);
    };
    img.src = url;
  });
}

/** 원본 파일에서 EXIF 추출 (Canvas 압축 전에 호출) */
export async function extractExif(file: File): Promise<{ lat?: number; lng?: number; date?: string; heading?: number } | null> {
  try {
    const parsed = await exifr.parse(file, {
      pick: [
        "DateTimeOriginal",
        "GPSLatitude", "GPSLongitude",
        "GPSLatitudeRef", "GPSLongitudeRef",
        "GPSImgDirection", "GPSImgDirectionRef",
      ],
    });
    if (!parsed) return null;
    return {
      date: parsed.DateTimeOriginal?.toISOString?.() ?? undefined,
      lat: parsed.latitude ?? undefined,
      lng: parsed.longitude ?? undefined,
      heading: typeof parsed.GPSImgDirection === "number" ? parsed.GPSImgDirection : undefined,
    };
  } catch {
    return null;
  }
}

/** 썸네일 생성 (150px, 0.5 quality) → data URL. Blob/File 모두 허용. */
export function createThumbnail(source: Blob): Promise<string | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(source);
    const img = new Image();
    let done = false;
    const finish = (result: string | null) => {
      if (done) return;
      done = true;
      URL.revokeObjectURL(url);
      resolve(result);
    };
    const label = source instanceof File ? `${source.name} (${source.type})` : `blob ${source.type}`;
    const timer = setTimeout(() => {
      console.warn("[createThumbnail] 타임아웃 15s:", label);
      finish(null);
    }, 15000);

    img.onload = () => {
      clearTimeout(timer);
      const canvas = document.createElement("canvas");
      let w = img.width;
      let h = img.height;
      const maxSize = 150;

      if (w > h) {
        h = Math.round((h * maxSize) / w);
        w = maxSize;
      } else {
        w = Math.round((w * maxSize) / h);
        h = maxSize;
      }
      canvas.width = w;
      canvas.height = h;
      canvas.getContext("2d")!.drawImage(img, 0, 0, w, h);
      finish(canvas.toDataURL("image/jpeg", 0.5));
    };
    img.onerror = () => {
      clearTimeout(timer);
      console.warn("[createThumbnail] 이미지 로드 실패:", label);
      finish(null);
    };
    img.src = url;
  });
}

export type UploadResult = { filename: string; url: string; exif: { lat?: number; lng?: number; date?: string; heading?: number } | null };

export interface PreparedPhoto {
  blob: Blob;           // 원본 (1280px 압축)
  blurredBlob: Blob;    // 블러 처리된 버전 (미리보기용)
  name: string;
  exif: { lat?: number; lng?: number; date?: string; heading?: number } | null;
  faces: FaceBBox[];    // 감지된 얼굴 좌표
  hasBlur: boolean;     // 블러 적용 여부
}

/**
 * 사진 준비 (압축 + 얼굴 감지 + 온디바이스 블러) — 업로드 전 미리보기용
 * - 사용자가 블러 결과를 확인하고 승인 후 업로드
 */
export async function preparePhotos(
  files: File[],
  onProgress?: (phase: "compress" | "detect" | "blur", done: number, total: number) => void
): Promise<PreparedPhoto[]> {
  const total = files.length;

  // 1) EXIF + 압축
  onProgress?.("compress", 0, total);
  const [exifData, compressed] = await Promise.all([
    Promise.all(files.map((f) => extractExif(f))),
    Promise.all(files.map((f) => compressImage(f))),
  ]);
  onProgress?.("compress", total, total);

  const valid: { blob: Blob; name: string; exif: typeof exifData[0] }[] = [];
  compressed.forEach((blob, i) => {
    if (blob) valid.push({ blob, name: files[i].name, exif: exifData[i] });
  });

  // 2) 얼굴 감지 (실패 시 빈 배열로 폴백 — 업로드는 계속 진행)
  onProgress?.("detect", 0, valid.length);
  let faceData: FaceBBox[][] = valid.map(() => []);
  try {
    faceData = await detectFacesBatch(
      valid.map((v) => v.blob),
      (done, total) => onProgress?.("detect", done, total),
    );
  } catch (err) {
    console.warn("[preparePhotos] 얼굴 감지 실패, 블러 없이 진행:", err);
  }

  // 3) 온디바이스 블러 적용 (실패 시 원본 유지)
  const results: PreparedPhoto[] = [];
  for (let i = 0; i < valid.length; i++) {
    const faces = faceData[i] || [];
    let blurredBlob: Blob = valid[i].blob;
    if (faces.length > 0) {
      try {
        blurredBlob = await applyBlurOnDevice(valid[i].blob, faces);
      } catch (err) {
        console.warn("[preparePhotos] 블러 적용 실패, 원본 사용:", err);
      }
    }
    results.push({
      blob: valid[i].blob,
      blurredBlob,
      name: valid[i].name,
      exif: valid[i].exif,
      faces,
      hasBlur: faces.length > 0,
    });
    onProgress?.("blur", i + 1, valid.length);
  }

  return results;
}

/** 준비된 사진 업로드 (사용자 확인 후 호출) */
export async function uploadPreparedPhotos(
  prepared: PreparedPhoto[],
  uploadChunkSize: number = 10,
  onProgress?: (done: number, total: number) => void
): Promise<UploadResult[]> {
  const results: UploadResult[] = [];

  for (let i = 0; i < prepared.length; i += uploadChunkSize) {
    const chunk = prepared.slice(i, i + uploadChunkSize);
    const formData = new FormData();
    chunk.forEach((c) => formData.append("photos", c.blob, c.name));
    formData.append("exifData", JSON.stringify(chunk.map((c) => c.exif)));
    formData.append("faceData", JSON.stringify(chunk.map((c) => c.faces)));

    const res = await fetch("/api/uploads", { method: "POST", body: formData });
    if (res.ok) {
      const data = await res.json();
      if (data.files) results.push(...data.files);
    }
    onProgress?.(Math.min(i + uploadChunkSize, prepared.length), prepared.length);
  }

  return results;
}

/** 프로토타입 방식: 원본 EXIF 추출 → 전체 일괄 압축 → 청크 업로드 */
export async function uploadPhotosChunked(
  files: File[],
  uploadChunkSize: number = 10,
  onProgress?: (phase: "compress" | "upload", done: number, total: number) => void
): Promise<UploadResult[]> {
  const total = files.length;

  // Phase 1: EXIF 추출 + 압축 + 얼굴 감지 동시 처리
  onProgress?.("compress", 0, total);

  // 1a) EXIF + 압축 병렬
  const [exifData, compressed] = await Promise.all([
    Promise.all(files.map((f) => extractExif(f))),
    Promise.all(files.map((f) => compressImage(f))),
  ]);

  // 유효한 것만 필터
  const valid: { blob: Blob; name: string; exif: { lat?: number; lng?: number; date?: string; heading?: number } | null }[] = [];
  compressed.forEach((blob, i) => {
    if (blob) valid.push({ blob, name: files[i].name, exif: exifData[i] });
  });
  onProgress?.("compress", Math.round(total * 0.5), total);

  // 1b) 얼굴 감지 — 임시 비활성화
  const faceData: FaceBBox[][] = valid.map(() => []);
  onProgress?.("compress", total, total);

  // Phase 2: 압축 파일 + EXIF 메타데이터 청크 업로드
  const results: UploadResult[] = [];

  for (let i = 0; i < valid.length; i += uploadChunkSize) {
    const chunk = valid.slice(i, i + uploadChunkSize);
    const formData = new FormData();
    chunk.forEach((c) => formData.append("photos", c.blob, c.name));
    // EXIF 데이터를 JSON으로 함께 전송
    formData.append("exifData", JSON.stringify(chunk.map((c) => c.exif)));
    // 얼굴 좌표를 JSON으로 함께 전송 (서버에서 sharp 블러 적용용)
    const chunkFaces = faceData.slice(i, i + uploadChunkSize);
    formData.append("faceData", JSON.stringify(chunkFaces));

    const res = await fetch("/api/uploads", { method: "POST", body: formData });
    if (res.ok) {
      const data = await res.json();
      if (data.files) results.push(...data.files);
    }

    onProgress?.("upload", Math.min(i + uploadChunkSize, valid.length), valid.length);
  }

  return results;
}
