import Anthropic from "@anthropic-ai/sdk";
import { queryMany, execute } from "./db";
import { CATEGORY_MAP } from "./categories";

const client = new Anthropic();

export type DocType = "daily_log" | "weekly_report" | "fine_request" | "quarter_package" | "field_log";

const DOC_LABELS: Record<DocType, string> = {
  daily_log: "일일 순찰일지",
  weekly_report: "주간 순찰보고",
  fine_request: "과태료 부과 요청 공문",
  quarter_package: "분기 실적 패키지",
  field_log: "동 현장 점검 일지",
};

interface GenerateOptions {
  docType: DocType;
  startDate: string;
  endDate: string;
  tenantId?: string;
}

/** 기간 내 순찰 데이터 조회 */
async function fetchEntries(startDate: string, endDate: string) {
  return queryMany<{
    id: string; userId: string; userName: string; userPool: string | null;
    category: string; evalItem: string | null;
    quantity: number; unit: string; photoCount: number; memo: string | null;
    addressText: string | null; address: string | null;
    latitude: number | null; longitude: number | null;
    inputTrack: string; entryDate: string; createdAt: string;
  }>(
    `SELECT e.id, e."userId", u.name as "userName", u.pool as "userPool",
            e.category, e."evalItem", e.quantity, e.unit,
            e."photoCount", e.memo, e."addressText", e.address, e.latitude, e.longitude,
            e."inputTrack", e."entryDate", e."createdAt"
     FROM patrol_entries e
     JOIN users u ON u.id = e."userId"
     WHERE e."entryDate" >= $1 AND e."entryDate" <= $2
     ORDER BY e."entryDate", e."createdAt"`,
    [startDate, endDate]
  );
}

/** 순찰 데이터 요약 텍스트 생성 */
function summarizeEntries(entries: Awaited<ReturnType<typeof fetchEntries>>) {
  const byDate: Record<string, typeof entries> = {};
  for (const e of entries) {
    (byDate[e.entryDate] ??= []).push(e);
  }

  return Object.entries(byDate)
    .map(([date, items]) => {
      const lines = items.map((e, i) => {
        const cat = CATEGORY_MAP[e.category];
        const parts = [
          `${i + 1}. ${cat?.label || e.category} (${e.userName})`,
          `   수량: ${e.quantity}${e.unit}`,
          `   평가항목: ${cat?.eval || "별도"} (${cat?.points || 0}점)`,
          `   현장사진: ${e.photoCount}장`,
          `   입력방식: ${e.inputTrack === "batch" ? "일괄" : "실시간"}`,
        ];
        const location = e.addressText || e.address || (e.latitude ? `GPS(${e.latitude.toFixed(5)}, ${e.longitude?.toFixed(5)})` : null);
        if (location) parts.push(`   위치: ${location}`);
        if (e.memo) parts.push(`   메모: ${e.memo}`);
        if (e.createdAt) parts.push(`   시간: ${e.createdAt.slice(11, 16)}`);
        return parts.join("\n");
      });
      return `[${date}] 총 ${items.length}건\n${lines.join("\n\n")}`;
    })
    .join("\n\n");
}

