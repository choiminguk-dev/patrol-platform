"use client";

import { useState } from "react";

interface SplitGroupModalProps {
  photoUrls: string[];
  /** 분할 적용 — photoUrls의 2차원 배열 (각 sub-array가 새 그룹) */
  onApply: (groups: string[][]) => void;
  onClose: () => void;
}

const MAX_GROUPS = 5;

const GROUP_COLORS = [
  "bg-emerald-500 text-white",   // 1
  "bg-blue-500 text-white",      // 2
  "bg-amber-500 text-white",     // 3
  "bg-pink-500 text-white",      // 4
  "bg-violet-500 text-white",    // 5
];

/**
 * 그룹 분할 — zone 없이 그룹을 N개로 쪼갬
 * 사진별로 번호(1~5)를 부여 → 같은 번호끼리 묶음
 */
export default function SplitGroupModal({ photoUrls, onApply, onClose }: SplitGroupModalProps) {
  // 모든 사진 기본값: 1번 그룹
  const [assignments, setAssignments] = useState<number[]>(
    photoUrls.map(() => 1)
  );

  function cycle(idx: number) {
    setAssignments((prev) => {
      const next = [...prev];
      next[idx] = next[idx] >= MAX_GROUPS ? 1 : next[idx] + 1;
      return next;
    });
  }

  // 그룹별 사진 카운트
  const groupCounts = new Map<number, number>();
  for (const g of assignments) {
    groupCounts.set(g, (groupCounts.get(g) || 0) + 1);
  }
  const groupNumbers = Array.from(groupCounts.keys()).sort((a, b) => a - b);

  function handleApply() {
    if (groupNumbers.length < 2) {
      alert("2개 이상의 그룹으로 분할해야 합니다");
      return;
    }
    // 번호별로 photoUrls 묶기
    const result: string[][] = [];
    for (const n of groupNumbers) {
      const urls = photoUrls.filter((_, i) => assignments[i] === n);
      if (urls.length > 0) result.push(urls);
    }
    onApply(result);
  }

  return (
    <div
      className="fixed inset-0 bg-black/60 z-[55] flex items-end md:items-center justify-center"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-t-2xl md:rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-4 space-y-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold">그룹 분할</h3>
          <button onClick={onClose} className="text-gray-400 text-xl">×</button>
        </div>

        <p className="text-xs text-gray-500">
          사진을 탭하여 그룹 번호를 변경하세요 (1 → 2 → 3 → ...). 같은 번호끼리 새 그룹이 됩니다.
        </p>

        {/* 사진 그리드 */}
        <div className="grid grid-cols-3 md:grid-cols-4 gap-2">
          {photoUrls.map((url, i) => {
            const num = assignments[i];
            return (
              <button
                key={i}
                type="button"
                onClick={() => cycle(i)}
                className="relative aspect-square rounded-lg overflow-hidden bg-gray-100 hover:ring-2 hover:ring-emerald-400 active:scale-95 transition-all"
              >
                <img
                  src={url}
                  alt=""
                  className="w-full h-full object-cover pointer-events-none"
                />
                <span
                  className={`absolute top-1 right-1 w-7 h-7 rounded-full font-bold text-sm flex items-center justify-center shadow-lg ${
                    GROUP_COLORS[num - 1] || "bg-gray-500 text-white"
                  }`}
                >
                  {num}
                </span>
              </button>
            );
          })}
        </div>

        {/* 미리보기 */}
        <div className="bg-emerald-50 rounded-lg p-2 text-xs text-emerald-800">
          분할 결과: <strong>{groupNumbers.length}개 그룹</strong>
          <ul className="mt-1 space-y-0.5">
            {groupNumbers.map((n) => (
              <li key={n} className="flex items-center gap-1.5">
                <span
                  className={`inline-flex items-center justify-center w-4 h-4 rounded-full text-[9px] font-bold ${
                    GROUP_COLORS[n - 1] || "bg-gray-500 text-white"
                  }`}
                >
                  {n}
                </span>
                <span>그룹 {n}: {groupCounts.get(n)}장</span>
              </li>
            ))}
          </ul>
          {groupNumbers.length < 2 && (
            <p className="text-amber-600 mt-1">⚠ 최소 2개 그룹 필요 (사진을 탭해서 다른 번호 부여)</p>
          )}
        </div>

        {/* 액션 */}
        <div className="flex gap-2 sticky bottom-0 bg-white pt-2">
          <button
            onClick={onClose}
            className="flex-1 py-2 border border-gray-300 rounded-lg text-sm"
          >
            취소
          </button>
          <button
            onClick={handleApply}
            disabled={groupNumbers.length < 2}
            className="flex-1 py-2 bg-emerald-600 text-white rounded-lg text-sm font-semibold disabled:opacity-50"
          >
            {groupNumbers.length}개 그룹으로 분할
          </button>
        </div>
      </div>
    </div>
  );
}
