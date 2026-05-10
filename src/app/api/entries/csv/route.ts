import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { queryMany } from "@/lib/db";
import { CATEGORY_MAP } from "@/lib/categories";

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "인증 필요" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const startDate = searchParams.get("start");
  const endDate = searchParams.get("end");

  if (!startDate || !endDate) {
    return NextResponse.json({ error: "start, end 필수" }, { status: 400 });
  }

  const entries = await queryMany<{
    entryDate: string;
    createdAt: string;
    category: string;
    addressText: string | null;
    photoCount: number;
    quantity: number;
    unit: string;
    memo: string | null;
    userName: string;
  }>(
    `SELECT e."entryDate", e."createdAt", e.category, e."addressText",
            e."photoCount", e.quantity, e.unit, e.memo, u.name as "userName"
     FROM patrol_entries e
     JOIN users u ON u.id = e."userId"
     WHERE e."entryDate" >= $1 AND e."entryDate" <= $2
     ORDER BY e."entryDate", e."createdAt"`,
    [startDate, endDate]
  );

  // BOM + CSV 생성
  const BOM = "\uFEFF";
  const header = "순번,날짜,시간,카테고리,위치,사진수,수량,입력자,메모";
  const rows = entries.map((e, i) => {
    const cols = [
      i + 1,
      e.entryDate,
      e.createdAt?.slice(11, 16) || "",
      CATEGORY_MAP[e.category]?.label || e.category,
      e.addressText || "",
      e.photoCount,
      `${e.quantity}${e.unit}`,
      e.userName,
      e.memo || "",
    ];
    return cols.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",");
  });

  const csv = BOM + header + "\n" + rows.join("\n");
  const filename = `환경순찰_${startDate}_${endDate}.csv`;

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  });
}
