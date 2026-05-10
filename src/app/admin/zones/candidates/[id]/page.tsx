"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { CATEGORY_MAP } from "@/lib/categories";

interface CandDetail {
  id: string;
  category: string;
  displayAddress: string;
  normalizedAddress: string;
  frequency: number;
  firstSeenAt: string;
  lastSeenAt: string;
  suggestedLandmark: string | null;
  photoUrls: string[];
  entries: { id: string; createdAt: string; memo: string | null; addressText: string | null; photoCount: number }[];
}

export default function CandidateDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = Array.isArray(params?.id) ? params.id[0] : (params?.id as string);

  const [detail, setDetail] = useState<CandDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [userRole, setUserRole] = useState<string | null>(null);
  const canEdit = userRole === "ADMIN";

  const loadDetail = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    const res = await fetch(`/api/zones/candidates/${id}`);
    if (res.status === 404) setNotFound(true);
    else if (res.ok) setDetail(await res.json());
    setLoading(false);
  }, [id]);

  useEffect(() => {
    fetch("/api/auth/me").then((r) => r.json()).then((d) => setUserRole(d.role));
  }, []);

  useEffect(() => {
    loadDetail();
  }, [loadDetail]);

  async function handlePromote() {
    if (!detail) return;
    let suggested = detail.suggestedLandmark || "";
    if (suggested.length > 30) {
      const cut = suggested.search(/[.,。、\n]/);
      suggested = cut > 0 && cut < 30 ? suggested.slice(0, cut) : suggested.slice(0, 30);
    }
    const landmark = prompt(
      `"${detail.displayAddress}"\n장소 특징을 입력하세요 (예: 무단투기 빈번 / 어린이집 앞 등)\n\n🤖 AI 자동 제안 (수정 가능):`,
      suggested
    );
    if (landmark === null) return;
    const res = await fetch("/api/zones/promote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ statId: detail.id, landmark: landmark.trim() || detail.displayAddress }),
    });
    if (res.ok) {
      router.push("/admin/zones?qc=1");
    } else {
      const data = await res.json().catch(() => ({}));
      alert(data.error || "승격 실패");
    }
  }

  async function handleDismiss() {
    if (!detail) return;
    if (!confirm(`"${detail.displayAddress}" 후보를 무시하시겠습니까?\n(빈도 데이터는 유지되며, 후보 목록에서만 제거됩니다)`)) return;
    const res = await fetch("/api/zones/candidates", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ statIds: [detail.id] }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert(data.error || "무시 처리 실패");
      return;
    }
    router.push("/admin/zones?qc=1");
  }

  if (loading) return <div className="p-4 text-sm text-gray-400">로딩 중...</div>;
  if (notFound || !detail) {
    return (
      <div className="p-4 space-y-3">
        <Link href="/admin/zones?qc=1" className="text-sm text-emerald-600">← 구역 목록</Link>
        <p className="text-sm text-gray-500">후보를 찾을 수 없습니다.</p>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-3xl">
      <div className="flex items-center justify-between">
        <Link href="/admin/zones?qc=1" className="text-sm text-emerald-600 hover:underline">← 구역 목록</Link>
        <span className="text-[10px] text-gray-400">관리 모드 · ADMIN 전용</span>
      </div>

      <div className="flex items-center gap-2 min-w-0">
        <span className="text-[11px] px-2 py-0.5 rounded bg-purple-100 text-purple-700 font-semibold shrink-0">
          🤖 후보
        </span>
        <h2 className="text-xl md:text-2xl font-bold truncate">{detail.displayAddress}</h2>
      </div>

      {/* 기본 정보 */}
      <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-1 text-sm">
        <div className="flex gap-2">
          <span className="text-gray-500 shrink-0 w-20">카테고리</span>
          <span className="text-gray-900">{CATEGORY_MAP[detail.category]?.label || detail.category}</span>
        </div>
        <div className="flex gap-2">
          <span className="text-gray-500 shrink-0 w-20">등록 빈도</span>
          <span className="text-gray-900">{detail.frequency}회</span>
        </div>
        <div className="flex gap-2 text-xs text-gray-400 pt-1">
          <span>최초 {detail.firstSeenAt?.slice(0, 10)}</span>
          <span>· 최근 {detail.lastSeenAt?.slice(0, 10)}</span>
        </div>
        {detail.suggestedLandmark && (
          <div className="bg-purple-50 border border-purple-100 rounded-md p-2 mt-2">
            <p className="text-[10px] text-purple-700 font-semibold">🤖 AI 제안 메모</p>
            <p className="text-xs text-gray-700 mt-0.5 whitespace-pre-wrap">
              {detail.suggestedLandmark}
            </p>
          </div>
        )}
      </div>

      {/* 누적 사진 */}
      <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-3">
        <div className="flex items-baseline justify-between">
          <p className="text-sm font-semibold text-gray-700">
            누적 사진 ({detail.photoUrls.length}장)
          </p>
          <p className="text-[10px] text-gray-400">
            해당 주소로 등록된 사진 모음 — 품질 확인용
          </p>
        </div>
        {detail.photoUrls.length === 0 ? (
          <p className="text-xs text-gray-400 bg-gray-50 rounded-lg p-4 text-center">
            등록된 사진이 없습니다.
          </p>
        ) : (
          <div className="grid grid-cols-3 md:grid-cols-5 gap-2">
            {detail.photoUrls.map((url, i) => (
              <a
                key={url + i}
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="relative aspect-square rounded-lg overflow-hidden bg-gray-100 hover:ring-2 hover:ring-purple-400 transition-all block"
              >
                <img src={url} alt={`누적 사진 ${i + 1}`} className="w-full h-full object-cover" />
                <span className="absolute bottom-0 left-0 bg-black/60 text-white text-[9px] px-1">
                  {i + 1}
                </span>
              </a>
            ))}
          </div>
        )}
      </div>

      {/* 등록 이력 */}
      {detail.entries.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <p className="text-sm font-semibold text-gray-700 mb-2">
            최근 등록 이력 ({detail.entries.length}건)
          </p>
          <div className="space-y-1">
            {detail.entries.map((e) => (
              <div key={e.id} className="bg-gray-50 rounded-md px-3 py-2 text-xs text-gray-700 flex items-start gap-2">
                <span className="text-gray-400 shrink-0">
                  {e.createdAt?.slice(0, 10)}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="text-gray-500">사진 {e.photoCount}장</span>
                  {e.memo && <span className="text-gray-700 ml-1 break-words"> · {e.memo}</span>}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {canEdit && (
        <div className="flex gap-2">
          <button
            onClick={handlePromote}
            className="flex-1 py-2 rounded-lg bg-purple-600 text-white text-sm font-semibold"
          >
            정식 구역으로 등록
          </button>
          <button
            onClick={handleDismiss}
            className="flex-1 py-2 rounded-lg border border-gray-300 text-gray-600 text-sm"
          >
            무시
          </button>
        </div>
      )}
    </div>
  );
}