const PROMPTS: Record<DocType, string> = {
  daily_log: `아래 환경순찰 데이터를 바탕으로 순찰일지를 작성하세요.
마크다운 없이 일반 텍스트로만 작성하세요.

아래 양식을 따르세요:

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
환경순찰일지 (YYYY.MM.DD ~ YYYY.MM.DD)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

【순찰 개요】
총 건수: OO건 / 현장사진: OO장
참여인원: 동장 이하 직원
주요 활동: (1줄 요약)

【순찰 상세 내역】

1. 카테고리명 — 위치(주소)
   내용: (순찰/점검 내용)
   → 조치: (조치 결과)
   사진: O장

2. 카테고리명 — 위치(주소)
   내용: (순찰/점검 내용)
   → 조치: (조치 결과)
   사진: O장

【특이사항】
(있으면 기재, 없으면 "(해당 없음)")

━━━━━━━━━━━━━━━━━━━━━━━━━━━━

중요:
- "증거사진" 대신 "현장사진"으로 표기
- 결재란 넣지 마세요
- 데이터에 없는 내용을 지어내지 마세요
- 위치(주소)를 반드시 포함하세요
- ★ "평가항목별 실적" 섹션은 포함하지 마세요 (반기 누적 지표라 일일 보고서와 무관)`,

  fine_request: `아래 무단투기 적발 데이터를 바탕으로 **과태료 부과 요청 공문**을 작성하세요.

형식:
- 수신: 용산구청 환경과장
- 제목: 생활폐기물 무단투기 과태료 부과 요청
- 근거 법령: 폐기물관리법 제68조
- 적발 내역 (일시, 장소, 위반내용, 증거사진 수)
- 요청사항
- 발신: 후암동장

공문서 양식으로 작성하세요.`,

  weekly_report: `아래 환경순찰 데이터를 바탕으로 주간 순찰보고를 작성하세요.
마크다운 없이 일반 텍스트로만 작성하세요.

아래 양식을 따르세요:

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
환경순찰 주간보고 (MM.DD ~ MM.DD)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

【주간 개요】
총 건수: OO건 (일평균 OO건)
현장사진: OO장
참여인원: 동장 이하 직원

【요일별 실적】
월(MM.DD): OO건
화(MM.DD): OO건
...
(데이터가 있는 요일만 표기)

【주요 순찰 내역】

○ 카테고리별 정리
  이면도로 청소: OO건 (주요 구간: 후암로23길, ...)
  상습지역 순찰: OO건
  (해당 항목만)

○ 주요 위치
  후암로 일대: OO건
  두텁바위로 일대: OO건

【특이사항】
(간결하게 1~2줄. 없으면 "(해당 없음)")

━━━━━━━━━━━━━━━━━━━━━━━━━━━━

중요:
- 현장사진으로 표기 (증거사진 X)
- 결재란 넣지 마세요
- 데이터에 없는 내용 지어내지 마세요
- 특이사항은 간결하게. 일상적 순찰 건은 가볍게 서술
- 다음 주 계획은 쓰지 마세요`,

  field_log: `아래 환경순찰 데이터를 바탕으로 "동 현장 점검 일지"를 작성하세요.
날짜별로 각각 1장씩 작성합니다. 여러 날이면 날짜별로 구분하여 반복합니다.

아래 양식을 정확히 따르세요 (일반 텍스트, 마크다운 없이):

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
동 현장 점검 일지
(후암동)

□ 순찰개요
  순찰일시  YYYY년 M월 D일(요일) (06:00~23:00)
  순찰지역  관내 전지역
  참여인원  동장 이하 직원

□ 순찰사항
  ○ (환경 순찰 대표 활동)
    - (세부 점검 내용)
      · (조치 결과)

□ 위험시설물 순찰사항
  ○ (위험건축물·시설물 점검 내용)
    - (세부 내용)

□ 주민소통 순찰사항
  ○ (통장/주민/경로당/홍보 등 주민 접촉 내용)
    - (조치 내용)

특이사항
  (있으면 기재, 없으면 비워둠)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

★★★ 카테고리 → 섹션 배정 규칙 (엄격히 따르세요):

[□ 순찰사항] — 일반 환경 순찰 활동 (아래 카테고리만):
  · 이면도로 청소 / 골목 청소완료 / 상습지역 순찰 / 특별관리구역
  · 무단투기 민원 / 경고장 부착 / 야간 단속 / 민원 조치완료 / 스마트경고판
  · 폐건전지 / 폐소형가전 / 투명페트병 / 특수사업
  → 모두 이 섹션에 배치. "급경사지·상습지역 집중 순찰", "이면도로 청소",
     "무단투기 민원 조치" 등 주제별로 ○ 항목 묶어서 작성.

[□ 위험시설물 순찰사항] — 시설물 점검만 (아래 카테고리만):
  · 안전점검 / 위험건축물 / 치수(수방) / 녹지(수목) / 가로등 / 제설 / 도로(관리)
  → 위 카테고리 데이터가 있을 때만 작성.
  → 데이터가 하나도 없으면 정확히 다음과 같이 1줄만 작성 (들여쓰기 2칸):
     "  (해당 사항 없음 — 안전담당 별도 기재)"
  ※ 무단투기, 청소 데이터를 절대 이 섹션에 넣지 마세요.

[□ 주민소통 순찰사항] — 주민 접촉/소통 내용만:
  · 홍보활동 / 분리배출 홍보 카테고리
  · 또는 메모(memo)에 "통장", "주민", "경로당", "마을", "주민회",
    "민원인", "이장" 등 주민 관련 키워드가 포함된 건
  → 위 조건을 충족하는 데이터가 있을 때만 작성.
  → 데이터가 하나도 없으면 정확히 다음과 같이 1줄만 작성 (들여쓰기 2칸):
     "  (해당 사항 없음)"
  ※ 일반 골목/이면도로 청소를 절대 이 섹션에 넣지 마세요 (그건 □ 순찰사항).

[기타 (etc)] → 특이사항 섹션에 한 줄로 짧게.

★★★ 무단투기 표현 규칙 (절대 위반 금지):
- "적발", "과태료 부과" 표현 절대 금지 (담당자 판단 사항)
- 대신: "무단투기 민원 조치", "현장 확인 및 환경 정비", "쓰레기 수거 및 정비"

★ 청소·순찰 데이터 요약:
- 여러 건이면 "후암로23길 외 N개소" 형태로 대표 구간 요약 (개별 나열 금지)
- 골목 청소는 위치 + 수거 내용(투기물 종류 등) 간략 기재

규칙 (★★★ 공문서 들여쓰기 — 칸 수 정확히 지킬 것):
- □ 섹션 제목: 0칸 (행 처음)
- ○ 주요 항목: 2칸 들여쓰기 ("  ○ ...")
- - 세부 내용: 4칸 들여쓰기 ("    - ...")
- · 추가 세부: 6칸 들여쓰기 ("      · ...")
- 순찰개요 하위(순찰일시/순찰지역/참여인원): 2칸 들여쓰기
- 위치(주소)를 반드시 포함
- 데이터에 없는 내용을 지어내지 마세요
- "순 찰 자" 항목은 포함하지 마세요 (별도 기재)
- 참여인원은 반드시 "동장 이하 직원"으로만 기재 (세부 직군/인원수 X)

현장사진 안내 (텍스트 끝에 추가):

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
현장사진

(사진 1) (위치 캡션)
(사진 2) (위치 캡션)
(사진 3) (위치 캡션)
(사진 4) (위치 캡션)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

현장사진은 데이터의 주요 위치 4곳을 선정하여 캡션만 작성 (실제 사진은 사용자가 붙여넣기)`,

  quarter_package: `아래 환경순찰 데이터를 바탕으로 실적 종합보고를 작성하세요.
마크다운 없이 일반 텍스트로만 작성하세요.

아래 양식을 따르세요:

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
환경순찰 실적 종합보고 (YYYY.MM.DD ~ YYYY.MM.DD)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

【총괄 요약】
총 건수: OO건
현장사진: OO장
참여인원: 동장 이하 직원

【평가항목별 실적】

  ★★★ 이 블록은 아래 "=== 평가항목별 실적 (서버 계산 완료) ===" 표를
       그대로 복사하세요. 수치·단위를 임의로 재편집하지 마세요.
       - 배점은 항목별 "총 배점"이며, 건당 점수가 아닙니다.
       - "X점/건" 같은 건당 표기로 바꾸지 마세요.
       - 합계 줄도 그대로 유지하세요.

  (서버 계산 표 붙여넣기 위치)

【카테고리별 실적】

  이면도로 청소: OO건
  상습지역 순찰: OO건
  골목 청소: OO건
  ...

【주요 순찰 위치】

  후암로23길, 후암로13가길 일대: OO건
  두텁바위로 일대: OO건
  ...

【주요 성과】
○ (데이터 기반 성과 1~3개)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━

중요:
- 현장사진으로 표기 (증거사진 X)
- 결재란 넣지 마세요
- 데이터에 기반한 실적 위주로 작성
- 개선사항/계획은 쓰지 마세요`,
};

