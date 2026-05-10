import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { queryMany, queryOne } from "@/lib/db";
import { todayKr, daysAgoKr, dateKr } from "@/lib/date";

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "인증 필요" }, { status: 401 });
  }

  try {
  const { searchParams } = new URL(request.url);
  const scope = searchParams.get("scope") || "all"; // all | me
  const userFilter = scope === "me" ? user.id : null;

  const today = todayKr();
  const weekAgo = daysAgoKr(7);
  // 반기 시작 (1~6월 → 1/1, 7~12월 → 7/1) — 한국 기준
  const now = new Date();
  const halfStart = dateKr(new Date(now.getFullYear(), now.getMonth() < 6 ? 0 : 6, 1));

  const uf = userFilter ? `AND "userId" = '${userFilter}'` : "";

  // 병렬 쿼리
  const [todayCount, weekCount, halfEval, categoryStats, recentEntries, pendingComplaints] =
    await Promise.all([
      // 오늘 건수
      queryOne<{ count: string }>(
        `SELECT COUNT(*) as count FROM patrol_entries WHERE "entryDate" = $1 ${uf}`,
        [today]
      ),
      // 이번 주 건수
      queryOne<{ count: string }>(
        `SELECT COUNT(*) as count FROM patrol_entries WHERE "entryDate" >= $1 ${uf}`,
        [weekAgo]
      ),
      // 반기 평가항목별 집계
      queryMany<{ evalItem: string; total_points: string; entry_count: string }>(
        `SELECT "evalItem",
                SUM("evalPoints") as total_points,
                COUNT(*) as entry_count
         FROM patrol_entries
         WHERE "entryDate" >= $1 AND "evalItem" IS NOT NULL ${uf}
         GROUP BY "evalItem"`,
        [halfStart]
      ),
      // 카테고리별 집계 (반기)
      queryMany<{ category: string; count: string }>(
        `SELECT category, COUNT(*) as count
         FROM patrol_entries
         WHERE "entryDate" >= $1 ${uf}
         GROUP BY category
         ORDER BY count DESC`,
        [halfStart]
      ),
      // 최근 입력 10건
      queryMany(
        `SELECT id, "userId", category, "evalItem", "photoCount", quantity, unit,
                memo, "addressText", "inputTrack", "entryDate", "createdAt"
         FROM patrol_entries
         ${userFilter ? `WHERE "userId" = '${userFilter}'` : ""}
         ORDER BY "createdAt" DESC
         LIMIT 10`
      ),
      // 대기 민원 수
      queryOne<{ count: string }>(
        `SELECT COUNT(*) as count FROM complaints WHERE status = 'pending'`
      ),
    ]);

  // 수동 평가 실적 로드 (테이블 미생성 시 빈 결과)
  const now2 = new Date();
  const halfKey = `${now2.getFullYear()}-${now2.getMonth() < 6 ? "H1" : "H2"}`;
  let manualEvals: { evalItem: string; manualCount: number }[] = [];
  try {
    manualEvals = await queryMany<{
      evalItem: string;
      manualCount: number;
    }>(
      `SELECT "evalItem", "manualCount" FROM manual_evals
       WHERE "tenantId" = 'huam' AND "halfYear" = $1`,
      [halfKey]
    );
  } catch (_e) {
    // 테이블 미존재 시 무시 (마이그레이션 전)
  }
  const manualMap = new Map(manualEvals.map((m) => [m.evalItem, m.manualCount]));

  // 수동 전용 항목 (자동 집계 무시, 수동 값만 사용)
  // 수동 전용 (자동 집계 무시)
  const MANUAL_ONLY = new Set([
    "과태료",
    "분리배출(폐건전지)", "분리배출(폐소형가전)", "분리배출(투명페트병)",
  ]);
  // 수동 우선 (수동 값 있으면 수동, 없으면 자동)
  const MANUAL_PRIORITY = new Set(["경고판", "특수사업"]);

  // 평가 진척도 계산 (100점 만점)
  const evalTargets: Record<string, { maxPoints: number; target: number }> = {
    과태료: { maxPoints: 30, target: 30 },
    경고판: { maxPoints: 5, target: 10 },
    상습지역: { maxPoints: 10, target: 10 },
    현장평가: { maxPoints: 20, target: 40 },  // 0.5점/건, 40건=20점 만점
    "분리배출(폐건전지)": { maxPoints: 5, target: 1500 },    // kg
    "분리배출(폐소형가전)": { maxPoints: 5, target: 1500 },   // kg
    "분리배출(투명페트병)": { maxPoints: 5, target: 2000 },   // 매
    특수사업: { maxPoints: 10, target: 5 },
    홍보: { maxPoints: 10, target: 6 },
  };

  // 모든 항목: 건당 점수 누적 비례 계산 (maxPoints / target)
  // 예) 과태료 maxPoints 30점 · target 30건 → 건당 1점, 30건+이면 cap 30점
  //     경고판 maxPoints 5점  · target 10건 → 건당 0.5점, 10건+이면 cap 5점
  //     현장평가 maxPoints 20점 · target 40건 → 건당 0.5점, 40건+이면 cap 20점

  const evalProgress = Object.entries(evalTargets).map(([name, target]) => {
    const found = halfEval.find((e) => e.evalItem === name);
    const autoCount = found ? parseInt(found.entry_count) : 0;
    const manual = manualMap.get(name);

    // 실제 사용할 카운트 결정
    let count: number;
    let isManual = false;
    if (MANUAL_ONLY.has(name)) {
      count = manual ?? 0;
      isManual = true;
    } else if (MANUAL_PRIORITY.has(name) && manual != null) {
      count = manual;
      isManual = true;
    } else {
      count = autoCount;
    }

    const perEntry = target.target > 0 ? target.maxPoints / target.target : 0;
    const rawEarned = Math.min(target.maxPoints, count * perEntry);
    const earnedPoints = Math.round(rawEarned * 10) / 10; // 소수 1자리
    return {
      name,
      maxPoints: target.maxPoints,
      target: target.target,
      current: count,
      autoCount,
      earnedPoints,
      isManual,
    };
  });

  const totalMaxPoints = Object.values(evalTargets).reduce((s, t) => s + t.maxPoints, 0);
  const totalEarned = evalProgress.reduce((s, e) => s + e.earnedPoints, 0);

  return NextResponse.json({
    today: parseInt(todayCount?.count || "0"),
    week: parseInt(weekCount?.count || "0"),
    pendingComplaints: parseInt(pendingComplaints?.count || "0"),
    evalProgress,
    evalScore: Math.round((totalEarned / totalMaxPoints) * 100),
    categoryStats: categoryStats.map((c) => ({
      category: c.category,
      count: parseInt(c.count),
    })),
    recentEntries,
  });

  } catch (err) {
    console.error("[stats] error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "stats 조회 실패" },
      { status: 500 }
    );
  }
}
