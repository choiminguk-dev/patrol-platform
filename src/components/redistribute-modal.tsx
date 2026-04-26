"use client";

import { useState } from "react";

export interface RedistZone {
  id: string;
  seqNo: number;
  address: string;
  landmark: string;
}

export interface RedistAssignment {
  photoUrl: string;
  zoneId: string | null;
}

interface RedistributeModalProps {
  /** 사진 URL 리스트 */
  photoUrls: string[];
  /** 초기 zoneId (모든 사진의 기본값) */
  initialZoneId?: string | null;
  /** 등록된 zone 목록 */
  zones: RedistZone[];
  /** 적용 콜백 — assignments 반환 */
  onApply: (assignments: RedistAssignment[]) => void | Promise<void>;
  onClose: () => void;
  /** 적용 버튼 텍스트 (기본: "분배") */
  submitLabel?: string;
}

/** 사진별 zone 재배정 모달 — Dashboard(API) / TrackB(로컬) 양쪽에서 재사용 */
export default function RedistributeModal({
  photoUrls,
  initialZoneId,
  zones,
  onApply,
  onClose,
  submitLabel,
}: RedistributeModalProps) {
  const [assignments, setAssignments] = useState<RedistAssignment[]>(
    photoUrls.map((url) => ({ photoUrl: url, zoneId: initialZoneId ?? null }))
  );
  const [submitting, setSubmitting] = useState(false);

  function applyAll(zoneId: string | null) {
    setAssignments(assignments.map((a) => ({ ...a, zoneId })));
  }
  function update(idx: number, zoneId: string | null) {
    const next = [...assignments];
    next[idx] = { ...next[idx], zoneId };
    setAssignments(next);
  }

  // 미리보기: zone별 그룹 수
  const previewGroups: Record<string, number> = {};
  for (const a of assignments) {
    const key = a.zoneId || "__none__";
    previewGroups[key] = (previewGroups[key] || 0) + 1;
  }
  const groupKeys = Object.keys(previewGroups);

  async function handleSubmit() {
    setSubmitting(true);
    try {
      await onApply(assignments);
    } finally {
      setSubmitting(false);
    }
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
          <h3 className="text-lg font-bold">구역 분배</h3>
          <button onClick={onClose} className="text-gray-400 text-xl">×</button>
        </div>

        <p className="text-xs text-gray-500">
          각 사진에 적합한 구역을 선택하세요. 같은 구역끼리 묶어서 새 그룹으로 분할됩니다.
        </p>

        {/* 일괄 적용 */}
        <div className="bg-gray-50 rounded-lg p-2 flex items-center gap-2">
          <span className="text-xs text-gray-500 shrink-0">일괄:</span>
          <select
            onChange={(e) => applyAll(e.target.value || null)}
            className="flex-1 px-2 py-1.5 border border-gray-300 rounded text-xs"
            defaultValue=""
          >
            <option value="">— 선택 —</option>
            <option value="">미배정</option>
            {zones.map((z) => (
              <option key={z.id} value={z.id}>
                {z.seqNo}. {z.landmark} · {z.address}
              </option>
            ))}
          </select>
        </div>

        {/* 사진별 그리드 */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
          {assignments.map((a, i) => {
            const zone = zones.find((z) => z.id === a.zoneId);
            return (
              <div key={i} className="border border-gray-200 rounded-lg overflow-hidden">
                <div className="aspect-square bg-gray-100">
                  <img src={a.photoUrl} alt="" className="w-full h-full object-cover" />
                </div>
                <select
                  value={a.zoneId || ""}
                  onChange={(e) => update(i, e.target.value || null)}
                  className={`w-full px-1 py-1 text-[10px] border-t ${
                    zone
                      ? "bg-emerald-50 border-emerald-300 text-emerald-800"
                      : "bg-white border-gray-200"
                  }`}
                >
                  <option value="">미배정</option>
                  {zones.map((z) => (
                    <option key={z.id} value={z.id}>
                      {z.seqNo}. {z.landmark}
                    </option>
                  ))}
                </select>
              </div>
            );
          })}
        </div>

        {/* 미리보기 */}
        <div className="bg-emerald-50 rounded-lg p-2 text-xs text-emerald-800">
          분배 결과: <strong>{groupKeys.length}건</strong>으로 분할
          <ul className="mt-1 space-y-0.5">
            {groupKeys.map((k) => {
              const zone = zones.find((z) => z.id === k);
              return (
                <li key={k}>
                  · {zone ? `${zone.seqNo}. ${zone.landmark}` : "미배정"}: {previewGroups[k]}장
                </li>
              );
            })}
          </ul>
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
            onClick={handleSubmit}
            disabled={submitting}
            className="flex-1 py-2 bg-emerald-600 text-white rounded-lg text-sm font-semibold disabled:opacity-50"
          >
            {submitting ? "적용 중..." : submitLabel || `${groupKeys.length}건으로 분배`}
          </button>
        </div>
      </div>
    </div>
  );
}
