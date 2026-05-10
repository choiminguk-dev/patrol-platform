import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { queryMany, execute } from "@/lib/db";

/** 현재 반기 키: "2026-H1" 또는 "2026-H2" */
function currentHalfYear(): string {
  const now = new Date();
  const half = now.getMonth() < 6 ? "H1" : "H2";
  return `${now.getFullYear()}-${half}`;
}

/** GET: 현재 반기 수동 평가 실적 조회 */
export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "인증 필요" }, { status: 401 });

  const half = currentHalfYear();
  let rows: { evalItem: string; manualCount: number; note: string | null }[] = [];
  try {
    rows = await queryMany<{
      evalItem: string;
      manualCount: number;
      note: string | null;
    }>(
      `SELECT "evalItem", "manualCount", note
       FROM manual_evals
       WHERE "tenantId" = 'huam' AND "halfYear" = $1`,
      [half]
    );
  } catch { /* 테이블 미존재 시 빈 배열 */ }

  return NextResponse.json({ halfYear: half, items: rows });
}

/** PATCH: 수동 평가 실적 저장 (upsert) */
export async function PATCH(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "인증 필요" }, { status: 401 });
  if (user.role !== "ADMIN") {
    return NextResponse.json({ error: "관리자만 가능" }, { status: 403 });
  }

  const { evalItem, manualCount, note } = await request.json();
  if (!evalItem || manualCount == null) {
    return NextResponse.json({ error: "evalItem, manualCount 필수" }, { status: 400 });
  }

  const half = currentHalfYear();
  try {
    // 테이블 자동 생성 (최초 1회)
    await execute(`
      CREATE TABLE IF NOT EXISTS "manual_evals" (
        "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
        "tenantId" TEXT NOT NULL DEFAULT 'huam',
        "evalItem" TEXT NOT NULL,
        "halfYear" TEXT NOT NULL,
        "manualCount" INTEGER NOT NULL DEFAULT 0,
        "note" TEXT,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `, []);
    await execute(`
      CREATE UNIQUE INDEX IF NOT EXISTS "manual_evals_unique"
        ON "manual_evals"("tenantId", "evalItem", "halfYear")
    `, []);

    await execute(
      `INSERT INTO manual_evals ("id", "tenantId", "evalItem", "halfYear", "manualCount", "note", "updatedAt")
       VALUES (gen_random_uuid(), 'huam', $1, $2, $3, $4, NOW())
       ON CONFLICT ("tenantId", "evalItem", "halfYear")
       DO UPDATE SET "manualCount" = $3, "note" = $4, "updatedAt" = NOW()`,
      [evalItem, half, manualCount, note || null]
    );

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[eval-manual] PATCH error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "저장 실패" },
      { status: 500 }
    );
  }
}
