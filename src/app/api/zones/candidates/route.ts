import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { execute, queryMany } from "@/lib/db";

/** isDismissed 컬럼 자동 마이그레이션 (컬럼 존재 시 no-op) */
let schemaEnsured = false;
async function ensureSchema() {
  if (schemaEnsured) return;
  try {
    await execute(
      `ALTER TABLE "category_address_stats" ADD COLUMN IF NOT EXISTS "isDismissed" BOOLEAN NOT NULL DEFAULT FALSE`
    );
    schemaEnsured = true;
  } catch (err) {
    console.error("[candidates] ensureSchema fail", err);
  }
}

/**
 * 자체 학습 zone 후보 — 카테고리별 빈도 누적 주소 중 임계치 이상
 * GET /api/zones/candidates?category=road_clean&min=2
 * PATCH /api/zones/candidates — 후보 무시 처리
 */
export async function PATCH(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "인증 필요" }, { status: 401 });
  if (user.role !== "ADMIN") return NextResponse.json({ error: "관리자만 가능" }, { status: 403 });

  const { statIds } = await request.json(); // string[] - 무시할 candidate ID 배열
  if (!statIds?.length) return NextResponse.json({ error: "statIds 필수" }, { status: 400 });

  await ensureSchema();

  let dismissed = 0;
  let lastErr: unknown = null;
  for (const id of statIds) {
    try {
      await execute(
        `UPDATE category_address_stats SET "isDismissed" = TRUE WHERE id = $1`,
        [id]
      );
      dismissed++;
    } catch (err) {
      lastErr = err;
      console.error("[candidates PATCH] dismiss fail", id, err);
    }
  }

  if (dismissed === 0) {
    return NextResponse.json(
      { error: "무시 처리 실패 — 스키마/권한 확인", detail: String(lastErr) },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, dismissed });
}

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "인증 필요" }, { status: 401 });

  await ensureSchema();

  const { searchParams } = new URL(request.url);
  const category = searchParams.get("category");
  const minFreq = parseInt(searchParams.get("min") || "2");

  if (!category) {
    return NextResponse.json({ error: "category 필수" }, { status: 400 });
  }

  // 아직 zone으로 promote되지 않은 빈도 높은 주소만
  // + 해당 주소의 가장 최근 entry memo를 suggestedLandmark로 (자동 장소 특징 제안)
  const candidates = await queryMany(
    `SELECT s.id, s."displayAddress", s."normalizedAddress", s.frequency,
            s."firstSeenAt", s."lastSeenAt",
            e.memo AS "suggestedLandmark"
     FROM category_address_stats s
     LEFT JOIN LATERAL (
       SELECT memo FROM patrol_entries
       WHERE "tenantId" = s."tenantId"
         AND category = s.category
         AND REPLACE("addressText", ' ', '') = s."normalizedAddress"
         AND memo IS NOT NULL AND memo != ''
       ORDER BY "createdAt" DESC
       LIMIT 1
     ) e ON true
     WHERE s."tenantId" = 'huam' AND s.category = $1
       AND s.frequency >= $2
       AND s."promotedZoneId" IS NULL
       AND COALESCE(s."isDismissed", FALSE) = FALSE
     ORDER BY s.frequency DESC, s."lastSeenAt" DESC
     LIMIT 30`,
    [category, minFreq]
  );

  return NextResponse.json(candidates);
}
