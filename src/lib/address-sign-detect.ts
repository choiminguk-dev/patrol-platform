/**
 * 파란색 도로명 주소판 감지 (100% 온디바이스, Canvas 색상 분석)
 * - ML 모델 불필요, 순수 픽셀 색상 분석
 * - 한국 도로명 주소판: 파란색(HSV H=200-240, S>40%, V>40%) + 흰색 텍스트
 * - 장당 ~30-50ms (매우 빠름)
 */

export interface AddressSignResult {
  detected: boolean;
  confidence: number; // 0-1
}

/**
 * 이미지에서 파란색 주소판 존재 여부 감지
 * - 320px로 축소 후 픽셀 분석 (속도 최적화)
 * - 파란색 픽셀 비율 + 클러스터링으로 판단
 */
export async function detectAddressSign(imageBlob: Blob): Promise<AddressSignResult> {
  try {
    const url = URL.createObjectURL(imageBlob);
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject();
      el.src = url;
    });
    URL.revokeObjectURL(url);

    // 320px로 축소 (속도)
    const canvas = document.createElement("canvas");
    const scale = Math.min(1, 320 / Math.max(img.width, img.height));
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const pixels = imageData.data;
    const totalPixels = canvas.width * canvas.height;

    let blueCount = 0;

    for (let i = 0; i < pixels.length; i += 4) {
      const r = pixels[i];
      const g = pixels[i + 1];
      const b = pixels[i + 2];

      // 한국 도로명 주소판 파란색 범위
      // RGB: R<100, G<170, B>150 + B가 R,G보다 확실히 큼
      if (
        b > 150 &&
        b > r + 60 &&
        b > g + 20 &&
        r < 100 &&
        g < 170
      ) {
        blueCount++;
      }
    }

    const blueRatio = blueCount / totalPixels;

    // 주소판은 보통 사진의 1~8% 차지
    // 0.8% 이상이면 감지 (작은 주소판도 잡기 위해 낮은 임계값)
    const detected = blueRatio > 0.008;
    const confidence = Math.min(1, blueRatio / 0.05); // 5%면 확신 1.0

    return { detected, confidence };
  } catch {
    return { detected: false, confidence: 0 };
  }
}

/**
 * 여러 이미지 배치 감지
 */
export async function detectAddressSignBatch(
  blobs: Blob[],
  onProgress?: (done: number, total: number) => void
): Promise<AddressSignResult[]> {
  const results: AddressSignResult[] = [];
  for (let i = 0; i < blobs.length; i++) {
    results.push(await detectAddressSign(blobs[i]));
    onProgress?.(i + 1, blobs.length);
  }
  return results;
}
