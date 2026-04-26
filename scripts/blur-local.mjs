#!/usr/bin/env node
/**
 * 기존 사진 일괄 블러 처리 (로컬 PC에서 실행)
 *
 * 사용법:
 *   cd patrol-platform
 *   node scripts/blur-local.mjs --server https://patrol.ai.kr --cookie "session=..."
 *
 * 옵션:
 *   --server   서버 URL (기본: https://patrol.ai.kr)
 *   --cookie   인증 쿠키 (브라우저 DevTools → Application → Cookies에서 복사)
 *   --date     특정 날짜만 (예: 2026-04-06)
 *   --dry      처리만 하고 업로드 안 함 (테스트용)
 */

import tf from "@tensorflow/tfjs";
import wasmBackend from "@tensorflow/tfjs-backend-wasm";
import faceapi from "@vladmandic/face-api/dist/face-api.node-wasm.js";
import canvas from "canvas";
import sharp from "sharp";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// CLI 인자 파싱
const args = process.argv.slice(2);
function getArg(name, def) {
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 && args[idx + 1] ? args[idx + 1] : def;
}
const SERVER = getArg("server", "https://patrol.ai.kr");
const COOKIE = getArg("cookie", "");
const TARGET_DATE = getArg("date", "");
const DRY_RUN = args.includes("--dry");

if (!COOKIE) {
  console.error("❌ --cookie 필수. 브라우저 DevTools → Application → Cookies에서 session 쿠키를 복사하세요.");
  console.error('   예: node scripts/blur-local.mjs --cookie "connect.sid=s%3A..."');
  process.exit(1);
}

// face-api 초기화
faceapi.env.monkeyPatch({
  Canvas: canvas.Canvas,
  Image: canvas.Image,
  ImageData: canvas.ImageData,
});

async function initModels() {
  await tf.setBackend("wasm");
  await tf.ready();
  const modelPath = path.join(__dirname, "..", "models", "face-api");
  await faceapi.nets.ssdMobilenetv1.loadFromDisk(modelPath);
  await faceapi.nets.tinyFaceDetector.loadFromDisk(modelPath);
  console.log("✅ 모델 로드 완료 (SSD + TinyFaceDetector)");
}

async function detectFaces(imageBuffer) {
  const resized = await sharp(imageBuffer)
    .resize(608, 608, { fit: "inside" })
    .jpeg({ quality: 70 })
    .toBuffer();

  const img = await canvas.loadImage(resized);
  const c = canvas.createCanvas(img.width, img.height);
  c.getContext("2d").drawImage(img, 0, 0);

  const [ssdDets, tinyDets] = await Promise.all([
    faceapi.detectAllFaces(c, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.25 })),
    faceapi.detectAllFaces(c, new faceapi.TinyFaceDetectorOptions({ inputSize: 608, scoreThreshold: 0.25 })),
  ]);

  const meta = await sharp(imageBuffer).metadata();
  const origW = meta.width || 1280;
  const origH = meta.height || 960;
  const scaleX = origW / img.width;
  const scaleY = origH / img.height;

  const allDets = [...ssdDets, ...tinyDets];
  const faces = [];

  for (const d of allDets) {
    const f = {
      x: d.box.x * scaleX,
      y: d.box.y * scaleY,
      w: d.box.width * scaleX,
      h: d.box.height * scaleY,
    };
    // 면적 30% 이상 = 오감지
    if ((f.w * f.h) / (origW * origH) >= 0.3) continue;
    // 중복 제거
    const overlap = faces.some((m) => {
      const ox = Math.max(0, Math.min(m.x + m.w, f.x + f.w) - Math.max(m.x, f.x));
      const oy = Math.max(0, Math.min(m.y + m.h, f.y + f.h) - Math.max(m.y, f.y));
      const inter = ox * oy;
      const smaller = Math.min(m.w * m.h, f.w * f.h);
      return smaller > 0 && inter / smaller > 0.5;
    });
    if (!overlap) faces.push(f);
  }

  return faces;
}

