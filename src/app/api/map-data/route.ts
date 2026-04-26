import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { queryMany } from "@/lib/db";
import { daysAgoKr } from "@/lib/date";

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "인증 필요" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const days = parseInt(searchParams.get("days") || "7");
  const since = daysAgoKr(days);

  // GPS가 있는 순찰 기록만
  const entries = await queryMany(
    `SELECT id, category, "addressText", address, latitude, longitude,
            "photoCount", quantity, unit, "entryDate", "createdAt"
     FROM patrol_entries
     WHERE latitude IS NOT NULL AND "entryDate" >= $1
     ORDER BY "createdAt" DESC`,
    [since]
  );

  const complaints = await queryMany(
    `SELECT id, title, address, latitude, longitude, status, "createdAt"
     FROM complaints
     WHERE latitude IS NOT NULL`
  );

  return NextResponse.json({ entries, complaints });
}
