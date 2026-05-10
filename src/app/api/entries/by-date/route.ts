import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { queryMany } from "@/lib/db";
import { CATEGORY_MAP } from "@/lib/categories";
import { todayKr } from "@/lib/date";

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "인증 필요" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const date = searchParams.get("date") || todayKr();

  const entries = await queryMany<{
    id: string;
    userId: string;
    category: string;
    photoUrls: string[];
    photoCount: number;
    quantity: number;
    unit: string;
    memo: string | null;
    addressText: string | null;
    address: string | null;
    latitude: number | null;
    longitude: number | null;
    inputTrack: string;
    createdAt: string;
    userName: string;
  }>(
    `SELECT e.id, e."userId", e.category, e."photoUrls", e."photoCount",
            e.quantity, e.unit, e.memo, e."addressText", e.address,
            e.latitude, e.longitude, e."inputTrack",
            e."createdAt", u.name as "userName"
     FROM patrol_entries e
     JOIN users u ON u.id = e."userId"
     WHERE e."entryDate" = $1
     ORDER BY e."createdAt" DESC`,
    [date]
  );

  const catMap: Record<string, { count: number; photoCount: number }> = {};
  for (const e of entries) {
    if (!catMap[e.category]) catMap[e.category] = { count: 0, photoCount: 0 };
    catMap[e.category].count++;
    catMap[e.category].photoCount += e.photoCount;
  }

  const categories = Object.entries(catMap).map(([category, s]) => ({
    category,
    label: CATEGORY_MAP[category]?.label || category,
    ...s,
  }));

  return NextResponse.json({
    date,
    totalEntries: entries.length,
    totalPhotos: entries.reduce((s, e) => s + e.photoCount, 0),
    categories,
    entries,
  });
}
