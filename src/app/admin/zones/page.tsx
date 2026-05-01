"use client";

import { useState, useEffect, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import KakaoMap, { type MapMarker } from "@/components/kakao-map";
import AddressMapModal from "@/components/address-map-modal";
import EntryMapView, { type EntryForMap } from "@/components/entry-map-view";
import { todayKr } from "@/lib/date";
import { CATEGORIES, CATEGORY_MAP } from "@/lib/categories";

const LS_LAST_SEEN_KEY = "zones_candidates_last_seen";

interface Zone {
  id: string;
  seqNo: number;
  address: string;
  landmark: string;
  notes: string | null;
  referencePhotoUrls: string[];
  category: string | null;
  discoveredFrom: string | null;
  createdAt: string;
  updatedAt: string;
}

interface Candidate {
  id: string;
  displayAddress: string;
  normalizedAddress: string;
  frequency: number;
  firstSeenAt: string;
  lastSeenAt: string;
  suggestedLandmark: string | null;
}

const CATEGORY_TABS = [
  { id: "all", label: "전체" },
  { id: "patrol_check", label: "상습지역 순찰" },
  { id: "road_clean", label: "이면도로 청소" },
  { id: "other", label: "기타 관리" },
];

// 기타 관리 카테고리 — 상습지역/이면도로 제외한 전 카테고리
const OTHER_CAT_IDS = CATEGORIES
  .map((c) => c.id)
  .filter((id) => id !== "patrol_check" && id !== "road_clean");
const OTHER_CAT_ID_SET = new Set(OTHER_CAT_IDS);

interface CategoryStatRow { category: string; count: number; label: string; }

export default function ZonesPage() {
  const [zones, setZones] = useState<Zone[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Zone | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [tab, setTab] = useState<string>("all");
  const [view, setView] = useState<"list" | "map" | "daily">("map");
  const [mapMarkers, setMapMarkers] = useState<MapMarker[]>([]);
  const [geocoding, setGeocoding] = useState(false);
  const [candMapAddress, setCandMapAddress] = useState<{ address: string; title: string } | null>(null);
  const [newCandCount, setNewCandCount] = useState(0);
  // 기타 관리 탭용 카테고리 집계
  const [otherStats, setOtherStats] = useState<CategoryStatRow[]>([]);
  const [otherCandCounts, setOtherCandCounts] = useState<Record<string, number>>({});
  const [otherZoneCounts, setOtherZoneCounts] = useState<Record<string, number>>({});
  const [otherLoading, setOtherLoading] = useState(false);

  // 관리 모드 — ?qc=1 쿼리가 있을 때만 카드에 상세 관리 링크 노출 (ADMIN 전용)
  const searchParams = useSearchParams();
  const isManageMode = searchParams?.get("qc") === "1";
  // 현황 모드 (날짜 범위)
  const [dailyStart, setDailyStart] = useState(todayKr());
  const [dailyEnd, setDailyEnd] = useState(todayKr());
  const [dailyEntries, setDailyEntries] = useState<EntryForMap[]>([]);
  const [dailyCats, setDailyCats] = useState<{ category: string; label: string; count: number }[]>([]);
  const [dailyCatFilter, setDailyCatFilter] = useState<string | null>(null);
  const [dailyLoading, setDailyLoading] = useState(false);
  // 지도 전체화면 토글 (구역 지도 / 전체 지도 공통)
  const [mapFullscreen, setMapFullscreen] = useState(false);

  useEffect(() => {
    fetch("/api/auth/me").then((r) => r.json()).then((d) => setUserRole(d.role));
  }, []);

  // 전체화면 모드: ESC 키로 닫기 + body 스크롤 잠금
  useEffect(() => {
    if (!mapFullscreen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMapFullscreen(false); };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [mapFullscreen]);

  // 다른 뷰로 전환되면 전체화면 자동 종료
  useEffect(() => {
    if (view !== "map" && view !== "daily") setMapFullscreen(false);
  }, [view]);

  const loadZones = useCallback(async () => {
    setLoading(true);

    // 기타 관리 허브 탭은 카테고리 카드 그리드만 표시 — zones/candidates API 호출 불필요
    if (tab === "other") {
      setZones([]);
      setCandidates([]);
      // 새 후보 총합은 기존 전체 탭 로직으로 계산 (아래 else 분기에서 담당)
      setLoading(false);
      return;
    }

    const url = tab === "all" ? "/api/zones" : `/api/zones?category=${tab}`;
    const res = await fetch(url);
    if (res.ok) setZones(await res.json());

    // 후보 구역 로드 (모든 탭에서 — 알림용)
    if (tab !== "all") {
      const cRes = await fetch(`/api/zones/candidates?category=${tab}&min=2`);
      if (cRes.ok) {
        const cands: Candidate[] = await cRes.json();
        setCandidates(cands);
        const lastSeen = typeof window !== "undefined"
          ? localStorage.getItem(LS_LAST_SEEN_KEY) || "1970-01-01"
          : "1970-01-01";
        const newCount = cands.filter((c) => c.firstSeenAt > lastSeen).length;
        setNewCandCount(newCount);
      } else {
        setCandidates([]);
        setNewCandCount(0);
      }
    } else {
      // "전체" 탭에서도 새 후보 확인 (알림 팝업용)
      let totalNew = 0;
      for (const cat of ["patrol_check", "road_clean"]) {
        try {
          const cRes = await fetch(`/api/zones/candidates?category=${cat}&min=2`);
          if (cRes.ok) {
            const cands: Candidate[] = await cRes.json();
            const lastSeen = typeof window !== "undefined"
              ? localStorage.getItem(LS_LAST_SEEN_KEY) || "1970-01-01"
              : "1970-01-01";
            totalNew += cands.filter((c) => c.firstSeenAt > lastSeen).length;
          }
        } catch { /* skip */ }
      }
      setCandidates([]);
      setNewCandCount(totalNew);
    }
    setLoading(false);
  }, [tab]);

  function markCandidatesSeen() {
    if (typeof window !== "undefined") {
      localStorage.setItem(LS_LAST_SEEN_KEY, new Date().toISOString());
    }
    setNewCandCount(0);
  }

  useEffect(() => {
    loadZones();
  }, [loadZones]);

  // 기타 관리 탭: 카테고리별 건수 + 후보 개수 + 등록 zone 수 병렬 수집
  useEffect(() => {
    if (tab !== "other") return;
    let cancelled = false;
    setOtherLoading(true);
    (async () => {
      try {
        // 반기 건수 (전체 범위)
        const statsRes = await fetch("/api/stats?scope=all");
        const stats = statsRes.ok ? await statsRes.json() : { categoryStats: [] };
        const countMap = new Map<string, number>(
          (stats.categoryStats || []).map((c: { category: string; count: number }) => [c.category, c.count])
        );

        // 후보 개수 (카테고리별 병렬)
        const candCounts: Record<string, number> = {};
        await Promise.all(
          OTHER_CAT_IDS.map(async (id) => {
            try {
              const r = await fetch(`/api/zones/candidates?category=${id}&min=2`);
              if (r.ok) {
                const arr: unknown[] = await r.json();
                candCounts[id] = Array.isArray(arr) ? arr.length : 0;
              }
            } catch { /* skip */ }
          })
        );

        // 등록된 zone 수 (카테고리별)
        const zoneCounts: Record<string, number> = {};
        await Promise.all(
          OTHER_CAT_IDS.map(async (id) => {
            try {
              const r = await fetch(`/api/zones?category=${id}`);
              if (r.ok) {
                const arr: Zone[] = await r.json();
                // API가 category=X 필터 시 해당 카테고리 + 전역(null)을 돌려줌 → 해당 카테고리 것만 카운트
                zoneCounts[id] = arr.filter((z) => z.category === id).length;
              }
            } catch { /* skip */ }
          })
        );

        if (cancelled) return;
        setOtherStats(
          OTHER_CAT_IDS.map((id) => ({
            category: id,
            label: CATEGORY_MAP[id]?.label || id,
            count: Number(countMap.get(id) || 0),
          }))
        );
        setOtherCandCounts(candCounts);
        setOtherZoneCounts(zoneCounts);
      } finally {
        if (!cancelled) setOtherLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [tab]);

  // 현황: 날짜 범위 entries 로드
  const loadDailyEntries = useCallback(async () => {
    if (view !== "daily") return;
    setDailyLoading(true);
    try {
      const allEntries: EntryForMap[] = [];
      const catMap: Record<string, { label: string; count: number }> = {};
      const s = new Date(dailyStart + "T12:00:00");
      const e = new Date(dailyEnd + "T12:00:00");
      for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
        const dateStr = d.toISOString().slice(0, 10);
        const res = await fetch(`/api/entries/by-date?date=${dateStr}`);
        if (!res.ok) continue;
        const data = await res.json();
        if (data.entries) allEntries.push(...data.entries);
        if (data.categories) {
          for (const c of data.categories) {
            if (!catMap[c.category]) catMap[c.category] = { label: c.label, count: 0 };
            catMap[c.category].count += c.count;
          }
        }
      }
      setDailyEntries(allEntries);
      setDailyCats(Object.entries(catMap).map(([category, v]) => ({ category, ...v })));
    } catch (_e) { /* skip */ }
    setDailyLoading(false);
  }, [view, dailyStart, dailyEnd]);

  useEffect(() => { loadDailyEntries(); }, [loadDailyEntries]);

  // 지도 보기로 전환 시 zones를 좌표로 forward geocoding (첫 1회만)
  useEffect(() => {
    if (view !== "map" || zones.length === 0) return;
    let cancelled = false;
    setGeocoding(true);
    (async () => {
      const results: MapMarker[] = [];
      for (const z of zones) {
        try {
          const res = await fetch(`/api/geocode?address=${encodeURIComponent(z.address)}`);
          if (!res.ok) continue;
          const data = await res.json();
          if (data.coords) {
            results.push({
              id: z.id,
              lat: data.coords.lat,
              lng: data.coords.lng,
              label: String(z.seqNo),
              title: `${z.seqNo}. ${z.landmark}`,
              description: z.address,
              color: z.discoveredFrom === "auto" ? "violet" : "emerald",
            });
          }
        } catch { /* skip */ }
      }
      if (!cancelled) {
        setMapMarkers(results);
        setGeocoding(false);
      }
    })();
    return () => { cancelled = true; };
  }, [view, zones]);

  // 후보 일괄 추가 (상습지역만)
  async function handlePromoteAll() {
    if (!candidates.length) return;
    if (!confirm(`${candidates.length}개 후보 구역을 모두 정식 등록하시겠습니까?\nAI 자동 제안 장소 특징이 적용됩니다.`)) return;

    let success = 0;
    for (const cand of candidates) {
      let landmark = cand.suggestedLandmark || cand.displayAddress;
      if (landmark.length > 30) {
        const cut = landmark.search(/[.,。、\n]/);
        landmark = cut > 0 && cut < 30 ? landmark.slice(0, cut) : landmark.slice(0, 30);
      }
      const res = await fetch("/api/zones/promote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ statId: cand.id, landmark: landmark.trim() || cand.displayAddress }),
      });
      if (res.ok) success++;
    }
    alert(`${success}/${candidates.length}개 구역 등록 완료`);
    loadZones();
  }

  // 후보 일괄 무시 (이면도로 등 일반 빈번 주소)
  async function handleDismissAll() {
    if (!candidates.length) return;
    if (!confirm(`${candidates.length}개 후보를 무시하시겠습니까?\n(빈도 데이터는 유지되며, 후보 목록에서만 제거됩니다)`)) return;

    const res = await fetch("/api/zones/candidates", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ statIds: candidates.map((c) => c.id) }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert(data.error || "무시 처리 실패 (서버 응답 확인)");
      return;
    }
    loadZones();
  }

  async function handleDismissOne(candId: string) {
    const res = await fetch("/api/zones/candidates", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ statIds: [candId] }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert(data.error || "무시 처리 실패 (서버 응답 확인)");
      return;
    }
    loadZones();
  }

  async function handlePromote(cand: Candidate) {
    // AI가 분석한 메모를 장소 특징 기본값으로 자동 입력 (사용자가 수정 가능)
    // 너무 길면 첫 30자만, 마침표/쉼표 전까지만
    let suggested = cand.suggestedLandmark || "";
    if (suggested.length > 30) {
      const cut = suggested.search(/[.,。、\n]/);
      suggested = cut > 0 && cut < 30 ? suggested.slice(0, cut) : suggested.slice(0, 30);
    }
    const landmark = prompt(
      `"${cand.displayAddress}"\n장소 특징을 입력하세요 (예: 무단투기 빈번 / 어린이집 앞 등)\n\n🤖 AI 자동 제안 (수정 가능):`,
      suggested
    );
    if (landmark === null) return;
    const res = await fetch("/api/zones/promote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ statId: cand.id, landmark: landmark.trim() || cand.displayAddress }),
    });
    if (res.ok) {
      loadZones();
    } else {
      const data = await res.json();
      alert(data.error || "승격 실패");
    }
  }

  async function handleSave(form: { seqNo: number; address: string; landmark: string; notes: string }) {
    if (editing) {
      await fetch(`/api/zones/${editing.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
    } else {
      // 카테고리 탭에서 추가 시 자동 적용
      const category = tab === "all" ? null : tab;
      const res = await fetch("/api/zones", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, category }),
      });
      if (!res.ok) {
        const data = await res.json();
        alert(data.error || "생성 실패");
        return;
      }
    }
    setShowForm(false);
    setEditing(null);
    loadZones();
  }

  async function handleDelete(zone: Zone) {
    if (!confirm(`${zone.seqNo}번 "${zone.landmark}" 구역을 삭제하시겠습니까?`)) return;
    await fetch(`/api/zones/${zone.id}`, { method: "DELETE" });
    loadZones();
  }

  const canEdit = userRole === "ADMIN";

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-gray-900">구역 관리</h2>
        {canEdit && (
          <button
            onClick={() => { setEditing(null); setShowForm(true); }}
            className="px-3 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold"
          >
            + 구역 추가
          </button>
        )}
      </div>

      {/* 카테고리 탭 + 보기 전환 */}
      <div className="flex items-center gap-2">
        <div className="flex gap-1 bg-gray-100 rounded-lg p-1 flex-1">
          {CATEGORY_TABS.map((t) => {
            const isOtherCategoryActive = t.id === "other" && (tab === "other" || OTHER_CAT_ID_SET.has(tab));
            const active = tab === t.id || isOtherCategoryActive;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  active ? "bg-white text-emerald-700 shadow-sm" : "text-gray-500"
                }`}
              >
                {t.label}
              </button>
            );
          })}
        </div>
        <div className="flex gap-1 bg-gray-100 rounded-lg p-1 shrink-0">
          {([
            { id: "list" as const, label: "📋 목록", title: "목록 보기" },
            { id: "map" as const, label: "🗺 구역 지도", title: "구역 지도" },
            { id: "daily" as const, label: "📊 전체 지도", title: "전체 지도 (날짜 범위 활동)" },
          ]).map((v) => (
            <button
              key={v.id}
              onClick={() => setView(v.id)}
              className={`px-2 py-1.5 text-xs font-medium rounded-md transition-colors ${
                view === v.id ? "bg-white text-emerald-700 shadow-sm" : "text-gray-500"
              }`}
              title={v.title}
            >
              {v.label}
            </button>
          ))}
          {(view === "map" || view === "daily") && (
            <button
              onClick={() => setMapFullscreen(true)}
              className="px-2 py-1.5 text-xs font-medium rounded-md text-emerald-700 hover:bg-emerald-50 border border-emerald-200"
              title="지도를 전체 화면으로 보기 (ESC로 닫기)"
            >
              ⛶ 전체화면
            </button>
          )}
        </div>
      </div>

      {/* 지도 보기 */}
      {view === "map" && (
        <div>
          {geocoding ? (
            <div className="bg-gray-50 border border-gray-200 rounded-lg h-96 flex items-center justify-center text-sm text-gray-500">
              구역 좌표 변환 중...
            </div>
          ) : mapMarkers.length === 0 ? (
            <div className="bg-gray-50 border border-gray-200 rounded-lg h-96 flex items-center justify-center text-sm text-gray-500">
              표시할 구역이 없습니다
            </div>
          ) : (
            <KakaoMap markers={mapMarkers} className="w-full h-[60vh]" />
          )}
          <p className="text-[11px] text-gray-400 mt-2">
            🤖 보라색 마커: 자체 학습으로 발견된 구역 / 🟢 초록색: 수동 등록
          </p>
        </div>
      )}

      {/* 일자별 현황 지도 */}
      {view === "daily" && (
        <div className="space-y-3">
          {/* 날짜 범위 + 카테고리 필터 */}
          <div className="flex items-center gap-2 flex-wrap">
            <input
              type="date"
              value={dailyStart}
              onChange={(e) => { setDailyStart(e.target.value); setDailyCatFilter(null); }}
              className="px-2 py-1.5 border border-gray-300 rounded-lg text-xs w-[130px]"
            />
            <span className="text-gray-400 text-xs">~</span>
            <input
              type="date"
              value={dailyEnd}
              onChange={(e) => { setDailyEnd(e.target.value); setDailyCatFilter(null); }}
              className="px-2 py-1.5 border border-gray-300 rounded-lg text-xs w-[130px]"
            />
            <button
              onClick={() => setDailyCatFilter(null)}
              className={`text-[11px] px-2 py-1 rounded-md ${
                !dailyCatFilter ? "bg-emerald-600 text-white" : "bg-gray-100 text-gray-600"
              }`}
            >
              전체 {dailyEntries.length}건
            </button>
            {dailyCats.map((c) => (
              <button
                key={c.category}
                onClick={() => setDailyCatFilter(dailyCatFilter === c.category ? null : c.category)}
                className={`text-[11px] px-2 py-1 rounded-md ${
                  dailyCatFilter === c.category ? "bg-emerald-600 text-white" : "bg-gray-100 text-gray-600"
                }`}
              >
                {c.label} {c.count}
              </button>
            ))}
          </div>

          {dailyLoading ? (
            <div className="bg-gray-50 border border-gray-200 rounded-lg h-96 flex items-center justify-center text-sm text-gray-500">
              로딩 중...
            </div>
          ) : (
            <EntryMapView
              entries={dailyEntries}
              categoryFilter={dailyCatFilter}
              onRefresh={loadDailyEntries}
              className="w-full h-[60vh]"
            />
          )}
        </div>
      )}

      {view !== "daily" && (
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm text-gray-500">
            {tab === "road_clean"
              ? "이면도로 구역 목록"
              : tab === "patrol_check"
              ? "상습지역 목록"
              : tab === "other"
              ? "기타 관리 구역 목록"
              : tab === "all"
              ? "전체 구역 — 카테고리별로 분리 관리됩니다"
              : `${CATEGORY_MAP[tab]?.label || tab} 구역 목록`}
          </p>
          {OTHER_CAT_ID_SET.has(tab) && (
            <button
              onClick={() => setTab("other")}
              className="shrink-0 text-xs text-emerald-700 hover:underline"
            >
              ← 기타 관리로
            </button>
          )}
        </div>
      )}

      {/* 기타 관리 카드 그리드 — 빈도순 */}
      {view !== "daily" && tab === "other" && (
        <div>
          {otherLoading ? (
            <p className="text-sm text-gray-400">로딩 중...</p>
          ) : (
            (() => {
              const cards = otherStats
                .map((s) => ({
                  ...s,
                  candidates: otherCandCounts[s.category] || 0,
                  zones: otherZoneCounts[s.category] || 0,
                }))
                .sort((a, b) => {
                  // 1) 전체 활동량(건수+후보+zone) 기준 내림차순
                  const total = (x: { count: number; candidates: number; zones: number }) =>
                    x.count + x.candidates + x.zones;
                  const diff = total(b) - total(a);
                  if (diff !== 0) return diff;
                  // 2) 동점 시 라벨 가나다 순
                  return a.label.localeCompare(b.label, "ko");
                });
              return (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                  {cards.map((c) => {
                    const active = c.count + c.candidates + c.zones > 0;
                    const baseClass = `text-left rounded-lg border p-3 ${
                      active
                        ? "bg-white border-gray-200"
                        : "bg-gray-50 border-gray-200 text-gray-400"
                    }`;
                    const content = (
                      <>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <p className="text-sm font-semibold truncate">{c.label}</p>
                          {isManageMode && c.candidates > 0 && (
                            <span className="text-[9px] px-1 py-0.5 rounded bg-purple-100 text-purple-700 font-semibold">
                              NEW {c.candidates}
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-gray-500 mt-1">
                          등록 {c.count}건 · 구역 {c.zones}개
                        </p>
                      </>
                    );
                    if (isManageMode) {
                      return (
                        <button
                          key={c.category}
                          onClick={() => setTab(c.category)}
                          className={`${baseClass} transition-colors hover:border-emerald-400 cursor-pointer`}
                        >
                          {content}
                        </button>
                      );
                    }
                    return (
                      <div
                        key={c.category}
                        className={`${baseClass} cursor-default`}
                        aria-disabled="true"
                      >
                        {content}
                      </div>
                    );
                  })}
                </div>
              );
            })()
          )}
        </div>
      )}

      {/* 🤖 발견된 후보 구역 — 최상단 노출 (목록 위) */}
      {view !== "map" && view !== "daily" && tab !== "all" && candidates.length > 0 && (
        <div>
          {newCandCount > 0 && (
            <div className="mb-2 bg-purple-100 border border-purple-300 rounded-lg p-3 flex items-center justify-between">
              <span className="text-sm font-semibold text-purple-800">
                🆕 {newCandCount}개 새 후보 구역 발견!
              </span>
              <button
                onClick={markCandidatesSeen}
                className="text-xs px-2.5 py-1 rounded-md bg-purple-600 text-white font-semibold"
              >
                확인
              </button>
            </div>
          )}

          <div className="flex items-center gap-2 mb-2">
            <span className="text-sm font-bold text-purple-700">🤖 발견된 후보 구역</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-100 text-purple-700">
              자체 학습
            </span>
            <span className="text-xs text-gray-400">({candidates.length})</span>
            {canEdit && candidates.length > 1 && (
              <div className="ml-auto flex gap-1">
                {tab === "patrol_check" && (
                  <button
                    onClick={handlePromoteAll}
                    className="text-[10px] px-2.5 py-1 rounded-md bg-purple-600 text-white font-semibold"
                  >
                    전체 추가
                  </button>
                )}
                <button
                  onClick={handleDismissAll}
                  className="text-[10px] px-2.5 py-1 rounded-md bg-gray-400 text-white font-semibold"
                >
                  전체 무시
                </button>
              </div>
            )}
          </div>
          <p className="text-xs text-gray-400 mb-2">
            등록 빈도가 누적된 주소입니다. 정식 구역으로 승격하면 다음 분석부터 자동 매칭됩니다.
          </p>
          <div className="space-y-2">
            {candidates.map((c) => {
              const lastSeen = typeof window !== "undefined"
                ? localStorage.getItem(LS_LAST_SEEN_KEY) || "1970-01-01"
                : "1970-01-01";
              const isNew = c.firstSeenAt > lastSeen;
              return (
                <div
                  key={c.id}
                  className={`bg-purple-50 rounded-lg border p-3 flex items-center gap-3 ${
                    isNew ? "border-purple-500 ring-2 ring-purple-200" : "border-purple-200"
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <p className="text-sm font-medium text-gray-900 truncate">{c.displayAddress}</p>
                      {isNew && (
                        <span className="text-[9px] px-1 py-0.5 rounded bg-red-500 text-white font-bold">NEW</span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {c.frequency}회 등록 · 최근 {c.lastSeenAt?.slice(0, 10)}
                    </p>
                    {c.suggestedLandmark && (
                      <p className="text-[10px] text-purple-600 mt-0.5 truncate">
                        🤖 AI 제안: {c.suggestedLandmark}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-col gap-1 shrink-0">
                    <button
                      onClick={() => setCandMapAddress({ address: c.displayAddress, title: c.displayAddress })}
                      className="text-[10px] px-2 py-1 rounded-md border border-violet-400 text-violet-700 hover:bg-violet-50"
                      title="이 주소를 지도에서 보기"
                    >
                      🗺 지도
                    </button>
                    {isManageMode && canEdit && (
                      <Link
                        href={`/admin/zones/candidates/${c.id}`}
                        className="text-[10px] px-2 py-1 rounded-md border border-purple-400 text-purple-700 hover:bg-purple-50 text-center"
                      >
                        📷 상세
                      </Link>
                    )}
                    {canEdit && (
                      <>
                        <button
                          onClick={() => handlePromote(c)}
                          className="text-[10px] px-2 py-1 rounded-md bg-purple-600 text-white font-semibold hover:bg-purple-700"
                        >
                          구역 추가
                        </button>
                        <button
                          onClick={() => handleDismissOne(c.id)}
                          className="text-[10px] px-2 py-1 rounded-md bg-gray-300 text-gray-600 hover:bg-gray-400"
                        >
                          무시
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {view === "map" || view === "daily" || tab === "other" ? null : loading ? (
        <p className="text-sm text-gray-400">로딩 중...</p>
      ) : (() => {
        // 클라이언트 필터: 카테고리 탭 선택 시 해당 카테고리 zone만 표시
        // (서버 쿼리는 "category IS NULL OR category=$1" 이라 NULL zone이 섞여 올 수 있음)
        // 예외: patrol_check 탭에서는 legacy NULL category zone 도 포함
        //      (초기 상습지역 6개가 category=NULL 로 저장되어 있음 — 의미상 상습지역)
        const displayZones =
          tab === "all"
            ? zones
            : tab === "patrol_check"
            ? zones.filter((z) => z.category === "patrol_check" || z.category == null)
            : zones.filter((z) => z.category === tab);
        if (displayZones.length === 0) {
          return (
            <div className="bg-gray-50 rounded-lg p-8 text-center">
              <p className="text-sm text-gray-500 mb-3">등록된 구역이 없습니다</p>
              {canEdit && (
                <button
                  onClick={() => { setEditing(null); setShowForm(true); }}
                  className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold"
                >
                  첫 구역 추가
                </button>
              )}
            </div>
          );
        }
        return (
        <div className="space-y-2">
          {displayZones.map((z) => (
            <div
              key={z.id}
              className="bg-white rounded-lg border border-gray-200 p-4 flex items-start gap-3"
            >
              <span className="shrink-0 w-8 h-8 rounded-full bg-emerald-100 text-emerald-700 font-bold flex items-center justify-center text-sm">
                {z.seqNo}
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <p className="text-sm font-semibold text-gray-900">{z.landmark}</p>
                  {z.discoveredFrom === "auto" && (
                    <span className="text-[9px] px-1 py-0.5 rounded bg-purple-100 text-purple-700">🤖 자동</span>
                  )}
                  {z.category && (
                    <span className="text-[9px] px-1 py-0.5 rounded bg-blue-100 text-blue-700">
                      {z.category === "road_clean" ? "이면도로" : z.category === "patrol_check" ? "상습지역" : z.category}
                    </span>
                  )}
                </div>
                <p className="text-xs text-gray-500 mt-0.5">{z.address}</p>
                {z.notes && (
                  <p className="text-xs text-gray-400 mt-1">{z.notes}</p>
                )}
                {z.referencePhotoUrls.length > 0 && (
                  <p className="text-[10px] text-emerald-600 mt-1">
                    참고 사진 {z.referencePhotoUrls.length}장 내부 학습 중
                  </p>
                )}
              </div>
              {isManageMode && canEdit && (
                <Link
                  href={`/admin/zones/${z.id}`}
                  className="shrink-0 text-[11px] px-2 py-1 rounded-md border border-emerald-400 text-emerald-700 hover:bg-emerald-50"
                >
                  📷 상세
                </Link>
              )}
              {canEdit && (
                <div className="flex gap-2 shrink-0">
                  <button
                    onClick={() => { setEditing(z); setShowForm(true); }}
                    className="text-xs text-emerald-600 px-2 py-1"
                  >
                    수정
                  </button>
                  <button
                    onClick={() => handleDelete(z)}
                    className="text-xs text-red-500 px-2 py-1"
                  >
                    삭제
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
        );
      })()}

      {/* 전체 탭에서도 새 후보 알림 */}
      {tab === "all" && newCandCount > 0 && (
        <div className="mt-4 bg-purple-100 border border-purple-300 rounded-lg p-3 flex items-center justify-between">
          <span className="text-sm font-semibold text-purple-800">
            🆕 {newCandCount}개 새 후보 구역이 발견되었습니다
          </span>
          <button
            onClick={() => setTab("road_clean")}
            className="text-xs px-3 py-1.5 rounded-md bg-purple-600 text-white font-semibold"
          >
            확인하기 →
          </button>
        </div>
      )}

      {/* 후보 지도 미리보기 모달 */}
      {candMapAddress && (
        <AddressMapModal
          address={candMapAddress.address}
          title={candMapAddress.title}
          onClose={() => setCandMapAddress(null)}
        />
      )}

      {showForm && canEdit && (
        <ZoneForm
          initial={editing}
          onClose={() => { setShowForm(false); setEditing(null); }}
          onSave={handleSave}
        />
      )}

      {/* 지도 전체화면 오버레이 — 구역 지도 / 전체 지도 공통 */}
      {mapFullscreen && (view === "map" || view === "daily") && (
        <div className="fixed inset-0 z-[60] bg-white flex flex-col">
          <div className="flex items-center justify-between px-4 py-2 border-b bg-white shrink-0">
            <h3 className="text-sm font-bold text-gray-800">
              {view === "map" ? "🗺 구역 지도" : "📊 전체 지도"}
            </h3>
            <button
              onClick={() => setMapFullscreen(false)}
              className="px-3 py-1 text-sm rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700"
              title="전체화면 닫기 (ESC)"
            >
              ✕ 닫기
            </button>
          </div>
          <div className="flex-1 min-h-0">
            {view === "map" ? (
              mapMarkers.length === 0 ? (
                <div className="w-full h-full flex items-center justify-center text-sm text-gray-500 bg-gray-50">
                  표시할 구역이 없습니다
                </div>
              ) : (
                <KakaoMap markers={mapMarkers} className="w-full h-full" />
              )
            ) : (
              <EntryMapView
                entries={dailyEntries}
                categoryFilter={dailyCatFilter}
                onRefresh={loadDailyEntries}
                className="w-full h-full"
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ZoneForm({
  initial,
  onClose,
  onSave,
}: {
  initial: Zone | null;
  onClose: () => void;
  onSave: (form: { seqNo: number; address: string; landmark: string; notes: string }) => void;
}) {
  const [seqNo, setSeqNo] = useState(initial?.seqNo?.toString() || "");
  const [address, setAddress] = useState(initial?.address || "");
  const [landmark, setLandmark] = useState(initial?.landmark || "");
  const [notes, setNotes] = useState(initial?.notes || "");

  return (
    <div
      className="fixed inset-0 bg-black/50 z-50 flex items-end md:items-center justify-center"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-t-2xl md:rounded-2xl w-full max-w-md p-4 space-y-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold">{initial ? "구역 수정" : "구역 추가"}</h3>
          <button onClick={onClose} className="text-gray-400 text-xl">×</button>
        </div>

        <div>
          <label className="block text-xs text-gray-500 mb-1">연번 *</label>
          <input
            type="number"
            value={seqNo}
            onChange={(e) => setSeqNo(e.target.value)}
            placeholder="1"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
          />
        </div>

        <div>
          <label className="block text-xs text-gray-500 mb-1">도로명 주소 *</label>
          <input
            type="text"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="예: 두텁바위로47길 9-1"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
          />
        </div>

        <div>
          <label className="block text-xs text-gray-500 mb-1">장소 특징 *</label>
          <input
            type="text"
            value={landmark}
            onChange={(e) => setLandmark(e.target.value)}
            placeholder="예: 드림캐슬무단투기민원건"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
          />
        </div>

        <div>
          <label className="block text-xs text-gray-500 mb-1">추가 설명 (선택, AI 매칭 힌트)</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="예: 건물 입구 쓰레기 상습 무단투기, CCTV 설치"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm resize-none"
            rows={2}
          />
        </div>

        <div className="flex gap-2 pt-2">
          <button
            onClick={onClose}
            className="flex-1 py-2 border border-gray-300 rounded-lg text-sm"
          >
            취소
          </button>
          <button
            onClick={() => {
              if (!seqNo || !address || !landmark) {
                alert("연번/주소/장소특징을 입력하세요");
                return;
              }
              onSave({
                seqNo: parseInt(seqNo),
                address: address.trim(),
                landmark: landmark.trim(),
                notes: notes.trim(),
              });
            }}
            className="flex-1 py-2 bg-emerald-600 text-white rounded-lg text-sm font-semibold"
          >
            {initial ? "수정" : "추가"}
          </button>
        </div>
      </div>
    </div>
  );
}
