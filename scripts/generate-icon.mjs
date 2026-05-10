/**
 * PWA 아이콘 생성 스크립트 (Replicate FLUX Dev)
 *
 * 사용법:
 *   node scripts/generate-icon.mjs <REPLICATE_API_TOKEN>
 *
 * 4장 후보 생성 → public/icons/candidate-1~4.png
 * 마음에 드는 번호 선택 후:
 *   node scripts/generate-icon.mjs pick <번호>
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const ICONS_DIR = path.join(ROOT, "public", "icons");

// ── pick 모드: 후보 중 선택 ──
if (process.argv[2] === "pick") {
  const num = process.argv[3];
  const src = path.join(ICONS_DIR, `candidate-${num}.png`);
  if (!fs.existsSync(src)) {
    console.error(`candidate-${num}.png 없음. 1~4 중 선택하세요.`);
    process.exit(1);
  }
  const buf = fs.readFileSync(src);
  fs.writeFileSync(path.join(ICONS_DIR, "icon-512.png"), buf);
  fs.writeFileSync(path.join(ROOT, "src", "app", "icon.png"), buf);
  console.log(`✅ candidate-${num}.png → icon-512.png, src/app/icon.png 적용 완료`);
  console.log(`📌 192x192 리사이즈 후 icon-192.png 저장 필요`);
  process.exit(0);
}

// ── 생성 모드 ──
const TOKEN = process.argv[2];
if (!TOKEN) {
  console.error("사용법: node scripts/generate-icon.mjs <REPLICATE_API_TOKEN>");
  console.error("       node scripts/generate-icon.mjs pick <1~4>");
  process.exit(1);
}

const PROMPT = `Cute kawaii chibi mascot character, Korean street cleaner worker.
Neon yellow-green safety vest with 2 white reflective stripes, white hard hat helmet.
Right hand holds a tall bamboo broom (longer than character height).
Left hand holds a red standing dustpan (tall handle, open-front box scoop shape, like Korean 크로바 쓰레받기).
Navy pants, black boots. Big round head, happy smiling face, rosy cheeks.
Solid pastel light green background. App icon composition, centered.
Flat vector illustration style, clean, minimal, no text, no watermark.`;

async function createPrediction(token) {
  const res = await fetch(
    "https://api.replicate.com/v1/models/black-forest-labs/flux-dev/predictions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        input: {
          prompt: PROMPT,
          aspect_ratio: "1:1",
          output_format: "png",
          num_outputs: 4,
          guidance: 3.5,
          num_inference_steps: 28,
          output_quality: 100,
        },
      }),
    }
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`API ${res.status}: ${err}`);
  }
  return res.json();
}

async function pollPrediction(token, id) {
  while (true) {
    const res = await fetch(
      `https://api.replicate.com/v1/predictions/${id}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const data = await res.json();

    if (data.status === "succeeded") return data;
    if (data.status === "failed" || data.status === "canceled") {
      throw new Error(`생성 실패: ${data.error || data.status}`);
    }

    process.stdout.write(`  상태: ${data.status}... (${data.logs?.split("\n").length || 0} steps)\r`);
    await new Promise((r) => setTimeout(r, 3000));
  }
}

async function downloadImage(url) {
  const res = await fetch(url);
  return Buffer.from(await res.arrayBuffer());
}

async function run() {
  console.log("🎨 FLUX Dev — 고품질 4장 생성 중...\n");
  console.log(`프롬프트:\n${PROMPT}\n`);

  fs.mkdirSync(ICONS_DIR, { recursive: true });

  // 1) 생성 요청
  const prediction = await createPrediction(TOKEN);
  console.log(`Prediction: ${prediction.id}\n`);

  // 2) 완료 대기
  const result = await pollPrediction(TOKEN, prediction.id);
  const urls = Array.isArray(result.output) ? result.output : [result.output];
  console.log(`\n✅ ${urls.length}장 생성 완료\n`);

  // 3) 다운로드 & 저장
  await Promise.all(
    urls.map(async (url, i) => {
      const buf = await downloadImage(url);
      const dst = path.join(ICONS_DIR, `candidate-${i + 1}.png`);
      fs.writeFileSync(dst, buf);
      console.log(`  💾 candidate-${i + 1}.png (${(buf.length / 1024).toFixed(0)}KB)`);
    })
  );

  console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📂 public/icons/ 에서 candidate-1~${urls.length}.png 확인
📌 마음에 드는 번호 선택:
   node scripts/generate-icon.mjs pick 2
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
}

run().catch((e) => {
  console.error("❌", e.message);
  process.exit(1);
});
