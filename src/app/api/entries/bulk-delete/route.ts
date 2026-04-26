import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { execute } from "@/lib/db";

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "인증 필요" }, { status: 401 });

  const { ids, date } = await request.json();

  if (ids?.length) {
    // 선택 삭제: ADMIN은 전체, 나머지는 자기 것만
    const placeholders = ids.map((_: string, i: number) => `$${i + 1}`).join(",");
    if (user.role === "ADMIN") {
      await execute(`DELETE FROM patrol_entries WHERE id IN (${placeholders})`, ids);
    } else {
      await execute(
        `DELETE FROM patrol_entries WHERE id IN (${placeholders}) AND "userId" = $${ids.length + 1}`,
        [...ids, user.id]
      );
    }
    return NextResponse.json({ deleted: ids.length });
  }

  if (date) {
    // 날짜 전체 삭제
    const result = await execute(
      `DELETE FROM patrol_entries WHERE "entryDate" = $1 AND "userId" = $2`,
      [date, user.id]
    );
    return NextResponse.json({ deleted: result });
  }

  return NextResponse.json({ error: "ids 또는 date 필요" }, { status: 400 });
}
