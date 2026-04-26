import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { execute, queryOne, queryMany } from "@/lib/db";
import { CATEGORY_MAP } from "@/lib/categories";
import { reverseGeocode } from "@/lib/geocode";
import { todayKr } from "@/lib/date";

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "인증 필요" }, { status: 401 });
  }

  const body = await request.json();
  const { category, photoUrls = [], memo, addressText, latitude, longitude, entryDate } = body;

  const cat = CATEGORY_MAP[category];
  if (!cat) {
    return NextResponse.json({ error: "유효하지 않은 카테고리" }, { status: 400 });
  }

  const id = crypto.randomUUID();
  const date = entryDate || todayKr();

  // GPS → 주소 역지오코딩 (사용자 입력 주소 없을 때만)
  let geocodedAddress: string | null = null;
  if (!addressText && latitude != null && longitude != null) {
    geocodedAddress = await reverseGeocode(latitude, longitude);
  }

  await execute(
    `INSERT INTO patrol_entries
      (id, "userId", category, "evalItem", "evalPoints",
       latitude, longitude, "addressText", address, memo, quantity,
       unit, "photoUrls", "photoCount", "inputTrack", "entryDate")
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 'realtime', $15)`,
    [
      id, user.id, category, cat.eval, cat.points,
      latitude ?? null, longitude ?? null, addressText ?? null, geocodedAddress,
      memo ?? null, 1, cat.unit, photoUrls, photoUrls.length, date,
    ]
  );

  const entry = await queryOne(
    `SELECT id, category, "photoCount", quantity, "entryDate" FROM patrol_entries WHERE id = $1`,
    [id]
  );

  return NextResponse.json(entry);
}

/** 오늘 내 입력 기록 조회 */
export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "인증 필요" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const date = searchParams.get("date") || todayKr();

  const entries = await queryMany(
    `SELECT id, category, "evalItem", "photoCount", quantity, unit, memo, "addressText",
            "inputTrack", "createdAt"
     FROM patrol_entries
     WHERE "userId" = $1 AND "entryDate" = $2
     ORDER BY "createdAt" DESC`,
    [user.id, date]
  );

  return NextResponse.json(entries);
}
