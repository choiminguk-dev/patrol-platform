import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { queryMany } from "@/lib/db";
import { readFile } from "fs/promises";
import { join } from "path";
import sharp from "sharp";
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();
const UPLOAD_DIR = join(process.cwd(), "uploads");
const CHUNK_SIZE = 10; // AI 그룹핑 정확도 최적점 (5는 과분할, 15는 과소분할)

const KNOWN_STREETS = [
  "후암로", "후암로23길", "후암로13가길", "후암로28가길", "후암로34가길", "후암로57길",
  "한강대로104길", "한강대로104라길",
  "두텁바위로", "두텁바위로1길", "두텁바위로1가길", "두텁바위로35길", "두텁바위로47길", "두텁바위로55길",
  "신흥로", "신흥로20길",
];

const SYSTEM_PROMPT = `당신은 환경순찰 사진의 주소판 OCR 전문 AI입니다.

한국 도로명주소 표지판 형식:
- 파란색 오각형 표지판
- 상단: 도로명 (예: 한강대로104라길, 후암로57길)
- 하단: 건물번호 (예: 30-16, 5, 155)
- 영문 표기도 참고 (예: Hangang-daero 104ra-gil, Duteobawi-ro)
- 전체 주소 = 도로명 + 건물번호 (예: "한강대로104라길 30-16")

이 지역(후암동)의 자주 등장하는 도로명 (참고 목록 — 전부는 아님):
후암로, 후암로23길, 후암로13가길, 후암로28가길, 후암로34가길, 후암로57길,
한강대로104길, 한강대로104라길,
두텁바위로, 두텁바위로1길, 두텁바위로1가길, 두텁바위로35길, 두텁바위로47길, 두텁바위로55길,
신흥로, 신흥로20길

★ 도로명 처리 원칙:
1. **OCR 결과를 그대로 신뢰하세요.** 파란 표지판에서 명확히 읽은 도로명은 위 목록에 없어도 절대 strip하거나 변경하지 마세요.
   - 예: "후암로4길 41" → 그대로 "후암로4길 41" (위 목록에 없다고 "후암로 41"로 줄이면 안 됨)
   - 예: "두텁바위로40길 15" → 그대로 (40길이 목록에 없어도 OCR 신뢰)
   - 예: "두텁바위로38길 7" → 그대로
2. 위 목록은 **자주 등장하는 도로명 참고용**이지 화이트리스트가 아닙니다. 후암동에는 더 많은 도로가 있습니다.
3. 가장 유사한 도로명으로 교정하지 마세요. 잘못된 strip이 더 큰 오류입니다.
4. 1가길/1길, 28가길/13가길 등 비슷한 도로명은 OCR 그대로 정확히 구분만 해주세요.

★★★ 절대 금지 (가장 중요):
- 주소판이 보이지 않는 사진에서 주소를 **추측하거나 지어내지** 마세요.
- 작업사진(쓰레기/도로/사람만 있는 사진)만 있으면 그 그룹의 address는 빈 문자열("")로 두세요.
- 추측한 주소는 아예 없는 것보다 훨씬 위험합니다.
- OCR로 읽은 도로명을 강제로 KNOWN 목록에 맞추지 마세요. 그대로가 정답입니다.

★★★ 간판/상호명과 주소판 구분 (매우 중요):
- **파란색 표지판(도로명 주소판)**에서만 주소를 읽으세요.
- 빨간색/흰색/노란색 간판에 적힌 글자는 절대 주소가 아닙니다.
  예: "부동산", "강미애", "성실민증", "치킨", "편의점" → 상호명/사람이름 → 무시
- 전화번호(010-XXXX, 02-XXX)도 주소가 아닙니다.
- 주소는 반드시 **파란색 바탕 + 흰색 글자 + 오각형/사각형 표지판** 에서만 읽으세요.
- 파란 표지판의 도로명이 너무 작아서 안 읽히면, 건물번호(큰 숫자)만 적고 도로명은 빈칸으로 두세요.
  예: 건물번호 "12"만 보이면 → address: "12" (도로명 추측 금지)

★ OCR 주의사항:
- **한글 도로명을 우선 읽으세요.** 영문(Huam-ro, Sinheung-ro 등)은 보조 확인용입니다.
  한글과 영문이 다르게 읽히면 한글을 신뢰하세요.
- 주요 영문-한글 매핑:
  Huam-ro = 후암로 (Huam ≠ Sinheung!)
  Duteobawi-ro = 두텁바위로
  Sinheung-ro = 신흥로
  Hangang-daero = 한강대로
  이 영문들을 서로 혼동하지 마세요. 철자를 정확히 확인하세요.
- 건물번호가 3자리(예: 155)이면 그대로 적으세요.
  155는 건물번호 155입니다. "55길 2"로 분해하면 안 됩니다!
  올바른 예: "두텁바위로 155" (O) / "두텁바위로55길 2" (X)
- 도로명의 숫자(1길, 35길, 47길, 55길)를 정확히 구분하세요.
  표지판 상단의 작은 글자를 꼼꼼히 읽으세요.
- 두텁바위로 본도로(두텁바위로)의 건물번호는 100 이상(예: 155)입니다.
  건물번호가 작으면(2, 9-1, 86 등) 반드시 "두텁바위로XX길"인지 확인하세요.

★ 구역 참고사진 vs 실제 주소판 (매우 중요):
- 구역 참고사진은 "이 구역 근처는 이런 배경"이라는 힌트일 뿐입니다.
- **파란 주소판이 보이면 반드시 주소판에서 읽은 주소를 사용하세요.**
- 구역 참고사진의 배경과 비슷해도, 주소판에 다른 주소가 적혀 있으면 주소판이 정답입니다.
- 구역 주소를 참고사진 유사도만으로 할당하지 마세요. 주소판 OCR이 최우선입니다.

★★★ 핵심 원칙 — 그룹 분할이 가장 중요한 작업입니다:
- **의심스러우면 합치지 말고 나누세요.** 2개 그룹으로 분리한 것을 사용자가 합치는 건 쉽지만, 잘못 합친 1개를 나누는 건 번거롭습니다.
- 배경(건물, 골목, 간판)이 확연히 바뀌면 → 다른 위치 → 다른 그룹
- 같은 도로명이라도 건물번호가 다르면 → 다른 위치 → 다른 그룹
- 주소판이 없어도 배경이 달라지면 분할하세요. address는 빈 문자열로 두면 됩니다.
- 하나의 그룹은 보통 **2~5장**입니다. 6장 이상이면 분할 포인트를 놓친 건 아닌지 재확인하세요.

사진 촬영 패턴:
공무관이 청소 구역을 순회하며 찍는 순서:
  1) 작업사진 1~4장 (쓰레받기, 거리 모습, 쓰레기 등) — 한 위치에서
  2) 주소판 사진 1장 (그 위치를 증명) — 파란색 도로명 표지판
  3) 다음 위치로 이동 → 1)부터 반복
→ 주소판은 각 그룹의 **마지막 사진**입니다.
→ 주소판 **앞의** 작업사진들 + 주소판 = 하나의 그룹
→ 주소판 **뒤의** 사진은 다음 그룹에 속합니다.
→ 주소판만 단독 1장 그룹 금지 — 반드시 앞 작업사진과 합치세요.
→ 27장에 주소판이 6~8개면 → 6~8개 그룹이 정상입니다.

★ 시각적 분할 단서 (주소판이 없어도 적용):
- 주변 건물/간판/상점이 바뀌면 → 다른 위치
- 도로 폭/재질이 바뀌면(큰 도로 → 좁은 골목) → 다른 위치
- 랜드마크가 보이면(마트, 아파트, 도서관, 학교 등) → 해당 위치 식별 단서
- 연속 사진인데 명백히 같은 현장 배경이면 → 같은 그룹

분석 규칙:
1. 주소판 사진을 찾으면 도로명 + 건물번호를 정확히 읽으세요
2. 주소판 **앞에 있는** 작업사진들을 같은 그룹으로 묶으세요 (이전 주소판 이후부터 현재 주소판까지)
3. 영문 표기(Hangang-daero, Duteobawi-ro 등)가 보이면 한글 도로명 확인에 활용하세요
4. 확인할 수 없는 글자는 추측하지 말고 읽히는 그대로 적으세요
5. 건물번호를 정확히 읽으세요 — 5/7/9 등 비슷한 숫자를 혼동하지 마세요
6. ★★ 각 주소판마다 반드시 별도의 그룹을 만드세요!
   - 10장 안에 주소판이 2개 있으면 → 2개 그룹으로 분할
   - 도로명이 다른 주소판 = 다른 위치 = 다른 그룹
   - 같은 도로명이라도 건물번호가 다르면 → 다른 그룹!
7. 주소판이 아닌 사진에서 주소를 추측하지 마세요 — 파란색 표지판에서만 읽으세요
8. **건물번호를 반드시 포함하세요**. "후암로" (X) → "후암로 32-6" (O)
9. 주소판이 작거나 멀어서 안 보이면 파란색 사각형 안의 모든 글자/숫자를 읽어주세요.
10. ★★★ 구역 목록이 제공된 경우, 사진의 배경/랜드마크가 구역의 landmark와 일치하면 해당 구역으로 매칭하세요.
    예: "용산도서관" 건물이 보이면 → 용산도서관 구역, "남산마트" 간판이 보이면 → 남산마트 구역

JSON 형식으로만 응답:
{"groups":[{"address":"도로명 건물번호","photoIndices":[1,2,3],"description":"현장 상황 한줄 설명","zoneSeqNo":1,"reasoning":"사진 3에서 파란 표지판 '두텁바위로 155' 확인. 사진 1-2는 같은 골목 배경이므로 동일 그룹."}]}

- photoIndices는 사진 라벨의 번호를 그대로 사용하세요.
- zoneSeqNo는 상습지역 구역 목록이 제공된 경우에만 포함 (연번 숫자 또는 null).
- 구역 목록에 없거나 확실하지 않으면 zoneSeqNo: null.
- reasoning: 1~2문장으로 어떤 사진의 무엇을 보고 이 주소/그룹을 결정했는지 기록.`;

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "인증 필요" }, { status: 401 });

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ groups: [] });
  }

  const { photoUrls, count, category } = await request.json();
  if (!photoUrls?.length) return NextResponse.json({ groups: [] });

  // 주소 보정 힌트
  let addrHint = `\n\n주소 보정 필수:
- "우암로" → 정확한 표기는 "후암로"
- "두턴바위로" → 정확한 표기는 "두텁바위로"
이 지역의 모든 도로명에서 위 보정을 적용하세요.`;
  try {
    const recentAddresses = await queryMany<{ addressText: string }>(
      `SELECT "addressText" FROM patrol_entries
       WHERE "addressText" IS NOT NULL AND "addressText" != ''
       AND "createdAt" > NOW() - INTERVAL '30 days'
       GROUP BY "addressText"
       ORDER BY MAX("createdAt") DESC LIMIT 20`
    );
    if (recentAddresses.length > 0) {
      addrHint += `\n참고 - 최근 등록된 주소: ${recentAddresses.map((a) => a.addressText).join(", ")}`;
    }
  } catch { /* 무시 */ }

  // 사용자 정정 학습: 과거 정정 패턴 상위 10개 (자동 적용)
  try {
    const corrections = await queryMany<{ originalAddress: string; correctedAddress: string; frequency: number }>(
      `SELECT "originalAddress", "correctedAddress", frequency
       FROM address_corrections
       WHERE "tenantId" = 'huam'
       ORDER BY frequency DESC, "lastSeenAt" DESC
       LIMIT 10`
    );
    if (corrections.length > 0) {
      addrHint += `\n\n★★★ 사용자 정정 학습 (자동 반영 — 과거 같은 실수 반복 금지):`;
      for (const c of corrections) {
        addrHint += `\n- "${c.originalAddress}" → "${c.correctedAddress}" (${c.frequency}회 정정됨)`;
      }
      addrHint += `\n위 패턴이 보이면 우측 정정 결과를 즉시 적용하세요.`;
    }
  } catch { /* 무시 */ }

  // Zone 목록 조회 (Phase B: 자동 분류용)
  // category 지정 시: NULL(모든 카테고리) + 해당 카테고리 zones
  // 미지정 시: 모든 zones (하위 호환)
  let zones: Array<{ id: string; seqNo: number; address: string; landmark: string; notes: string | null; referencePhotoUrls: string[]; category: string | null }> = [];
  try {
    if (category) {
      zones = await queryMany(
        `SELECT id, "seqNo", address, landmark, notes, "referencePhotoUrls", category
         FROM patrol_zones
         WHERE "tenantId" = 'huam' AND (category IS NULL OR category = $1)
         ORDER BY "seqNo"`,
        [category]
      );
    } else {
      zones = await queryMany(
        `SELECT id, "seqNo", address, landmark, notes, "referencePhotoUrls", category
         FROM patrol_zones
         WHERE "tenantId" = 'huam'
         ORDER BY "seqNo"`
      );
    }
  } catch { /* 무시 */ }

  let zoneHint = "";
  if (zones.length > 0) {
    zoneHint = `\n\n★★★ 상습지역 구역 목록 (등록된 ${zones.length}개):
각 그룹에 가장 적합한 zoneSeqNo(구역 연번)를 응답에 포함하세요.

${zones.map((z) => `[${z.seqNo}] ${z.address} — 랜드마크: "${z.landmark}"${z.notes ? ` (${z.notes})` : ""}`).join("\n")}

★★ 매칭 기준 (우선순위):
1. 파란 주소판 OCR → 구역 주소의 도로명과 일치하면 매칭
2. ★ 사진에 랜드마크(건물명, 간판, 시설물)가 보이면 → 위 목록의 "랜드마크"와 대조
   예: "남산마트" 간판 → 해당 구역, "용산도서관" 건물 → 해당 구역
   같은 구역이라도 다른 위치에서 찍은 사진은 별도 그룹!
3. 주소판이 보이는데 구역 주소와 다르면 → 주소판이 정답 (구역 무시)
4. 불확실하면 zoneSeqNo: null

★★★ 하나의 순찰에서 같은 구역을 여러 번 방문할 수 있습니다.
같은 zoneSeqNo가 여러 그룹에 등장해도 정상입니다 — 각 방문은 별도 그룹으로 유지하세요.`;
  }

  // Phase C-2 학습: 각 구역의 최근 참고사진 2장을 320px 썸네일로 준비
  const zoneRefImages: { zoneSeqNo: number; landmark: string; thumbs: Buffer[] }[] = [];
  for (const z of zones) {
    if (!z.referencePhotoUrls?.length) continue;
    const latest = z.referencePhotoUrls.slice(-2); // 최근 2장
    const thumbs: Buffer[] = [];
    for (const url of latest) {
      const relPath = url.replace(/^\/api\/uploads\//, "");
      const filePath = join(UPLOAD_DIR, relPath);
      try {
        const data = await readFile(filePath);
        const thumb = await sharp(data)
          .resize(320, 320, { fit: "inside" })
          .jpeg({ quality: 60 })
          .toBuffer();
        thumbs.push(thumb);
      } catch { /* 파일 없으면 skip */ }
    }
    if (thumbs.length > 0) {
      zoneRefImages.push({ zoneSeqNo: z.seqNo, landmark: z.landmark, thumbs });
    }
  }

  try {
    const totalPhotos = photoUrls.length;
    const allGroups: any[] = [];

    // 15장씩 청크로 분할 분석
    for (let chunkStart = 0; chunkStart < totalPhotos; chunkStart += CHUNK_SIZE) {
      const chunkEnd = Math.min(chunkStart + CHUNK_SIZE, totalPhotos);

      // 1) 이미지 파일 읽기
      const rawImages: { index: number; buffer: Buffer }[] = [];
      for (let i = chunkStart; i < chunkEnd; i++) {
        const url = photoUrls[i] as string;
        const relativePath = url.replace(/^\/api\/uploads\//, "");
        const filePath = join(UPLOAD_DIR, relativePath);
        try {
          const data = await readFile(filePath);
          rawImages.push({ index: i + 1, buffer: data });
        } catch { /* 파일 없음 */ }
      }

      // 2) OCR용 이미지: _blur 우선 → 800px 리사이즈 (속도 + 토큰 절약)
      const ocrBuffers: Buffer[] = [];
      for (let k = 0; k < rawImages.length; k++) {
        const origUrl = photoUrls[chunkStart + k] as string;
        const relPath = origUrl.replace(/^\/api\/uploads\//, "");
        const ext = relPath.split(".").pop() || "jpg";
        const blurPath = join(UPLOAD_DIR, relPath.replace(`.${ext}`, `_blur.${ext}`));
        let srcBuf: Buffer;
        try {
          srcBuf = await readFile(blurPath);
        } catch {
          srcBuf = rawImages[k].buffer;
        }
        const resized = await sharp(srcBuf)
          .resize(1280, 1280, { fit: "inside" })
          .jpeg({ quality: 75 })
          .toBuffer();
        ocrBuffers.push(resized);
      }

      // 3) 이미지로 API 콘텐츠 구성
      const content: Anthropic.MessageParam["content"] = [];

      // Phase C-2: 구역별 참고사진 — 첫 청크에만 포함 (속도 최적화)
      if (zoneRefImages.length > 0 && chunkStart === 0) {
        content.push({
          type: "text",
          text: "★ 구역별 참고사진 (과거 정확하게 매칭된 사례) — 새 사진이 시각적으로 유사하면 같은 구역으로 매칭:",
        });
        for (const ref of zoneRefImages) {
          for (const thumb of ref.thumbs) {
            content.push(
              { type: "image", source: { type: "base64", media_type: "image/jpeg", data: thumb.toString("base64") } },
              { type: "text", text: `[구역 ${ref.zoneSeqNo} 참고: ${ref.landmark}]` }
            );
          }
        }
        content.push({ type: "text", text: "─── 위는 참고용. 아래부터 분석할 사진 ───" });
      }

      for (let j = 0; j < rawImages.length; j++) {
        content.push(
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data: ocrBuffers[j].toString("base64") } },
          { type: "text", text: `[사진 ${rawImages[j].index}]` }
        );
      }
      // 파일 없는 사진 표시
      for (let i = chunkStart; i < chunkEnd; i++) {
        if (!rawImages.find((img) => img.index === i + 1)) {
          content.push({ type: "text", text: `[사진 ${i + 1} — 파일 없음]` });
        }
      }

      // 이전 청크 주소를 텍스트로만 전달
      const prevAddresses = allGroups.map((g) => g.address).filter(Boolean);
      const prevNote = prevAddresses.length > 0
        ? `\n이전 사진에서 발견된 주소: ${prevAddresses.join(", ")}. 참고만 하세요 — 이번 사진의 주소판은 독립적으로 읽으세요.`
        : "";

      content.push({
        type: "text",
        text: `전체 ${totalPhotos}장 중 사진 ${chunkStart + 1}~${chunkEnd}번입니다.${prevNote}\n주소판을 정확히 읽고 사진을 그룹으로 묶어주세요.${addrHint}${zoneHint}`,
      });

      let text = "";
      try {
        const response = await client.messages.create({
          model: "claude-sonnet-4-6",
          max_tokens: 4000,
          system: SYSTEM_PROMPT,
          messages: [{ role: "user", content }],
        });
        text = response.content[0].type === "text" ? response.content[0].text : "";
      } catch (apiErr) {
        console.error(`[analyze] chunk ${chunkStart + 1}-${chunkEnd} API 오류:`, apiErr instanceof Error ? apiErr.message : apiErr);
        continue; // 이 청크 스킵, 다음 청크 계속
      }

      try {
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : text);
        if (parsed.groups?.length > 0) {
          allGroups.push(...parsed.groups);
        }
        console.log(`[analyze] chunk ${chunkStart + 1}-${chunkEnd}: AI returned ${parsed.groups?.length || 0} groups:`,
          JSON.stringify((parsed.groups || []).map((g: any) => ({ addr: g.address, photos: g.photoIndices }))));
      } catch { console.error(`[analyze] chunk ${chunkStart + 1}-${chunkEnd} JSON 파싱 실패`); }
    }

    console.log(`[analyze] AI 총 ${allGroups.length}개 그룹 (후처리 전)`);

    // 후처리 1: 도로명 검증 + 교정
    for (const g of allGroups) {
      if (g.address) {
        g.address = correctAddress(g.address);
      }
    }

    // 후처리 2: 1장짜리 주소판을 앞 작업사진(주소 없는) 그룹에 병합
    // 연속 주소판이 있으면 마지막 주소판이 우선 (촬영 패턴: 작업→주소판은 마지막)
    // 앞→뒤로 순회: 뒤에 또 주소판이 있으면 현재는 스킵
    for (let i = 0; i < allGroups.length; i++) {
      const curr = allGroups[i];
      if (curr.photoIndices.length !== 1) continue;
      if (!curr.address) continue;
      const currIdx = curr.photoIndices[0];

      // 뒤에 또 1장짜리 주소판이 바로 있으면 → 현재 스킵 (뒤 주소판이 작업사진의 진짜 주소)
      if (i + 1 < allGroups.length) {
        const next = allGroups[i + 1];
        if (next.photoIndices.length === 1 && next.address) continue;
      }

      // 앞 그룹이 주소 없는 작업사진이면 병합
      if (i > 0) {
        const prev = allGroups[i - 1];
        const prevMax = Math.max(...prev.photoIndices);
        if (currIdx - prevMax <= 2 && !prev.address) {
          prev.photoIndices.push(currIdx);
          prev.photoIndices.sort((a: number, b: number) => a - b);
          prev.address = curr.address;
          prev.reasoning = curr.reasoning;
          prev.zoneSeqNo = curr.zoneSeqNo;
          allGroups.splice(i, 1);
          i--; // 삭제 후 인덱스 보정
        }
      }
    }

    // 후처리 2.3: 인접한 같은 zone 그룹 병합 (사진 번호 연속)
    // 예: zone=후암종점(9,10) + zone=후암종점(11,12) → 하나로 합침
    for (let i = allGroups.length - 1; i > 0; i--) {
      const curr = allGroups[i];
      const prev = allGroups[i - 1];
      if (!curr.zoneSeqNo || !prev.zoneSeqNo) continue;
      if (curr.zoneSeqNo !== prev.zoneSeqNo) continue;
      const prevMax = Math.max(...prev.photoIndices);
      const currMin = Math.min(...curr.photoIndices);
      if (currMin - prevMax <= 3) {
        prev.photoIndices.push(...curr.photoIndices);
        prev.photoIndices.sort((a: number, b: number) => a - b);
        if (curr.address && !prev.address) prev.address = curr.address;
        if (!prev.description && curr.description) prev.description = curr.description;
        allGroups.splice(i, 1);
      }
    }

    // 후처리 2.5: 7장 이상 그룹은 별도 플래그 (description 오염 X)
    for (const g of allGroups) {
      if (g.photoIndices.length >= 7) {
        g.needsReview = true;
      }
    }

    // 후처리 2.6: zoneSeqNo → zoneId 매핑 + 주소로 폴백 자동 매칭
    const zoneBySeqNo = new Map(zones.map((z) => [z.seqNo, z]));
    const zoneByAddress = new Map(zones.map((z) => [z.address.replace(/\s/g, ""), z]));
    for (const g of allGroups) {
      let matchedZone: typeof zones[number] | undefined;

      // 1) AI가 명시적으로 zoneSeqNo를 준 경우
      if (typeof g.zoneSeqNo === "number") {
        matchedZone = zoneBySeqNo.get(g.zoneSeqNo);
      }

      // 2) 주소가 구역 주소와 일치하면 자동 매칭
      if (!matchedZone && g.address) {
        const normalized = g.address.replace(/\s/g, "");
        // 완전 일치
        matchedZone = zoneByAddress.get(normalized);
        // 도로명 일치 (건물번호 차이 허용): "두텁바위로47길 9-1" → "두텁바위로47길"
        if (!matchedZone) {
          const roadName = g.address.replace(/\s*\d[\d\-]*$/, "").replace(/\s/g, "");
          for (const [zAddr, z] of zoneByAddress) {
            const zRoad = z.address.replace(/\s*\d[\d\-]*$/, "").replace(/\s/g, "");
            if (roadName && zRoad && roadName === zRoad) {
              matchedZone = z;
              break;
            }
          }
        }
      }

      if (matchedZone) {
        g.zoneId = matchedZone.id;
        g.zoneSeqNo = matchedZone.seqNo;
        g.zoneLandmark = matchedZone.landmark;
      } else {
        g.zoneId = null;
        g.zoneSeqNo = null;
        g.zoneLandmark = null;
      }
    }

    // 후처리 3: 동일 주소 + 인접한 사진 순서만 병합
    // 같은 주소라도 사진 번호가 5장 이상 떨어져 있으면 별도 현장
    for (let i = allGroups.length - 1; i > 0; i--) {
      const curr = allGroups[i];
      const prev = allGroups[i - 1];

      if (curr.address && prev.address && curr.address === prev.address) {
        const prevMax = Math.max(...prev.photoIndices);
        const currMin = Math.min(...curr.photoIndices);
        if (currMin - prevMax <= 3) {
          prev.photoIndices.push(...curr.photoIndices);
          prev.photoIndices.sort((a: number, b: number) => a - b);
          if (curr.description && !prev.description.includes(curr.description)) {
            prev.description += `, ${curr.description}`;
          }
          allGroups.splice(i, 1);
        }
      }
    }

    // 후처리 3.5: 한 그룹 안에 서로 다른 도로명 주소판이 있으면 분할
    // 예: 드림캐슬(두텁바위로47길) + 한강대로102길 57 → 두 그룹으로 분리
    {
      const extractRoad = (addr: string): string => {
        // "두텁바위로47길 9-1" → "두텁바위로47길", "한강대로102길 57" → "한강대로102길"
        const m = addr.match(/^(.+?(?:길|로|대로))\s*\d/);
        return m ? m[1] : addr.replace(/\s*\d[\d\-]*$/, "");
      };

      for (let i = allGroups.length - 1; i >= 0; i--) {
        const g = allGroups[i];
        if (!g.address || g.photoIndices.length <= 1) continue;

        // 이 그룹의 주소와 zone 주소의 도로명 비교
        const groupRoad = extractRoad(g.address);

        // zoneId가 있으면 zone 주소 확인
        if (g.zoneId) {
          const zone = zones.find((z) => z.id === g.zoneId);
          if (zone) {
            const zoneRoad = extractRoad(zone.address);
            if (groupRoad && zoneRoad && groupRoad !== zoneRoad) {
              // 도로명 불일치 → zone에서 분리 (주소판이 다른 위치)
              g.zoneId = null;
              g.zoneSeqNo = null;
              g.zoneLandmark = null;
            }
          }
        }
      }
    }

    // 후처리 4 제거 — 크로스-청크 병합이 다른 방문을 합쳐서 오류 유발
    // 인접 same-zone 병합(2.3)과 인접 same-address 병합(3)이 이미 충분

    // 첫 photoIndex 기준으로 정렬 (UI 자연 순서)
    allGroups.sort((a, b) => Math.min(...a.photoIndices) - Math.min(...b.photoIndices));

    console.log(`[analyze] 후처리 후 ${allGroups.length}개 그룹:`,
      JSON.stringify(allGroups.map((g: any) => ({ addr: g.address, photos: g.photoIndices.length, zone: g.zoneSeqNo }))));

    return NextResponse.json({ groups: allGroups });
  } catch (e) {
    return NextResponse.json(
      { groups: [], error: e instanceof Error ? e.message : "분석 실패" },
      { status: 500 }
    );
  }
}