/** 평가 진척도 서버 계산 (AI에게 넘기기 전) */
async function computeEvalProgress(entries: Awaited<ReturnType<typeof fetchEntries>>) {
  // 수동 실적 로드
  const now = new Date();
  const halfKey = `${now.getFullYear()}-${now.getMonth() < 6 ? "H1" : "H2"}`;
  let manualRows: { evalItem: string; manualCount: number; note: string | null }[] = [];
  try {
    manualRows = await queryMany<{ evalItem: string; manualCount: number; note: string | null }>(
      `SELECT "evalItem", "manualCount", note FROM manual_evals WHERE "tenantId" = 'huam' AND "halfYear" = $1`,
      [halfKey]
    );
  } catch { /* 테이블 미존재 시 무시 */ }
  const manualMap = new Map(manualRows.map((m) => [m.evalItem, m]));

  // 자동 집계
  const autoCounts: Record<string, number> = {};
  for (const e of entries) {
    if (e.evalItem) autoCounts[e.evalItem] = (autoCounts[e.evalItem] || 0) + 1;
  }

  const MANUAL_ONLY = new Set([
    "과태료",
    "분리배출(폐건전지)", "분리배출(폐소형가전)", "분리배출(투명페트병)",
  ]);
  const MANUAL_PRIORITY = new Set(["경고판", "특수사업"]);

  const targets: Record<string, { maxPoints: number; target: number }> = {
    과태료: { maxPoints: 30, target: 30 },
    경고판: { maxPoints: 5, target: 10 },
    상습지역: { maxPoints: 10, target: 10 },
    현장평가: { maxPoints: 20, target: 40 },          // 0.5점/건
    "분리배출(폐건전지)": { maxPoints: 5, target: 1500 },
    "분리배출(폐소형가전)": { maxPoints: 5, target: 1500 },
    "분리배출(투명페트병)": { maxPoints: 5, target: 2000 },
    특수사업: { maxPoints: 10, target: 5 },
    홍보: { maxPoints: 10, target: 6 },
  };

  // 모든 항목 비례 계산: 건당 점수 = maxPoints / target
  const computeEarned = (count: number, t: { maxPoints: number; target: number }) => {
    const perEntry = t.target > 0 ? t.maxPoints / t.target : 0;
    const raw = Math.min(t.maxPoints, count * perEntry);
    return Math.round(raw * 10) / 10;
  };

  const resolveCount = (name: string, autoCount: number, manual?: { manualCount: number }) => {
    if (MANUAL_ONLY.has(name)) return { count: manual?.manualCount ?? 0, source: "수동" };
    if (MANUAL_PRIORITY.has(name) && manual) return { count: manual.manualCount, source: "수동" };
    return { count: autoCount, source: "자동" };
  };

  const rows: string[] = [];
  for (const [name, t] of Object.entries(targets)) {
    const autoCount = autoCounts[name] || 0;
    const manual = manualMap.get(name);
    const { count, source } = resolveCount(name, autoCount, manual || undefined);
    const earned = computeEarned(count, t);
    const note = manual?.note ? ` (${manual.note})` : "";

    rows.push(
      `  ${name.padEnd(10)} ${String(count).padStart(4)}건  배점${String(t.maxPoints).padStart(3)}점  획득${String(earned).padStart(5)}점/${t.maxPoints}점  [${source}]${note}`
    );
  }

  const totalMax = Object.values(targets).reduce((s, t) => s + t.maxPoints, 0);
  const totalEarned = Object.entries(targets).reduce((s, [name, t]) => {
    const autoCount = autoCounts[name] || 0;
    const manual = manualMap.get(name);
    const { count } = resolveCount(name, autoCount, manual || undefined);
    return s + computeEarned(count, t);
  }, 0);

  return {
    table: rows.join("\n"),
    totalMax,
    totalEarned,
    score: Math.round((totalEarned / totalMax) * 100),
  };
}