async function blurFaces(imageBuffer, faces) {
  if (faces.length === 0) return imageBuffer;

  const meta = await sharp(imageBuffer).metadata();
  const imgW = meta.width || 1280;
  const imgH = meta.height || 960;
  const composites = [];

  for (const f of faces) {
    const margin = 0.1;
    const left = Math.max(0, Math.round(f.x - f.w * margin));
    const top = Math.max(0, Math.round(f.y - f.h * margin));
    const width = Math.min(imgW - left, Math.round(f.w * (1 + margin * 2)));
    const height = Math.min(imgH - top, Math.round(f.h * (1 + margin * 2)));
    if (width < 10 || height < 10) continue;

    const blurred = await sharp(imageBuffer)
      .extract({ left, top, width, height })
      .blur(Math.max(15, Math.round(Math.min(width, height) / 3)))
      .toBuffer();
    composites.push({ input: blurred, left, top });
  }

  if (composites.length === 0) return imageBuffer;
  return sharp(imageBuffer).composite(composites).jpeg({ quality: 85 }).toBuffer();
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: { Cookie: COOKIE } });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.json();
}

async function main() {
  await initModels();

  // 미처리 현황 조회
  const statusUrl = TARGET_DATE
    ? `${SERVER}/api/admin/blur-existing?date=${TARGET_DATE}`
    : `${SERVER}/api/admin/blur-existing`;
  const status = await fetchJson(statusUrl);

  if (TARGET_DATE) {
    console.log(`📋 ${TARGET_DATE}: 미처리 ${status.remaining}장`);
  } else {
    console.log(`📋 전체 미처리: ${status.remaining}장`);
    if (status.dates) {
      for (const d of status.dates.filter((d) => d.remaining > 0)) {
        console.log(`   ${d.date}: ${d.remaining}장`);
      }
    }
  }

  if (status.remaining === 0) {
    console.log("✅ 모든 사진 블러 처리 완료");
    return;
  }

  // 날짜별 처리
  const datesToProcess = TARGET_DATE
    ? [{ date: TARGET_DATE, remaining: status.remaining }]
    : (status.dates || []).filter((d) => d.remaining > 0);

  let totalProcessed = 0;
  let totalBlurred = 0;

  for (const dateInfo of datesToProcess) {
    console.log(`\n🔄 ${dateInfo.date} (${dateInfo.remaining}장)`);

    // 해당 날짜의 entries 조회 → photoUrls 수집
    const entries = await fetchJson(`${SERVER}/api/entries/by-date?date=${dateInfo.date}`);
    const allUrls = [];
    for (const e of entries.entries || []) {
      for (const url of e.photoUrls || []) {
        allUrls.push(url);
      }
    }

    let processed = 0;
    let blurred = 0;

    for (const photoUrl of allUrls) {
      // 원본 다운로드
      const fullUrl = `${SERVER}${photoUrl}?original=true`;
      try {
        const res = await fetch(fullUrl, { headers: { Cookie: COOKIE } });
        if (!res.ok) continue;
        const buf = Buffer.from(await res.arrayBuffer());

        // 얼굴 감지
        const faces = await detectFaces(buf);

        // 블러 처리
        const blurredBuf = await blurFaces(buf, faces);
        const wasBlurred = blurredBuf !== buf;

        if (!DRY_RUN) {
          // 서버에 _blur 업로드
          const relPath = photoUrl.replace("/api/uploads/", "");
          const uploadRes = await fetch(`${SERVER}/api/admin/blur-existing`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Cookie: COOKIE,
            },
            body: JSON.stringify({
              path: relPath,
              data: blurredBuf.toString("base64"),
            }),
          });
          if (!uploadRes.ok) {
            console.error(`   ❌ 업로드 실패: ${relPath}`);
            continue;
          }
        }

        processed++;
        if (wasBlurred) blurred++;

        if (processed % 10 === 0) {
          process.stdout.write(`   ${processed}/${allUrls.length} (블러 ${blurred})\r`);
        }
      } catch (e) {
        // skip
      }
    }

    console.log(`   ✅ ${processed}장 처리 (블러 ${blurred} + 감지없음 ${processed - blurred})`);
    totalProcessed += processed;
    totalBlurred += blurred;
  }

  console.log(`\n🎉 완료: ${totalProcessed}장 처리 (블러 ${totalBlurred})`);
}

main().catch((e) => {
  console.error("❌ 오류:", e.message);
  process.exit(1);
});