/** 도로명 검증 + 교정 */
function correctAddress(addr: string): string {
  // 보정 규칙: 우암로→후암로, 두턴바위로→두텁바위로
  addr = addr.replace(/우암로/g, "후암로").replace(/두턴바위로/g, "두텁바위로");

  // 도로명 + 건물번호 분리
  const match = addr.match(/^(.+?)\s+(\d[\d-]*)$/);
  if (!match) return addr;

  const [, street, building] = match;

  // 이미 알려진 도로명이면 통과 (추가 검증)
  if (KNOWN_STREETS.includes(street)) {
    // 두텁바위로 본도로인데 건물번호가 작으면 → XX길 누락 가능성 (강한 의심)
    // 본도로 33, 9-1 등은 거의 확실히 잘못된 OCR
    if (street === "두텁바위로") {
      const numStr = building.split("-")[0];
      const num = parseInt(numStr);
      if (num < 100) {
        // 본도로는 100 이상만 정상 → 빈 주소로 (사용자가 검토)
        return "";
      }
    }
    return addr;
  }

  // 두텁바위로XX길 — 1~99 번호면 KNOWN에 없어도 그대로 인정 (실제 도로 가능성)
  // 100+ 번호이거나 비정상 패턴일 때만 fuzzy 매칭
  const dt = street.match(/^(두텁바위로)(\d+)(가?)길$/);
  if (dt) {
    const num = parseInt(dt[2]);
    if (num >= 1 && num <= 99) {
      return addr; // OCR 결과 그대로 신뢰
    }
    // 100+ 번호: 비정상 → 가장 가까운 알려진 도로명으로 fuzzy 매칭 (구조 보정)
    const candidates = KNOWN_STREETS
      .filter((s) => s.startsWith("두텁바위로") && s.includes("길"))
      .map((s) => {
        const m = s.match(/(\d+)길$/);
        return m ? { street: s, diff: Math.abs(parseInt(m[1]) - num) } : null;
      })
      .filter(Boolean) as { street: string; diff: number }[];
    candidates.sort((a, b) => a.diff - b.diff);
    if (candidates.length > 0) return `${candidates[0].street} ${building}`;
  }

  // 후암로XX가길 / 후암로XX길 — 1~99 번호면 그대로 인정
  const hr = street.match(/^(후암로)(\d+)(가?)길$/);
  if (hr) {
    const num = parseInt(hr[2]);
    if (num >= 1 && num <= 99) {
      return addr; // 그대로 신뢰
    }
  }

  // 신흥로XX길 — 1~99 번호면 그대로 인정
  const sh = street.match(/^(신흥로)(\d+)길$/);
  if (sh) {
    const num = parseInt(sh[2]);
    if (num >= 1 && num <= 99) {
      return addr;
    }
  }

  // 그 외: KNOWN_STREETS에 없고 예측 불가능한 도로명은 그대로 두기
  // (과거에는 fuzzy match로 강제 변환했으나, 실제 도로명이 KNOWN보다 많을 수 있음)
  return addr;
}
