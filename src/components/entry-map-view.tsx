"use client";

import { useState, useEffect } from "react";
import KakaoMap, { type MapMarker, type HeatCircle } from "./kakao-map";
import { CATEGORY_MAP } from "@/lib/categories";

/** 카테고리 → 마커 색상 */
const CAT_COLOR: Record<string, string> = {
  road_clean: "blue",
  patrol_check: "emerald",
  illegal_dump: "red",
  alley_clean: "amber",
  recycle_promo: "violet",
  safety_check: "pink",
  building_check: "pink",
};

export interface EntryForMap {
  id: string;
  category: string;
  addressText: string | null;
  memo: string | null;
  photoCount: number;
  userName: string;
  createdAt: string;
}

interface Props {
  entries: EntryForMap[];
  /** 주소 수정 후 목록 새로고침 */
  onRefresh?: () => void;
  /** 높이 클래스 */
  className?: string;
  /** 카테고리 필터 (전체=null) */
  categoryFilter?: string | null;
}

/**
 * 항목 주소 지도 뷰 — 카테고리별 색상 마커 + 클릭 → 주소 인라인 수정
 * 구역탭 "현황" 모드 + 보고서탭 "지도 검토" 공용
 */
export default function EntryMapView({ entries, onRefresh, className, categoryFilter }: Props) {
  const [markers, setMarkers] = useState<(MapMarker & { entryId: string })[]>([]);
  const [geocoding, setGeocoding] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [selected, setSelected] = useState<EntryForMap | null>(null);
  const [editAddr, setEditAddr] = useState("");
  const [saving, setSaving] = useState(false);
  const [showHeat, setShowHeat] = useState(false);

  const filtered = categoryFilter
    ? entries.filter((e) => e.category === categoryFilter)
    : entries;

  // entries → geocode → markers
  // 의존성: entries, categoryFilter (배열 참조가 아닌 안정적인 값)
  useEffect(() => {
    const items = categoryFilter
      ? entries.filter((e) => e.category === categoryFilter)
      : entries;
    const target = items.filter((e) => e.addressText?.trim());

    if (target.length === 0) {
      setMarkers([]);
      return;
    }

    let cancelled = false;
    setGeocoding(true);
    setProgress({ done: 0, total: target.length });

    (async () => {
      const cache = new Map<string, { lat: number; lng: number }>();
      const results: (MapMarker & { entryId: string })[] = [];

      for (let i = 0; i < target.length; i += 5) {
        if (cancelled) return;
        const chunk = target.slice(i, i + 5);
        await Promise.all(
          chunk.map(async (entry) => {
            const addr = entry.addressText!.trim();
            let coords = cache.get(addr);
            if (!coords) {
              try {
                const res = await fetch(
                  `/api/geocode?address=${encodeURIComponent(addr)}`
                );
                if (res.ok) {
                  const data = await res.json();
                  if (data.coords) {
                    coords = data.coords;
                    cache.set(addr, coords!);
                  }
                }
              } catch { /* skip */ }
            }
            if (!coords) return;

            const sameCoordCount = results.filter(
              (r) =>
                Math.abs(r.lat - coords!.lat) < 0.00001 &&
                Math.abs(r.lng - coords!.lng) < 0.00001
            ).length;
            const offset = sameCoordCount * 0.00005;

            const catLabel = CATEGORY_MAP[entry.category]?.label || entry.category;
            const color = CAT_COLOR[entry.category] || "blue";
            const seqNo = target.indexOf(entry) + 1;

            results.push({
              id: entry.id,
              entryId: entry.id,
              lat: coords.lat + offset,
              lng: coords.lng + offset * 0.7,
              label: String(seqNo),
              title: `${seqNo}. ${catLabel}`,
              description: addr,
              color,
            });
          })
        );
        if (!cancelled) setProgress({ done: Math.min(i + 5, target.length), total: target.length });
      }

      if (!cancelled) {
        setMarkers(results);
        setGeocoding(false);
      }
    })();

    return () => { cancelled = true; };
  }, [entries, categoryFilter]);

  // 히트맵: 같은 좌표 빈도 계산
  const heatCircles: HeatCircle[] = (() => {
    if (!showHeat || markers.length === 0) return [];
    const buckets = new Map<string, { lat: number; lng: number; count: number }>();
    for (const mk of markers) {
      // 소수 4자리 반올림 (약 11m 단위 클러스터)
      const key = `${mk.lat.toFixed(4)},${mk.lng.toFixed(4)}`;
      const existing = buckets.get(key);
      if (existing) {
        existing.count++;
      } else {
        buckets.set(key, { lat: mk.lat, lng: mk.lng, count: 1 });
      }
    }
    const maxCount = Math.max(...Array.from(buckets.values()).map((b) => b.count));
    return Array.from(buckets.values()).map((b) => ({
      lat: b.lat,
      lng: b.lng,
      intensity: Math.max(1, Math.round((b.count / Math.max(maxCount, 1)) * 10)),
      color: "#ef4444",
    }));
  })();

  function handleMarkerClick(mk: MapMarker) {
    const entry = filtered.find((e) => e.id === mk.id);
    if (entry) {
      setSelected(entry);
      setEditAddr(entry.addressText || "");
    }
  }

  async function saveAddress() {
    if (!selected) return;
    const trimmed = editAddr.trim();
    if (trimmed === (selected.addressText || "").trim()) {
      setSelected(null);
      return;
    }
    setSaving(true);
    await fetch(`/api/entries/${selected.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ addressText: trimmed }),
    });
    setSaving(false);
    setSelected(null);
    onRefresh?.();
  }

  // 범례: 사용 중인 카테고리만
  const usedCats = Array.from(new Set(filtered.map((e) => e.category)));

  return (
    <div className={`relative flex flex-col ${className || "w-full h-[60vh]"}`}>
      <div className="flex-1 min-h-0 relative">
        {geocoding ? (
          <div className="bg-gray-50 border border-gray-200 rounded-lg flex flex-col items-center justify-center text-sm text-gray-500 w-full h-full">
            <div className="w-6 h-6 border-2 border-gray-300 border-t-emerald-600 rounded-full animate-spin mb-2" />
            주소 좌표 변환 중... ({progress.done}/{progress.total})
          </div>
        ) : markers.length === 0 ? (
          <div className="bg-gray-50 border border-gray-200 rounded-lg flex items-center justify-center text-sm text-gray-500 w-full h-full">
            {filtered.length === 0
              ? "해당 조건의 항목이 없습니다"
              : "주소가 있는 항목이 없습니다"}
          </div>
        ) : (
          <KakaoMap
            markers={markers}
            heatCircles={heatCircles}
            className="w-full h-full"
            onMarkerClick={handleMarkerClick}
          />
        )}
      </div>

      {/* 범례 + 히트맵 토글 */}
      {usedCats.length > 0 && !geocoding && markers.length > 0 && (
        <div className="flex flex-wrap gap-2 mt-2 items-center shrink-0">
          {usedCats.map((cat) => {
            const color = CAT_COLOR[cat] || "blue";
            const label = CATEGORY_MAP[cat]?.label || cat;
            const count = filtered.filter((e) => e.category === cat).length;
            const hexMap: Record<string, string> = {
              blue: "#3b82f6", emerald: "#10b981", red: "#ef4444",
              amber: "#f59e0b", violet: "#8b5cf6", pink: "#ec4899",
            };
            return (
              <span key={cat} className="flex items-center gap-1 text-[10px] text-gray-600">
                <span
                  className="inline-block w-3 h-3 rounded-full"
                  style={{ backgroundColor: hexMap[color] || hexMap.blue }}
                />
                {label} {count}건
              </span>
            );
          })}
          <span className="text-[10px] text-gray-400 ml-1">
            총 {markers.length}/{filtered.length}건 표시
          </span>
          <button
            onClick={() => setShowHeat(!showHeat)}
            className={`text-[10px] px-2 py-0.5 rounded-md ml-auto ${
              showHeat ? "bg-red-500 text-white" : "bg-gray-100 text-gray-500 hover:bg-gray-200"
            }`}
          >
            🔥 히트맵 {showHeat ? "ON" : "OFF"}
          </button>
        </div>
      )}

      {/* 선택된 항목 정보 카드 (하단) */}
      {selected && (
        <div className="absolute bottom-0 left-0 right-0 bg-white rounded-t-xl border-t border-gray-200 p-4 shadow-lg z-10 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 min-w-0">
              <span
                className="inline-block w-3 h-3 rounded-full shrink-0"
                style={{
                  backgroundColor:
                    { blue: "#3b82f6", emerald: "#10b981", red: "#ef4444", amber: "#f59e0b", violet: "#8b5cf6", pink: "#ec4899" }[
                      CAT_COLOR[selected.category] || "blue"
                    ] || "#3b82f6",
                }}
              />
              <span className="text-sm font-semibold truncate">
                {CATEGORY_MAP[selected.category]?.label || selected.category}
              </span>
              <span className="text-[10px] text-gray-400 shrink-0">
                {selected.photoCount}장 · {selected.userName}
              </span>
            </div>
            <button
              onClick={() => setSelected(null)}
              className="text-gray-400 text-lg leading-none shrink-0 ml-2"
            >
              ×
            </button>
          </div>
          {selected.memo && (
            <p className="text-xs text-gray-500 truncate">{selected.memo}</p>
          )}
          <div className="flex gap-2">
            <input
              type="text"
              value={editAddr}
              onChange={(e) => setEditAddr(e.target.value)}
              placeholder="주소 입력/수정"
              className="flex-1 px-3 py-2 border border-blue-300 bg-blue-50 rounded-lg text-sm"
            />
            <button
              onClick={saveAddress}
              disabled={saving}
              className="shrink-0 px-4 py-2 bg-indigo-600 text-white text-sm rounded-lg font-semibold disabled:opacity-50"
            >
              {saving ? "..." : "저장"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
