import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { queryMany } from "@/lib/db";

/**
 * 캘린더 dot 표시용 — 주어진 (year, month) 내 entry 가 존재하는 날짜 목록.
 */
export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "인증 필요" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const year = parseInt(searchParams.get("year") || "0", 10);
  const month = parseInt(searchParams.get("month") || "0", 10);
  if (!year || month < 1 || month > 12) {
    return NextResponse.json({ error: "year/month 필수 (1-12)" }, { status: 400 });
  }

  const monthStart = `${year}-${String(month).padStart(2, "0")}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const monthEnd = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

  const rows = await queryMany<{ date: string }>(
    `SELECT DISTINCT TO_CHAR("entryDate", 'YYYY-MM-DD') AS date
       FROM patrol_entries
      WHERE "entryDate" >= $1::date
        AND "entryDate" <= $2::date
      ORDER BY date ASC`,
    [monthStart, monthEnd]
  );

  return NextResponse.json({
    year,
    month,
    dates: rows.map((r) => r.date),
  });
}