/** 문서 유형별 user content 빌더 — 평가 실적 블록은 quarter_package에만 포함 */
function buildUserContent(args: {
  prompt: string;
  docType: DocType;
  crewInfo: string;
  evalData: { table: string; totalEarned: number; totalMax: number; score: number };
  summary: string;
  startDate: string;
  endDate: string;
  entryCount: number;
}): string {
  const base = `${args.prompt}\n\n중요: 마크다운 문법 없이 일반 텍스트로만 작성하세요. 제목은 대괄호나 줄로 구분하세요.\n\n${args.crewInfo}`;

  const evalBlock =
    args.docType === "quarter_package"
      ? `\n\n=== 평가항목별 실적 (반기 누적 · 서버 계산 완료 — 이 수치를 그대로 사용하세요) ===\n${args.evalData.table}\n  합계: ${args.evalData.totalEarned}점 / ${args.evalData.totalMax}점 (${args.evalData.score}%)`
      : "";

  const dataBlock = `\n\n=== 순찰 데이터 (${args.startDate} ~ ${args.endDate}) ===\n\n${args.summary}\n\n총 ${args.entryCount}건`;

  return base + evalBlock + dataBlock;
}

/** AI 문서 생성 */
export async function generateDocument(options: GenerateOptions) {
  const entries = await fetchEntries(options.startDate, options.endDate);

  if (entries.length === 0) {
    throw new Error("해당 기간에 순찰 데이터가 없습니다");
  }

  const summary = summarizeEntries(entries);
  const evalData = await computeEvalProgress(entries);
  const prompt = PROMPTS[options.docType];

  // 참여인원: 세부 인원 구분 없이 "동장 이하 직원"으로 통일
  const crewInfo = "참여인원: 동장 이하 직원";

  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 4000,
    system: "당신은 대한민국 지방자치단체 환경 공무원을 위한 공문서 작성 AI입니다. 정확하고 격식있는 공문서를 작성합니다. 마크다운 문법(**, ##, - 등)을 절대 사용하지 마세요. 일반 텍스트와 표(탭/공백 정렬)만 사용하세요.",
    messages: [
      {
        role: "user",
        content: buildUserContent({
          prompt,
          docType: options.docType,
          crewInfo,
          evalData,
          summary,
          startDate: options.startDate,
          endDate: options.endDate,
          entryCount: entries.length,
        }),
      },
    ],
  });

  let content =
    response.content[0].type === "text" ? response.content[0].text : "";

  // AI 오타 후처리
  content = content.replace(/정소/g, "청소");

  // DB에 저장
  const docId = crypto.randomUUID();
  await execute(
    `INSERT INTO generated_docs (id, "docType", title, content, "periodStart", "periodEnd", metadata, "tenantId")
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'huam')`,
    [
      docId,
      options.docType,
      `${DOC_LABELS[options.docType]} (${options.startDate} ~ ${options.endDate})`,
      content,
      options.startDate,
      options.endDate,
      JSON.stringify({ entryCount: entries.length }),
    ]
  );

  return { id: docId, title: DOC_LABELS[options.docType], content, entryCount: entries.length };
}

/** 저장된 문서 목록 */
export async function listDocuments() {
  return queryMany(
    `SELECT id, "docType", title, "periodStart", "periodEnd", metadata, "createdAt"
     FROM generated_docs ORDER BY "createdAt" DESC LIMIT 20`
  );
}

/** 문서 상세 조회 */
export async function getDocument(id: string) {
  return queryMany(
    `SELECT * FROM generated_docs WHERE id = $1`,
    [id]
  ).then((rows) => rows[0] || null);
}
