"use client";

import { useState, useEffect } from "react";
import { CATEGORY_MAP } from "@/lib/categories";

interface MapEntry {
  id: string;
  category: string;
  addressText: string | null;
  address: string | null;
  latitude: number;
  longitude: number;
  photoCount: number;
  entryDate: string;
}

interface MapComplaint {
  id: string;
  title: string;
  address: string | null;
  latitude: number;
  longitude: number;
  status: string;
}

export default function MapPage() {
  const [entries, setEntries] = useState<MapEntry[]>([]);
  const [complaints, setComplaints] = useState<MapComplaint[]>([]);
  const [days, setDays] = useState(7);

  useEffect(() => {
    fetch(`/api/map-data?days=${days}`)
      .then((r) => r.json())
      .then((data) => {
        setEntries(data.entries || []);
        setComplaints(data.complaints || []);
      });
  }, [days]);

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-gray-900">지도</h2>
        <select value={days} onChange={(e) => setDays(Number(e.target.value))}
          className="px-2 py-1 border border-gray-300 rounded-lg text-sm">
          <option value={1}>오늘</option>
          <option value={7}>7일</option>
          <option value={30}>30일</option>
        </select>
      </div>

      {/* 지도 영역 — 네이버/카카오 지도 API 연동 전 목록 형태 */}
      <div className="bg-gray-100 rounded-xl p-4 text-center text-sm text-gray-500">
        <p>지도 API 연동 예정 (네이버/카카오맵)</p>
        <p className="text-xs mt-1">현재는 위치 목록으로 표시</p>
      </div>

      {/* 순찰 위치 목록 */}
      {entries.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-gray-700 mb-2">
            순찰 위치 ({entries.length}건)
          </h3>
          <div className="space-y-2">
            {entries.map((e) => (
              <div key={e.id} className="bg-white rounded-lg border border-gray-200 px-3 py-2">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">
                      {CATEGORY_MAP[e.category]?.label || e.category}
                    </p>
                    <p className="text-xs text-gray-500">
                      {e.addressText || e.address || `${e.latitude.toFixed(5)}, ${e.longitude.toFixed(5)}`}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-gray-400">{e.entryDate}</p>
                    <p className="text-xs text-gray-400">{e.photoCount}장</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {entries.length === 0 && (
        <p className="text-sm text-gray-400 text-center py-8">GPS 데이터가 있는 순찰 기록이 없습니다</p>
      )}

      {/* 민원 위치 */}
      {complaints.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-gray-700 mb-2">
            민원 위치 ({complaints.length}건)
          </h3>
          <div className="space-y-2">
            {complaints.map((c) => (
              <div key={c.id} className="bg-white rounded-lg border border-gray-200 px-3 py-2 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">{c.title}</p>
                  <p className="text-xs text-gray-500">{c.address}</p>
                </div>
                <span className={`text-xs px-1.5 py-0.5 rounded ${
                  c.status === "done" ? "bg-emerald-100 text-emerald-600" :
                  c.status === "assigned" ? "bg-blue-100 text-blue-600" :
                  "bg-amber-100 text-amber-600"
                }`}>
                  {c.status === "done" ? "완료" : c.status === "assigned" ? "배정" : "대기"}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
