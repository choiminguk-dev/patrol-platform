import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { queryMany, queryOne } from "@/lib/db";

/**
 * 후보 구역 상세 — 해당 주소·카테고리로 누적된 entries 사진을 품질 확인용으로 반환
 * GET /api/zones/candidates/[id]
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "인증 필요" }, { status: 401 });

  const { id } = await params;

  const stat = await queryOne<{
    id: string;
    tenantId: string;
    category: string;
    normalizedAddress: string;
    displayAddress: string;
    frequency: number;
    firstSeenAt: string;
    lastSeenAt: string;
  }>(
    `SELECT id, "tenantId", category, "normalizedAddress", "displayAddress",
            frequency, "firstSeenAt", "lastSeenAt"
     FROM category_address_stats
     WHERE id = $1`,
    [id]
  );
  if (!stat) return NextResponse.json({ error: "후보 없음" }, { status: 404 });

  // 해당 category + 정규화 주소로 등록된 entries 조회
  const entries = await queryMany<{
    id: string;
    createdAt: string;
    memo: string | null;
    addressText: string | null;
    photoUrls: string[];
    photoCount: number;
  }>(
    `SELECT id, "createdAt", memo, "addressText", "photoUrls", "photoCount"
     FROM patrol_entries
     WHERE "tenantId" = $1
       AND category = $2
       AND REPLACE("addressText", ' ', '') = $3
     ORDER BY "createdAt" DESC
     LIMIT 20`,
    [stat.tenantId, stat.category, stat.normalizedAddress]
  );

  const photoUrls: string[] = [];
  for (const e of entries) {
    if (Array.isArray(e.photoUrls)) {
      for (const u of e.photoUrls) {
        if (u && !photoUrls.includes(u)) photoUrls.push(u);
      }
    }
  }

  const suggestedLandmark = entries.find((e) => e.memo && e.memo.trim())?.memo || null;

  return NextResponse.json({
    id: stat.id,
    category: stat.category,
    displayAddress: stat.displayAddress,
    normalizedAddress: stat.normalizedAddress,
    frequency: stat.frequency,
    firstSeenAt: stat.firstSeenAt,
    lastSeenAt: stat.lastSeenAt,
    suggestedLandmark,
    photoUrls,
    entries: entries.map((e) => ({
      id: e.id,
      createdAt: e.createdAt,
      memo: e.memo,
      addressText: e.addressText,
      photoCount: e.photoCount,
    })),
  });
}
