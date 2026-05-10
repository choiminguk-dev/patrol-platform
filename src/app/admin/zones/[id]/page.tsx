"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { uploadPhotosChunked } from "@/lib/image-utils";

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

export default function ZoneDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = Array.isArray(params?.id) ? params.id[0] : (params?.id as string);

  const [zone, setZone] = useState<Zone | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [photoEditMode, setPhotoEditMode] = useState(false);
  const [photoUploading, setPhotoUploading] = useState(false);
  const photoAddRef = useRef<HTMLInputElement>(null);

  const canEdit = userRole === "ADMIN";

  const loadZone = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    const res = await fetch(`/api/zones/${id}`);
    if (res.status === 404) {
      setNotFound(true);
    } else if (res.ok) {
      setZone(await res.json());
    }
    setLoading(false);
  }, [id]);

  useEffect(() => {
    fetch("/api/auth/me").then((r) => r.json()).then((d) => setUserRole(d.role));
  }, []);

  useEffect(() => {
    loadZone();
  }, [loadZone]);

  async function updatePhotos(nextUrls: string[]) {
    if (!zone) return;
    const res = await fetch(`/api/zones/${zone.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ referencePhotoUrls: nextUrls }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert(data.error || "참고 사진 업데이트 실패");
      return;
    }
    setZone(await res.json());
  }

  async function deletePhoto(idx: number) {
    if (!zone) return;
    if (!confirm(`${idx + 1}번 참고 사진을 삭제하시겠습니까?`)) return;
    const next = zone.referencePhotoUrls.filter((_, i) => i !== idx);
    await updatePhotos(next);
  }

  async function addPhotos(files: FileList | null) {
    if (!zone || !files || files.length === 0) return;
    const arr = Array.from(files);
    setPhotoUploading(true);
    try {
      const results = await uploadPhotosChunked(arr, 5);
      const newUrls = results.map((r) => r.url).filter(Boolean);
      if (newUrls.length === 0) {
        alert("업로드 실패");
        return;
      }
      const combined = [...zone.referencePhotoUrls, ...newUrls];
      const trimmed = combined.slice(-20);
      await updatePhotos(trimmed);
    } catch (err) {
      console.error("[zone detail] upload error", err);
      alert("사진 추가 실패: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setPhotoUploading(false);
    }
  }

  async function handleDeleteZone() {
    if (!zone) return;
    if (!confirm(`${zone.seqNo}번 "${zone.landmark}" 구역을 삭제하시겠습니까?`)) return;
    const res = await fetch(`/api/zones/${zone.id}`, { method: "DELETE" });
    if (res.ok) {
      router.push("/admin/zones?qc=1");
    } else {
      alert("삭제 실패");
    }
  }

  if (loading) return <div className="p-4 text-sm text-gray-400">로딩 중...</div>;
  if (notFound || !zone) {
    return (
      <div className="p-4 space-y-3">
        <Link href="/admin/zones?qc=1" className="text-sm text-emerald-600">← 구역 목록</Link>
        <p className="text-sm text-gray-500">구역을 찾을 수 없습니다.</p>
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
        <span className="shrink-0 w-10 h-10 rounded-full bg-emerald-100 text-emerald-700 font-bold flex items-center justify-center text-base">
          {zone.seqNo}
        </span>
        <h2 className="text-xl md:text-2xl font-bold truncate">{zone.landmark}</h2>
      </div>

      {/* 기본 정보 */}
      <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-1 text-sm">
        <div className="flex gap-2">
          <span className="text-gray-500 shrink-0 w-20">주소</span>
          <span className="text-gray-900">{zone.address}</span>
        </div>
        {zone.category && (
          <div className="flex gap-2">
            <span className="text-gray-500 shrink-0 w-20">카테고리</span>
            <span className="text-gray-900">
              {zone.category === "road_clean" ? "이면도로 청소"
                : zone.category === "patrol_check" ? "상습지역 순찰"
                : zone.category}
            </span>
          </div>
        )}
        <div className="flex gap-2">
          <span className="text-gray-500 shrink-0 w-20">발견 경로</span>
          <span className="text-gray-900">
            {zone.discoveredFrom === "auto" ? "🤖 자체 학습 자동 발견" : "수동 등록"}
          </span>
        </div>
        {zone.notes && (
          <div className="flex gap-2">
            <span className="text-gray-500 shrink-0 w-20">설명</span>
            <span className="text-gray-900">{zone.notes}</span>
          </div>
        )}
        <div className="flex gap-2 text-xs text-gray-400 pt-1">
          <span>최초 등록 {zone.createdAt?.slice(0, 10)}</span>
          <span>· 최근 업데이트 {zone.updatedAt?.slice(0, 10)}</span>
        </div>
      </div>

      {/* 참고 사진 섹션 */}
      <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <p className="text-sm font-semibold text-gray-700">
            참고 사진 ({zone.referencePhotoUrls.length}장)
          </p>
          {canEdit && (
            <div className="flex gap-1.5">
              <button
                onClick={() => photoAddRef.current?.click()}
                disabled={photoUploading}
                className="text-[11px] px-2 py-1 rounded-md border border-blue-400 text-blue-700 hover:bg-blue-50 disabled:opacity-40"
              >
                {photoUploading ? "업로드 중..." : "+ 사진 추가"}
              </button>
              <button
                onClick={() => setPhotoEditMode((v) => !v)}
                className={`text-[11px] px-2 py-1 rounded-md border ${
                  photoEditMode
                    ? "bg-red-50 border-red-400 text-red-700"
                    : "border-gray-300 text-gray-600 hover:bg-gray-50"
                }`}
              >
                {photoEditMode ? "편집 완료" : "사진 편집"}
              </button>
            </div>
          )}
        </div>
        <p className="text-[11px] text-gray-400">
          AI 매칭에 사용되는 기준 사진입니다. 품질이 낮거나 잘못된 사진은 삭제하세요. (최근 20장까지 자동 관리)
        </p>

        {zone.referencePhotoUrls.length === 0 ? (
          <p className="text-xs text-gray-400 bg-gray-50 rounded-lg p-4 text-center">
            아직 참고 사진이 누적되지 않았습니다.
          </p>
        ) : (
          <div className="grid grid-cols-3 md:grid-cols-5 gap-2">
            {zone.referencePhotoUrls.map((url, i) => (
              <div key={url + i} className="relative aspect-square rounded-lg overflow-hidden bg-gray-100">
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`block w-full h-full ${photoEditMode ? "pointer-events-none" : "hover:ring-2 hover:ring-emerald-400 transition-all"}`}
                  onClick={(e) => { if (photoEditMode) e.preventDefault(); }}
                >
                  <img src={url} alt={`참고 사진 ${i + 1}`} className="w-full h-full object-cover" />
                </a>
                <span className="absolute bottom-0 left-0 bg-black/60 text-white text-[9px] px-1">
                  {i + 1}
                </span>
                {photoEditMode && canEdit && (
                  <button
                    onClick={() => deletePhoto(i)}
                    className="absolute top-1 right-1 w-6 h-6 rounded-full bg-red-600 text-white text-xs font-bold flex items-center justify-center shadow-lg hover:bg-red-700"
                    title="삭제"
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        <input
          ref={photoAddRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            addPhotos(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {canEdit && (
        <div className="flex gap-2">
          <Link
            href={`/admin/zones?qc=1&edit=${zone.id}`}
            className="flex-1 py-2 rounded-lg border border-emerald-400 text-emerald-700 text-sm font-semibold text-center"
          >
            정보 수정
          </Link>
          <button
            onClick={handleDeleteZone}
            className="flex-1 py-2 rounded-lg border border-red-300 text-red-500 text-sm"
          >
            구역 삭제
          </button>
        </div>
      )}
    </div>
  );
}
