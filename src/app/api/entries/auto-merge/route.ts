import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { execute, queryMany } from "@/lib/db";

interface EntryRow {
  id: string;
  category: string;
  addressText: string | null;
  zoneId: string | null;
  photoUrls: string[];
  createdAt: string;
}

/**
 * 같은 zoneId 또는 같은 주소(공백 무시) 항목 자동 병합
 * - 첫 entry(가장 먼저 등록)를 target으로
 * - 나머지 entries의 사진을 target에 합침
 * - 나머지 entries 삭제
 * - zoneId, addressText 둘 다 없는 entry는 미머지
 */
export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "인증 필요" }, { status: 401 });
  if (user.role !== "ADMIN") {
    return NextResponse.json({ error: "관리자만 가능" }, { status: 403 });
  }

  const { date } = await request.json();
  if (!date) return NextResponse.json({ error: "date 필수" }, { status: 400 });

  // 해당 날짜의 모든 entry 조회 (생성순)
  const entries = await queryMany<EntryRow>(
    `SELECT id, category, "addressText", "zoneId", "photoUrls", "createdAt"
     FROM patrol_entries
     WHERE "entryDate" = $1
     ORDER BY "createdAt"`,
    [date]
  );

  if (entries.length < 2) {
    return NextResponse.json({ mergedGroups: 0, removedEntries: 0 });
  }

  // 그룹화: zoneId 우선, 없으면 카테고리+정규화된 주소
  const buckets = new Map<string, EntryRow[]>();
  for (const e of entries) {
    let key: string | null = null;
    if (e.zoneId) {
      key = `zone:${e.zoneId}`;
    } else if (e.addressText?.trim()) {
      // 카테고리도 키에 포함 (다른 카테고리는 머지 X)
      const normalized = e.addressText.replace(/\s/g, "");
      key = `cat:${e.category}|addr:${normalized}`;
    }
    if (!key) continue; // zone도 주소도 없으면 미머지
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(e);
  }

  let mergedGroups = 0;
  let removedEntries = 0;

  for (const [, group] of buckets) {
    if (group.length < 2) continue;

    // 첫 entry = target, 나머지 = 삭제 대상
    const target = group[0];
    const others = group.slice(1);

    // 사진 URL 합치기 (중복 제거)
    const allUrls = [...target.photoUrls];
    for (const o of others) {
      for (const url of o.photoUrls) {
        if (!allUrls.includes(url)) allUrls.push(url);
      }
    }
    const newCount = allUrls.length;
    const newQty = Math.max(1, Math.ceil(newCount / 5));

    // target 갱신
    await execute(
      `UPDATE patrol_entries
       SET "photoUrls" = $1, "photoCount" = $2, quantity = $3
       WHERE id = $4`,
      [allUrls, newCount, newQty, target.id]
    );

    // 나머지 삭제
    for (const o of others) {
      await execute(`DELETE FROM patrol_entries WHERE id = $1`, [o.id]);
      removedEntries++;
    }
    mergedGroups++;
  }

  return NextResponse.json({ mergedGroups, removedEntries });
}
