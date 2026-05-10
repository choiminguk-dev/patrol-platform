import Anthropic from "@anthropic-ai/sdk";
import { CATEGORIES } from "./categories";
import sharp from "sharp";

const client = new Anthropic();

const CATEGORY_LIST = CATEGORIES.map(
  (c) => `${c.id}: ${c.label} (${c.eval})`
).join("\n");

const SYSTEM_PROMPT = `당신은 환경순찰 사진 분류 AI입니다. 사진을 보고 가장 적합한 카테고리를 판별하세요.

카테고리 목록:
${CATEGORY_LIST}

각 카테고리의 대표적 사진 패턴:
- road_clean (이면도로 청소): 도로/골목 사진, 빗자루·쓰레받기·청소 도구가 보이는 장면, 청소 전후 거리 모습, 낙엽·먼지가 있는 도로, 주소판과 함께 촬영된 도로/골목, 청소 장비(빨간 쓰레받기, 대빗자루 등)
- alley_clean (골목 청소완료): 좁은 골목 청소 장면, 골목 청소 후 깨끗한 모습
- illegal_dump (무단투기 적발): 불법 투기된 쓰레기 더미, 도로변 무단 방치 폐기물, 음식물쓰레기 불법 투기
- warning_post (경고장 부착): 경고 스티커, 경고문 부착 장면
- patrol_check (상습지역 순찰): 순찰 점검 현장
- safety_check (안전점검): 안전시설 점검, 소화전, 비상구
- building_check (위험건축물): 건물 외벽 균열, 위험 구조물
- flood_control (치수/수방): 배수로, 하수구, 수방 시설
- greenery (녹지/수목): 가로수, 나무, 수목 관리, 녹지 점검
- streetlight (가로등): 가로등 점검, 파손된 조명, 보안등
- snow_removal (제설): 제설 작업, 눈 치우기, 염화칼슘 살포

핵심 규칙:
- 청소 도구(빗자루, 쓰레받기, 대걸레)가 보이면 → road_clean (confidence: high)
- 도로/골목 사진 + 청소 흔적 → road_clean (confidence: high)
- 주소판(파란 도로명 표지판)만 있는 사진 → road_clean (confidence: medium, 위치 확인용 사진)
- "기타(etc)"는 정말 어떤 카테고리에도 해당하지 않을 때만. 가능하면 구체적 카테고리로 분류하세요.
- 사진에 사람 얼굴이나 차량 번호판 → memo에 "비식별화 필요" 추가

응답 형식 (JSON만, 다른 텍스트 없이):
{"category":"카테고리_id","address":"주소 또는 null","confidence":"high|medium|low","memo":"간단한 설명"}`;

export interface ClassifyResult {
  category: string;
  address: string | null;
  confidence: "high" | "medium" | "low";
  memo: string;
  needsAnonymization: boolean;
}

/** 사진에서 주소만 추출 (주소판 OCR) */
export async function extractAddress(
  imageBase64: string,
  mediaType: "image/jpeg" | "image/png" | "image/webp" = "image/jpeg"
): Promise<string | null> {
  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 100,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: mediaType, data: imageBase64 },
          },
          { type: "text", text: "이 사진에 도로명 주소판, 건물 번호, 또는 위치를 알 수 있는 텍스트가 있으면 주소만 추출하세요. 없으면 null을 응답하세요. JSON 형식: {\"address\":\"주소\" 또는 null}" },
        ],
      },
    ],
  });

  const text = response.content[0].type === "text" ? response.content[0].text : "";
  try {
    const parsed = JSON.parse(text);
    return parsed.address || null;
  } catch {
    // JSON 파싱 실패 시 텍스트에서 주소 패턴 추출 시도
    const match = text.match(/[\uAC00-\uD7AF]+(?:로|길|대로)\s*\d+/);
    return match ? match[0] : null;
  }
}

/** 사진을 Claude Haiku로 분류 */
export async function classifyPhoto(
  imageBase64: string,
  mediaType: "image/jpeg" | "image/png" | "image/webp" = "image/jpeg",
  recentContext?: string
): Promise<ClassifyResult> {
  // OCR 정확도 우선: 원본 해상도 그대로 전송
  const safeBase64 = imageBase64;

  const userText = recentContext
    ? `이 환경순찰 사진을 분류하세요.\n\n${recentContext}`
    : "이 환경순찰 사진을 분류하세요.";

  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 200,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: mediaType, data: safeBase64 },
          },
          { type: "text", text: userText },
        ],
      },
    ],
    system: SYSTEM_PROMPT,
  });

  const text =
    response.content[0].type === "text" ? response.content[0].text : "";

  try {
    const parsed = JSON.parse(text);
    return {
      category: parsed.category || "etc",
      address: parsed.address || null,
      confidence: parsed.confidence || "low",
      memo: parsed.memo || "",
      needsAnonymization: (parsed.memo || "").includes("비식별화"),
    };
  } catch {
    return {
      category: "etc",
      address: null,
      confidence: "low",
      memo: "분류 실패",
      needsAnonymization: false,
    };
  }
}
