"use client";

import Link from "next/link";
import { useState, useEffect } from "react";
import TrackB from "./entry/track-b";
import TrackA from "./entry/track-a";

const LS_LAST_SEEN_KEY = "zones_candidates_last_seen";

export default function AdminHome() {
  const [todayCount, setTodayCount] = useState(0);
  const [weekCount, setWeekCount] = useState(0);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [track, setTrack] = useState<"A" | "B">("B");
  const [newCandCount, setNewCandCount] = useState(0);

  useEffect(() => {
    fetch(`/api/stats?scope=me`)
      .then((r) => r.json())
      .then((data) => {
        setTodayCount(data.today || 0);
        setWeekCount(data.week || 0);
      });
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((data) => setUserRole(data.role));

    // 새 후보 구역 확인
    (async () => {
      const lastSeen = typeof window !== "undefined"
        ? localStorage.getItem(LS_LAST_SEEN_KEY) || "1970-01-01"
        : "1970-01-01";
      let total = 0;
      for (const cat of ["patrol_check", "road_clean"]) {
        try {
          const res = await fetch(`/api/zones/candidates?category=${cat}&min=2`);
          if (res.ok) {
            const cands: { firstSeenAt: string }[] = await res.json();
            total += cands.filter((c) => c.firstSeenAt > lastSeen).length;
          }
        } catch { /* skip */ }
      }
      setNewCandCount(total);
    })();
  }, []);

  // 청소담당/안전담당 공통: 탭 전환 (실시간/일괄)
  return (
    <div className="p-4 md:p-6 space-y-4">
      {/* 새 후보 구역 알림 배너 */}
      {newCandCount > 0 && (
        <Link
          href="/admin/zones"
          className="flex items-center justify-between bg-purple-100 border border-purple-300 rounded-lg p-3 hover:bg-purple-200 transition-colors"
        >
          <span className="text-sm font-semibold text-purple-800">
            🆕 {newCandCount}개 새 후보 구역이 발견되었습니다
          </span>
          <span className="text-xs text-purple-700 font-semibold">→ 구역 관리로 이동</span>
        </Link>
      )}

      <div className="flex gap-3">
        <div className="flex-1 rounded-xl p-3 bg-emerald-50 text-emerald-700">
          <p className="text-xs opacity-70">오늘</p>
          <p className="text-2xl font-bold">{todayCount}건</p>
        </div>
        <div className="flex-1 rounded-xl p-3 bg-blue-50 text-blue-700">
          <p className="text-xs opacity-70">이번 주</p>
          <p className="text-2xl font-bold">{weekCount}건</p>
        </div>
      </div>

      {/* 탭 */}
      <div className="flex bg-gray-100 rounded-lg p-1">
        <button onClick={() => setTrack("A")}
          className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors
            ${track === "A" ? "bg-white text-emerald-700 shadow-sm" : "text-gray-500"}`}>
          촬영/갤러리
        </button>
        <button onClick={() => setTrack("B")}
          className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors
            ${track === "B" ? "bg-white text-emerald-700 shadow-sm" : "text-gray-500"}`}>
          일괄 업로드
        </button>
      </div>

      {track === "A" ? <TrackA /> : <TrackB />}
    </div>
  );
}
