"use client";

import { useState, useRef, useEffect } from "react";
import { CATEGORIES, POOL_DEFAULTS, CATEGORY_MAP } from "@/lib/categories";
import { uploadPhotosChunked, createThumbnail, preparePhotos, uploadPreparedPhotos, type PreparedPhoto } from "@/lib/image-utils";
import PhotoViewer from "@/components/photo-viewer";
import RedistributeModal from "@/components/redistribute-modal";
import SplitGroupModal from "@/components/split-group-modal";
import AddressMapModal from "@/components/address-map-modal";
import { todayKr } from "@/lib/date";

interface UploadedFile {
  filename: string;
  url: string;
  exif?: { lat?: number; lng?: number; date?: string } | null;
}

interface PhotoGroup {
  address: string;
  description: string;
  photoIndices: number[]; // 1-based
  category: string;
  memo: string;
  zoneId?: string | null;
  zoneSeqNo?: number | null;
  zoneLandmark?: string | null;
  needsReview?: boolean;
  /** AI 첫 제안 — 사용자 정정 학습용 (절대 변경 X) */
  originalAddressAi?: string;
  /** AI 판단 근거 — 정확도 개선 추적용 */
  aiReasoning?: string;
}

interface ZoneItem {
  id: string;
  seqNo: number;
  address: string;
  landmark: string;
}

const POOLS = [
  { id: "PUB", label: "공무관", color: "bg-blue-600" },
  { id: "KEEP", label: "지킴이", color: "bg-amber-600" },
] as const;

export default function TrackB() {
  const [step, setStep] = useState<"pool" | "photos" | "preview" | "analyze" | "review" | "done">("pool");
  const [selectedPool, setSelectedPool] = useState("");
  const [defaultCat, setDefaultCat] = useState("road_clean");
  const [entryDate, setEntryDate] = useState(todayKr());
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState({ phase: "", done: 0, total: 0 });
  const [prepared, setPrepared] = useState<PreparedPhoto[]>([]);
  const [blurPreviews, setBlurPreviews] = useState<string[]>([]);
  const [previewViewerIdx, setPreviewViewerIdx] = useState<number | null>(null);
  const [thumbnails, setThumbnails] = useState<string[]>([]);
  const [groups, setGroups] = useState<PhotoGroup[]>([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ batchId: string; count: number } | null>(null);
  // 사진 뷰어: { groupIdx, photoIdx } — photoIdx는 그룹 내 0-based
  const [viewer, setViewer] = useState<{ groupIdx: number; photoIdx: number } | null>(null);
  const [redistGroupIdx, setRedistGroupIdx] = useState<number | null>(null);
  const [splitGroupIdx, setSplitGroupIdx] = useState<number | null>(null);
  const [mapGroupIdx, setMapGroupIdx] = useState<number | null>(null);
  const [mergeMode, setMergeMode] = useState(false);
  const [selectedMergeIdxs, setSelectedMergeIdxs] = useState<number[]>([]);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [zones, setZones] = useState<ZoneItem[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/auth/me").then((r) => r.json()).then((d) => setUserRole(d.role));
    fetch("/api/zones").then((r) => r.json()).then((d) => { if (Array.isArray(d)) setZones(d); });
  }, []);

  function selectAndGo(pool: string, cat: string) {
    setSelectedPool(pool);
    setDefaultCat(cat);
    setStep("photos");
  }

  // ===== Step 1: 풀 선택 =====
  if (step === "pool") {
    const isSafety = userRole === "SAFETY";
    return (
      <div className="space-y-6">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">업무 날짜</label>
          <input type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)}
            className="w-full md:w-48 px-3 py-2 border border-gray-300 rounded-lg text-sm" />
        </div>

        {isSafety ? (
          <>
            {/* 안전담당: 안전 업무 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">안전 업무</label>
              <div className="grid grid-cols-3 gap-2">
                <button onClick={() => selectAndGo("", "safety_check")}
                  className="p-3 rounded-xl bg-red-600 text-white font-semibold text-sm text-center active:scale-95 transition-transform">
                  안전점검
                </button>
                <button onClick={() => selectAndGo("", "building_check")}
                  className="p-3 rounded-xl bg-red-500 text-white font-semibold text-sm text-center active:scale-95 transition-transform">
                  위험건축물
                </button>
                <button onClick={() => selectAndGo("", "flood_control")}
                  className="p-3 rounded-xl bg-red-400 text-white font-semibold text-sm text-center active:scale-95 transition-transform">
                  치수(수방)
                </button>
              </div>
            </div>

            {/* 안전담당: 기타 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">기타</label>
              <div className="grid grid-cols-2 gap-2">
                <button onClick={() => selectAndGo("", "road_clean")}
                  className="p-3 rounded-xl bg-slate-600 text-white font-semibold text-sm text-center active:scale-95 transition-transform">
                  이면도로 청소
                </button>
                <button onClick={() => selectAndGo("", "road_mgmt")}
                  className="p-3 rounded-xl bg-slate-500 text-white font-semibold text-sm text-center active:scale-95 transition-transform">
                  도로(관리)
                </button>
              </div>
            </div>
          </>
        ) : (
          <>
            {/* 청소담당: 공무관 업무 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">공무관 업무</label>
              <div className="grid grid-cols-3 gap-2">
                <button onClick={() => selectAndGo("PUB", "road_clean")}
                  className="p-3 rounded-xl bg-blue-600 text-white font-semibold text-sm text-center active:scale-95 transition-transform">
                  이면도로 청소
                </button>
                <button onClick={() => selectAndGo("PUB", "patrol_check")}
                  className="p-3 rounded-xl bg-blue-500 text-white font-semibold text-sm text-center active:scale-95 transition-transform">
                  상습지역 순찰
                </button>
                <button onClick={() => selectAndGo("PUB", "illegal_dump")}
                  className="p-3 rounded-xl bg-blue-400 text-white font-semibold text-sm text-center active:scale-95 transition-transform">
                  무단투기
                </button>
              </div>
            </div>

            {/* 청소담당: 기타 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">기타</label>
              <div className="grid grid-cols-2 gap-2">
                <button onClick={() => selectAndGo("KEEP", "alley_clean")}
                  className="p-3 rounded-xl bg-amber-600 text-white font-semibold text-sm text-center active:scale-95 transition-transform">
                  지킴이
                </button>
                <button onClick={() => selectAndGo("", "etc")}
                  className="p-3 rounded-xl bg-gray-500 text-white font-semibold text-sm text-center active:scale-95 transition-transform">
                  기타
                </button>
              </div>
            </div>
          </>
        )}

        {/* 직접 선택 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">또는 직접 선택</label>
          <select onChange={(e) => {
            if (!e.target.value) return;
            setDefaultCat(e.target.value);
            setStep("photos");
          }} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" defaultValue="">
            <option value="" disabled>카테고리를 선택하세요</option>
            {CATEGORIES.map((c) => (
              <option key={c.id} value={c.id}>{c.label} ({c.eval})</option>
            ))}
          </select>
        </div>
      </div>
    );
  }

  // 사용자 확인 후 업로드 + AI 분석 (preview → analyze 전환)
  async function confirmAndUpload() {
    const wakeLock = await acquireWakeLock();
    setStep("analyze");
    setUploading(true);

    const results = await uploadPreparedPhotos(prepared, 10, (done, total) => {
      setUploadProgress({ phase: "upload", done, total });
    });
    setUploadedFiles(results);
    setUploading(false);

    setAnalyzing(true);
    try {
      const res = await fetch("/api/analyze-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          photoUrls: results.map((f) => f.url),
          count: results.length,
          category: defaultCat,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.groups?.length > 0) {
          const mapped = data.groups.map((g: any) => ({
            address: g.address || "",
            description: g.description || "",
            photoIndices: (g.photoIndices || []) as number[],
            category: defaultCat,
            memo: g.description || "",
            zoneId: g.zoneId || null,
            zoneSeqNo: g.zoneSeqNo || null,
            zoneLandmark: g.zoneLandmark || null,
            needsReview: !!g.needsReview,
            originalAddressAi: g.address || "",
            aiReasoning: g.reasoning || "",
          }));

          const assigned = new Set<number>();
          for (const g of mapped) for (const idx of g.photoIndices) assigned.add(idx);
          const missing: number[] = [];
          for (let i = 1; i <= results.length; i++) {
            if (!assigned.has(i)) missing.push(i);
          }
          if (missing.length > 0) {
            for (const mi of missing) {
              let bestGroup = mapped[mapped.length - 1];
              for (const g of mapped) {
                const minIdx = Math.min(...g.photoIndices);
                if (minIdx > mi) { bestGroup = g; break; }
              }
              bestGroup.photoIndices.push(mi);
            }
            for (const g of mapped) g.photoIndices.sort((a: number, b: number) => a - b);
          }

          // 주소판 미검출 그룹: 대표 사진 EXIF GPS로 역지오코딩 보강
          // (originalAddressAi는 건드리지 않음 → 정정 학습 테이블 오염 없음)
          const enriched = await Promise.all(
            mapped.map(async (g: typeof mapped[number]) => {
              if (g.address) return g;
              const exif = results[g.photoIndices[0] - 1]?.exif;
              if (!exif?.lat || !exif?.lng) return g;
              try {
                const res = await fetch(`/api/geocode?lat=${exif.lat}&lng=${exif.lng}`);
                if (!res.ok) return g;
                const gdata = await res.json();
                if (!gdata.address) return g;
                return { ...g, address: gdata.address as string };
              } catch { return g; }
            })
          );

          setGroups(enriched);
        } else {
          setGroups([{ address: "", description: "", photoIndices: results.map((_, i) => i + 1), category: defaultCat, memo: "" }]);
        }
      } else {
        setGroups([{ address: "", description: "", photoIndices: results.map((_, i) => i + 1), category: defaultCat, memo: "" }]);
      }
    } catch {
      setGroups([{ address: "", description: "", photoIndices: results.map((_, i) => i + 1), category: defaultCat, memo: "" }]);
    }
    setAnalyzing(false);
    wakeLock?.release();
    setStep("review");
  }

  // 화면 꺼짐 방지 (처리 중에만)
  async function acquireWakeLock(): Promise<WakeLockSentinel | null> {
    try {
      if ("wakeLock" in navigator) {
        return await (navigator as any).wakeLock.request("screen");
      }
    } catch { /* 미지원 또는 권한 거부 */ }
    return null;
  }

  function startPreview() {
    setStep("preview");
  }

  // ===== Step 2: 사진 업로드 =====
  if (step === "photos") {
    const catInfo = CATEGORY_MAP[defaultCat];

    async function handleUpload(files: FileList | null) {
      console.log("[UP-1] onChange fired, files=", files?.length);
      if (!files?.length) return;
      // CRITICAL: FileList를 먼저 배열로 복사 — caller가 input.value=""로 지우기 전에
      const arr = Array.from(files);
      console.log("[UP-1b] snapshot size=", arr.length);
      try {
        console.log("[UP-2] wakeLock 요청");
        const wakeLock = await acquireWakeLock();
        console.log("[UP-3] wakeLock=", !!wakeLock);
        setUploading(true);
        console.log("[UP-4] files size=", arr.map((f) => ({ name: f.name, size: f.size, type: f.type })));
        setUploadProgress({ phase: "compress", done: 0, total: arr.length });

        console.log("[UP-5] 썸네일 생성 시작 (원본, 임시)");
        const tempThumbs = await Promise.all(arr.map((f) => createThumbnail(f)));
        const addedTempCount = tempThumbs.filter(Boolean).length;
        console.log("[UP-6] 임시 썸네일 완료", addedTempCount, "/", arr.length);
        const tempStartIdx = thumbnails.length;
        setThumbnails((prev) => [...prev, ...tempThumbs.filter((t): t is string => !!t)]);

        console.log("[UP-7] preparePhotos 시작");
        const prep = await preparePhotos(arr, (phase, done, total) => {
          console.log(`[UP-prep] ${phase} ${done}/${total}`);
          setUploadProgress({ phase, done, total });
        });
        console.log("[UP-8] preparePhotos 완료", prep.length);
        setPrepared((prev) => [...prev, ...prep]);

        const previews = prep.map((p) => URL.createObjectURL(p.blurredBlob));
        setBlurPreviews((prev) => [...prev, ...previews]);

        // 썸네일을 블러 처리된 버전으로 교체 (개인정보 노출 최소화)
        console.log("[UP-8b] 블러 썸네일 재생성");
        const blurredThumbs = await Promise.all(prep.map((p) => createThumbnail(p.blurredBlob)));
        setThumbnails((prev) => {
          const next = [...prev];
          blurredThumbs.forEach((t, i) => {
            if (t) next[tempStartIdx + i] = t;
          });
          return next;
        });
        console.log("[UP-9] 완료");

        setUploading(false);
        wakeLock?.release();
      } catch (err) {
        console.error("[UP-ERR]", err);
        alert("업로드 오류: " + (err instanceof Error ? err.message : String(err)));
        setUploading(false);
      }
    }

    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <p className="text-sm text-gray-500">{catInfo?.label} · {entryDate}</p>
          <button onClick={() => { setStep("pool"); setUploadedFiles([]); setThumbnails([]); setPrepared([]); setBlurPreviews([]); }}
            className="text-sm text-emerald-600">← 뒤로</button>
        </div>

        <div onClick={() => fileRef.current?.click()}
          className="border-2 border-dashed border-gray-300 rounded-xl p-8 text-center cursor-pointer hover:border-emerald-400 hover:bg-emerald-50 transition-colors">
          <p className="text-4xl mb-2">📷</p>
          <p className="font-medium text-gray-700">사진을 선택하세요</p>
          <p className="text-xs text-gray-400 mt-1">주소판 + 현장사진 묶음으로 선택</p>
          <input ref={fileRef} type="file" accept="image/*" multiple className="hidden"
            onChange={(e) => { handleUpload(e.target.files); e.target.value = ""; }} />
        </div>

        {uploading && (
          <div className="space-y-2">
            <div className="flex justify-between text-sm text-emerald-600">
              <span>{
                uploadProgress.phase === "compress" ? "압축 중..." :
                uploadProgress.phase === "detect" ? "얼굴 감지 중..." :
                uploadProgress.phase === "blur" ? "블러 처리 중..." :
                "업로드 중..."
              }</span>
              <span>{uploadProgress.done}/{uploadProgress.total}장</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div className="bg-emerald-600 h-2 rounded-full transition-all duration-300"
                style={{ width: `${uploadProgress.total ? (uploadProgress.done / uploadProgress.total) * 100 : 0}%` }} />
            </div>
          </div>
        )}

        {prepared.length > 0 && (
          <div>
            <p className="text-sm font-medium text-gray-700 mb-2">
              {prepared.length}장 준비됨
              {prepared.some((p) => p.hasBlur) && (
                <span className="text-xs text-amber-600 ml-2">
                  (얼굴 {prepared.filter((p) => p.hasBlur).length}장 블러)
                </span>
              )}
            </p>
            <div className="grid grid-cols-5 md:grid-cols-8 gap-1.5">
              {thumbnails.map((src, i) => (
                <div key={i} className="relative aspect-square rounded overflow-hidden bg-gray-100">
                  <img src={src} alt="" className="w-full h-full object-cover" />
                  <span className="absolute bottom-0 left-0 bg-black/60 text-white text-[9px] px-1">{i + 1}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {prepared.length > 0 && !uploading && (
          <div className="flex gap-3">
            <button onClick={() => fileRef.current?.click()}
              className="flex-1 py-3 rounded-lg border border-emerald-600 text-emerald-600 font-semibold">
              + 추가
            </button>
            <button onClick={startPreview}
              className="flex-1 py-3 rounded-lg bg-emerald-600 text-white font-semibold">
              블러 확인 →
            </button>
          </div>
        )}
      </div>
    );
  }

  // ===== Step 2.5: 블러 미리보기 (사용자 확인) =====
  if (step === "preview") {
    const blurCount = prepared.filter((p) => p.hasBlur).length;

    function removePhoto(idx: number) {
      setPrepared((prev) => prev.filter((_, i) => i !== idx));
      setBlurPreviews((prev) => prev.filter((_, i) => i !== idx));
      setThumbnails((prev) => prev.filter((_, i) => i !== idx));
      setPreviewViewerIdx(null);
    }

    // 블러 잘못 처리된 사진(주소판·필요 부분 가림 등) 원본으로 복구
    // faces=[] 로 보내면 서버가 _blur 파일 생성 안 함 → 자동으로 원본 표시
    async function unblurPhoto(idx: number) {
      const photo = prepared[idx];
      if (!photo || !photo.hasBlur) return;
      const ok = window.confirm(
        `${idx + 1}번 사진의 블러를 해제합니다.\n\n원본 그대로 업로드되며, 얼굴이 포함된 경우 노출 위험이 있습니다. 계속하시겠습니까?`
      );
      if (!ok) return;

      const newThumb = await createThumbnail(photo.blob);
      const newPreviewUrl = URL.createObjectURL(photo.blob);

      setPrepared((prev) => {
        const next = [...prev];
        next[idx] = { ...next[idx], hasBlur: false, faces: [], blurredBlob: photo.blob };
        return next;
      });
      setBlurPreviews((prev) => {
        const next = [...prev];
        if (next[idx]) URL.revokeObjectURL(next[idx]);
        next[idx] = newPreviewUrl;
        return next;
      });
      if (newThumb) {
        setThumbnails((prev) => {
          const next = [...prev];
          next[idx] = newThumb;
          return next;
        });
      }
    }

    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-gray-900">
            개인정보 보호 확인
          </h3>
          <button onClick={() => setStep("photos")} className="text-sm text-emerald-600">← 뒤로</button>
        </div>

        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
          <p className="text-sm text-amber-800 font-medium">
            {blurCount > 0
              ? `${prepared.length}장 중 ${blurCount}장에서 얼굴이 감지되어 블러 처리되었습니다.`
              : `${prepared.length}장 — 얼굴이 감지되지 않았습니다.`}
          </p>
          <p className="text-xs text-amber-600 mt-1">
            사진을 터치하면 크게 볼 수 있습니다. 블러가 미흡하면 ×로 삭제, 잘못 가려졌으면 "블러 ↺" 배지를 탭해 원본으로 복구.
          </p>
        </div>

        {/* 블러 미리보기 그리드 */}
        <div className="grid grid-cols-3 md:grid-cols-5 gap-2">
          {prepared.map((p, i) => (
            <div key={i} className={`relative aspect-square rounded-lg overflow-hidden bg-gray-100 border-2 ${
              p.hasBlur ? "border-amber-400" : "border-transparent"
            }`}>
              <button type="button" onClick={() => setPreviewViewerIdx(i)} className="w-full h-full">
                <img src={blurPreviews[i] || ""} alt="" className="w-full h-full object-cover" />
              </button>
              <span className="absolute bottom-0 left-0 bg-black/60 text-white text-[9px] px-1">{i + 1}</span>
              {p.hasBlur && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); unblurPhoto(i); }}
                  className="absolute top-1 left-1 bg-amber-500 hover:bg-amber-600 active:scale-95 text-white text-[9px] font-semibold px-1.5 py-0.5 rounded shadow"
                  title="탭하면 원본으로 복구 (주소판·필요 부분이 가려진 경우)"
                >
                  블러 ↺
                </button>
              )}
              <button type="button"
                onClick={(e) => { e.stopPropagation(); removePhoto(i); }}
                className="absolute top-1 right-1 w-6 h-6 rounded-full bg-red-500/80 text-white flex items-center justify-center text-xs font-bold"
                title="삭제"
              >
                ×
              </button>
            </div>
          ))}
        </div>

        <button onClick={confirmAndUpload}
          disabled={prepared.length === 0}
          className="w-full py-3 rounded-lg bg-emerald-600 text-white font-semibold disabled:opacity-50">
          {prepared.length}장 확인 완료 — 등록 + AI 분석 →
        </button>

        {/* 상세 보기 (PhotoViewer) */}
        {previewViewerIdx !== null && (
          <PhotoViewer
            photos={blurPreviews}
            initialIdx={previewViewerIdx}
            onClose={() => setPreviewViewerIdx(null)}
            caption="블러 확인 (터치로 확대)"
          />
        )}
      </div>
    );
  }

  // ===== Step 3: AI 분석 중 =====
  if (step === "analyze") {
    return (
      <div className="flex flex-col items-center justify-center min-h-[40vh] space-y-4">
        <div className="w-12 h-12 border-4 border-emerald-200 border-t-emerald-600 rounded-full animate-spin" />
        <p className="text-sm text-gray-600">
          {uploading ? "서버 업로드 중..." : "사진 분석 중... 주소판 인식 + 그룹핑"}
        </p>
        <p className="text-xs text-gray-400">{prepared.length}장</p>
      </div>
    );
  }

  // ===== Step 4: 그룹별 리뷰 =====
  if (step === "review") {
    async function handleSubmit() {
      setSubmitting(true);
      try {
        const entries = groups.map((g) => {
          // 그룹의 가장 이른 사진 EXIF 촬영시각을 대표 시각으로 사용
          const photoDates = g.photoIndices
            .map((idx) => uploadedFiles[idx - 1]?.exif?.date)
            .filter((d): d is string => !!d)
            .sort();
          const originalPhotoTime = photoDates[0] || null;
          return {
            category: g.category,
            photoUrls: g.photoIndices.map((idx) => uploadedFiles[idx - 1]?.url).filter(Boolean),
            memo: g.aiReasoning
              ? (g.memo ? `${g.memo}\n[AI] ${g.aiReasoning}` : `[AI] ${g.aiReasoning}`)
              : g.memo,
            addressText: g.address,
            addressTextAi: g.originalAddressAi || null, // AI 첫 제안 (정정 학습용)
            latitude: uploadedFiles[g.photoIndices[0] - 1]?.exif?.lat,
            longitude: uploadedFiles[g.photoIndices[0] - 1]?.exif?.lng,
            originalPhotoTime,
            zoneId: g.zoneId || null,
          };
        });

        const res = await fetch("/api/entries/batch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ entryDate, entries }),
        });
        const data = await res.json();
        if (res.ok) { setResult(data); setStep("done"); }
        else alert(data.error || "제출 실패");
      } catch { alert("네트워크 오류"); }
      setSubmitting(false);
    }

    function applyMerge() {
      if (selectedMergeIdxs.length < 2) {
        alert("2개 이상 그룹을 선택하세요");
        return;
      }
      const sorted = [...selectedMergeIdxs].sort((a, b) => a - b);
      const allIndices = Array.from(
        new Set(sorted.flatMap((i) => groups[i].photoIndices))
      ).sort((a, b) => a - b);

      // 첫 그룹의 메타 유지 (주소/메모/zone/category)
      const target = groups[sorted[0]];
      const merged: PhotoGroup = {
        ...target,
        photoIndices: allIndices,
        needsReview: allIndices.length >= 7,
      };

      // 선택된 그룹 제거 후 첫 위치에 머지된 그룹 삽입
      const result: PhotoGroup[] = [];
      let inserted = false;
      for (let i = 0; i < groups.length; i++) {
        if (sorted.includes(i)) {
          if (!inserted) {
            result.push(merged);
            inserted = true;
          }
        } else {
          result.push(groups[i]);
        }
      }

      setGroups(result);
      setMergeMode(false);
      setSelectedMergeIdxs([]);
    }

    function toggleMergeSelect(gi: number) {
      setSelectedMergeIdxs((prev) =>
        prev.includes(gi) ? prev.filter((i) => i !== gi) : [...prev, gi]
      );
    }

    /** AI 병합:
     *  1) 같은 zoneId 그룹 자동 머지
     *  2) zone 없어도 같은 주소(addressText) 그룹 자동 머지
     *  3) 둘 다 없으면 그대로 유지
     */
    function applyAiMerge() {
      const byZone = new Map<string, number[]>();
      const byAddress = new Map<string, number[]>(); // 정규화된 주소 → indexes
      const orphan: number[] = []; // zone 없고 주소도 없음

      groups.forEach((g, idx) => {
        if (g.zoneId) {
          if (!byZone.has(g.zoneId)) byZone.set(g.zoneId, []);
          byZone.get(g.zoneId)!.push(idx);
        } else if (g.address?.trim()) {
          const normalized = g.address.replace(/\s/g, "");
          if (!byAddress.has(normalized)) byAddress.set(normalized, []);
          byAddress.get(normalized)!.push(idx);
        } else {
          orphan.push(idx);
        }
      });

      // 합칠 게 있는지 확인
      const zoneMergeable = Array.from(byZone.values()).filter((a) => a.length >= 2).length;
      const addrMergeable = Array.from(byAddress.values()).filter((a) => a.length >= 2).length;
      if (zoneMergeable === 0 && addrMergeable === 0) {
        alert("같은 구역 또는 같은 주소의 중복 그룹이 없습니다");
        return;
      }

      const newGroups: PhotoGroup[] = [];

      const mergeBucket = (idxs: number[]) => {
        if (idxs.length === 1) {
          newGroups.push(groups[idxs[0]]);
          return;
        }
        const allIndices = Array.from(
          new Set(idxs.flatMap((i) => groups[i].photoIndices))
        ).sort((a, b) => a - b);
        const target = groups[idxs[0]]; // 가장 먼저 등장한 그룹
        newGroups.push({
          ...target,
          photoIndices: allIndices,
          needsReview: allIndices.length >= 7,
        });
      };

      // 1) zone별 머지
      for (const [, idxs] of byZone) mergeBucket(idxs);

      // 2) 같은 주소 머지 (zone 없는 그룹 중)
      for (const [, idxs] of byAddress) mergeBucket(idxs);

      // 3) zone도 주소도 없는 orphan 그룹은 그대로
      for (const idx of orphan) newGroups.push(groups[idx]);

      // 첫 photoIndex 기준 자연 순서로 정렬
      newGroups.sort(
        (a, b) => Math.min(...a.photoIndices) - Math.min(...b.photoIndices)
      );

      setGroups(newGroups);
      setMergeMode(false);
      setSelectedMergeIdxs([]);
    }

    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-gray-900">
            {groups.length}개 그룹 · {uploadedFiles.length}장
          </h3>
          <button onClick={() => setStep("photos")} className="text-sm text-emerald-600">← 뒤로</button>
        </div>

        {/* 병합 모드 툴바 */}
        {groups.length > 1 && (
          <div className="bg-blue-50 rounded-lg px-3 py-2 border border-blue-200 space-y-1.5">
            {!mergeMode ? (
              <div className="flex items-center justify-between">
                <span className="text-xs text-blue-700">여러 그룹을 선택해 하나로 합치려면</span>
                <button
                  onClick={() => { setMergeMode(true); setSelectedMergeIdxs([]); }}
                  className="text-xs px-2.5 py-1 rounded-md bg-blue-600 text-white font-semibold"
                >
                  병합 모드
                </button>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-blue-700 font-semibold">
                    {selectedMergeIdxs.length}개 선택됨
                  </span>
                  <div className="flex gap-1.5">
                    <button
                      onClick={applyMerge}
                      disabled={selectedMergeIdxs.length < 2}
                      className="text-xs px-2.5 py-1 rounded-md bg-blue-600 text-white font-semibold disabled:opacity-40"
                    >
                      {selectedMergeIdxs.length}개 병합
                    </button>
                    <button
                      onClick={() => { setMergeMode(false); setSelectedMergeIdxs([]); }}
                      className="text-xs px-2.5 py-1 rounded-md border border-gray-300 text-gray-600"
                    >
                      취소
                    </button>
                  </div>
                </div>
                {/* AI 병합: 같은 zoneId 또는 같은 주소 자동 합치기 */}
                <div className="flex items-center justify-between pt-1 border-t border-blue-200">
                  <span className="text-[10px] text-blue-600">같은 구역 또는 같은 주소 그룹 자동 병합</span>
                  <button
                    onClick={applyAiMerge}
                    className="text-[10px] px-2 py-0.5 rounded-md bg-purple-600 text-white font-semibold"
                    title="zoneId가 같거나, 주소(파란 칸)가 완전 일치하는 그룹들을 한 번에 병합"
                  >
                    🤖 AI 병합
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {groups.map((group, gi) => {
          const catInfo = CATEGORY_MAP[group.category];
          const photoCount = group.photoIndices.length;
          const quantity = Math.max(1, Math.ceil(photoCount / 5));

          return (
            <div
              key={group.photoIndices.join(",")}
              className={`bg-white rounded-xl border p-4 space-y-3 ${
                mergeMode && selectedMergeIdxs.includes(gi)
                  ? "border-blue-500 ring-2 ring-blue-200"
                  : group.needsReview || photoCount >= 7
                  ? "border-amber-400 ring-2 ring-amber-100"
                  : "border-gray-200"
              }`}
            >
              {/* 그룹 헤더 */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 flex-wrap">
                  {mergeMode && (
                    <input
                      type="checkbox"
                      checked={selectedMergeIdxs.includes(gi)}
                      onChange={() => toggleMergeSelect(gi)}
                      className="w-4 h-4 accent-blue-600 cursor-pointer"
                    />
                  )}
                  <span className="text-sm font-bold text-emerald-700">그룹 {gi + 1}</span>
                  {(group.needsReview || photoCount >= 7) && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 font-semibold">
                      검토 필요 ({photoCount}장)
                    </span>
                  )}
                  {photoCount > 1 && (
                    <button
                      type="button"
                      onClick={() => setSplitGroupIdx(gi)}
                      className="text-[10px] px-1.5 py-0.5 rounded border border-blue-400 text-blue-700 hover:bg-blue-50"
                      title="이 그룹을 사진별 번호로 단순 분할 (구역 없이도 가능)"
                    >
                      그룹 분할
                    </button>
                  )}
                  {zones.length > 0 && photoCount > 1 && (
                    <button
                      type="button"
                      onClick={() => setRedistGroupIdx(gi)}
                      className="text-[10px] px-1.5 py-0.5 rounded border border-emerald-400 text-emerald-700 hover:bg-emerald-50"
                      title="이 그룹의 사진을 사진별로 다른 구역에 재배정"
                    >
                      구역 분배
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setMapGroupIdx(gi)}
                    className="text-[10px] px-1.5 py-0.5 rounded border border-violet-400 text-violet-700 hover:bg-violet-50"
                    title={group.address ? "지도에서 보기 / 위치 선택" : "지도에서 위치 선택"}
                  >
                    🗺 {group.address ? "지도" : "위치 선택"}
                  </button>
                </div>
                <span className="text-xs text-gray-400">{photoCount}장 · {quantity}{catInfo?.unit}</span>
              </div>

              {/* AI 판단 근거 (접힘) */}
              {group.aiReasoning && (
                <details className="text-[10px] text-gray-400">
                  <summary className="cursor-pointer hover:text-gray-600">🤖 AI 판단 근거</summary>
                  <p className="mt-1 pl-3 border-l-2 border-gray-200">{group.aiReasoning}</p>
                </details>
              )}

              {/* 썸네일 미리보기 (클릭 → 크게보기) */}
              <div className="flex gap-1 overflow-x-auto pb-1">
                {group.photoIndices.slice(0, 6).map((idx, posInGroup) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => setViewer({ groupIdx: gi, photoIdx: posInGroup })}
                    className="w-12 h-12 rounded overflow-hidden bg-gray-100 shrink-0 hover:ring-2 hover:ring-emerald-400 transition-all"
                  >
                    {thumbnails[idx - 1] && (
                      <img src={thumbnails[idx - 1]} alt="" className="w-full h-full object-cover pointer-events-none" />
                    )}
                  </button>
                ))}
                {photoCount > 6 && (
                  <button
                    type="button"
                    onClick={() => setViewer({ groupIdx: gi, photoIdx: 6 })}
                    className="w-12 h-12 rounded bg-gray-200 flex items-center justify-center text-xs text-gray-500 shrink-0 hover:bg-gray-300"
                  >
                    +{photoCount - 6}
                  </button>
                )}
              </div>

              {/* 주소 */}
              <input
                type="text"
                value={group.address}
                onChange={(e) => {
                  const updated = [...groups];
                  updated[gi] = { ...group, address: e.target.value };
                  setGroups(updated);
                }}
                placeholder="위치/주소"
                className={`w-full px-3 py-2 border rounded-lg text-sm ${
                  group.address ? "border-blue-300 bg-blue-50" : "border-gray-300"
                }`}
              />

              {/* 상습지역 구역 선택 (zones 있을 때만) */}
              {zones.length > 0 && (
                <div>
                  <label className="block text-[10px] text-gray-500 mb-1">상습지역 구역</label>
                  <select
                    value={group.zoneId || ""}
                    onChange={(e) => {
                      const newId = e.target.value || null;
                      const matched = zones.find((z) => z.id === newId);
                      const updated = [...groups];
                      updated[gi] = {
                        ...group,
                        zoneId: newId,
                        zoneSeqNo: matched?.seqNo || null,
                        zoneLandmark: matched?.landmark || null,
                        address: matched?.address || group.address,
                      };
                      setGroups(updated);
                    }}
                    className={`w-full px-2 py-1.5 border rounded-lg text-xs ${
                      group.zoneId ? "border-emerald-300 bg-emerald-50" : "border-gray-300"
                    }`}
                  >
                    <option value="">(미지정)</option>
                    {zones.map((z) => (
                      <option key={z.id} value={z.id}>
                        {z.seqNo}. {z.landmark} — {z.address}
                      </option>
                    ))}
                  </select>
                  {group.zoneLandmark && !group.zoneId && (
                    <p className="text-[10px] text-emerald-600 mt-0.5">AI 추천: {group.zoneLandmark}</p>
                  )}
                </div>
              )}

              {/* 카테고리 + 메모 */}
              <div className="flex gap-2">
                <select
                  value={group.category}
                  onChange={(e) => {
                    const updated = [...groups];
                    updated[gi] = { ...group, category: e.target.value };
                    setGroups(updated);
                  }}
                  className="flex-1 px-2 py-1.5 border border-gray-300 rounded-lg text-xs"
                >
                  {CATEGORIES.map((c) => (
                    <option key={c.id} value={c.id}>{c.label}</option>
                  ))}
                </select>
                <input
                  type="text"
                  value={group.memo}
                  onChange={(e) => {
                    const updated = [...groups];
                    updated[gi] = { ...group, memo: e.target.value };
                    setGroups(updated);
                  }}
                  placeholder="메모"
                  className="flex-1 px-2 py-1.5 border border-gray-300 rounded-lg text-xs"
                />
              </div>
            </div>
          );
        })}

        <button onClick={handleSubmit} disabled={submitting}
          className="w-full py-3 rounded-lg bg-emerald-600 text-white font-semibold disabled:opacity-50">
          {submitting ? "제출 중..." : `${groups.length}건 제출`}
        </button>

        {/* 사진 뷰어 (그룹 내 사진만) */}
        {viewer && groups[viewer.groupIdx] && (
          <PhotoViewer
            photos={groups[viewer.groupIdx].photoIndices.map((idx) => blurPreviews[idx - 1] || uploadedFiles[idx - 1]?.url).filter(Boolean) as string[]}
            initialIdx={viewer.photoIdx}
            onClose={() => setViewer(null)}
            caption={`그룹 ${viewer.groupIdx + 1}${groups[viewer.groupIdx].address ? ` · ${groups[viewer.groupIdx].address}` : ""}`}
            addressInput={{
              value: groups[viewer.groupIdx].address,
              onChange: (v) => {
                const updated = [...groups];
                updated[viewer.groupIdx] = { ...updated[viewer.groupIdx], address: v };
                setGroups(updated);
              },
              placeholder: "주소 입력/수정",
            }}
          />
        )}

        {/* 구역 분배 (TrackB 로컬 — 그룹을 N개로 분할) */}
        {redistGroupIdx !== null && groups[redistGroupIdx] && (
          <RedistributeModal
            photoUrls={groups[redistGroupIdx].photoIndices
              .map((idx) => blurPreviews[idx - 1] || uploadedFiles[idx - 1]?.url)
              .filter(Boolean) as string[]}
            initialZoneId={groups[redistGroupIdx].zoneId || null}
            zones={zones}
            onClose={() => setRedistGroupIdx(null)}
            onApply={(assignments) => {
              const target = groups[redistGroupIdx];
              // 표시용 URL → photoIndex 매핑 (블러 또는 서버 URL)
              const urlToIdx = new Map<string, number>();
              for (const idx of target.photoIndices) {
                const displayUrl = blurPreviews[idx - 1] || uploadedFiles[idx - 1]?.url;
                if (displayUrl) urlToIdx.set(displayUrl, idx);
              }

              // zoneId별 photoIndex 묶기
              const buckets = new Map<string, number[]>();
              for (const a of assignments) {
                const key = a.zoneId || "__none__";
                const idx = urlToIdx.get(a.photoUrl);
                if (idx == null) continue;
                if (!buckets.has(key)) buckets.set(key, []);
                buckets.get(key)!.push(idx);
              }

              // 새 그룹 생성
              const newGroups: PhotoGroup[] = [];
              for (const [key, indices] of buckets) {
                const zone = key === "__none__" ? null : zones.find((z) => z.id === key);
                newGroups.push({
                  address: zone?.address || (key === "__none__" ? target.address : ""),
                  description: target.description,
                  photoIndices: indices.sort((a, b) => a - b),
                  category: target.category,
                  memo: zone
                    ? (target.memo ? `${target.memo} [${zone.landmark}]` : `[${zone.landmark}]`)
                    : target.memo,
                  zoneId: zone?.id || null,
                  zoneSeqNo: zone?.seqNo || null,
                  zoneLandmark: zone?.landmark || null,
                });
              }

              // 원본 그룹 → N개 새 그룹으로 교체
              const updated = [...groups];
              updated.splice(redistGroupIdx, 1, ...newGroups);
              setGroups(updated);
              setRedistGroupIdx(null);
            }}
          />
        )}

        {/* 그룹 분할 (TrackB 로컬 — zone 없이 단순 분할) */}
        {splitGroupIdx !== null && groups[splitGroupIdx] && (
          <SplitGroupModal
            photoUrls={groups[splitGroupIdx].photoIndices
              .map((idx) => blurPreviews[idx - 1] || uploadedFiles[idx - 1]?.url)
              .filter(Boolean) as string[]}
            onClose={() => setSplitGroupIdx(null)}
            onApply={(splitGroups) => {
              const target = groups[splitGroupIdx];
              // 표시용 URL → photoIndex 매핑 (블러 또는 서버 URL)
              const urlToIdx = new Map<string, number>();
              for (const idx of target.photoIndices) {
                const displayUrl = blurPreviews[idx - 1] || uploadedFiles[idx - 1]?.url;
                if (displayUrl) urlToIdx.set(displayUrl, idx);
              }

              // 새 그룹 생성 (각 sub-array가 새 그룹, 원본의 메타 유지)
              const newGroups: PhotoGroup[] = splitGroups.map((urls) => {
                const indices = urls
                  .map((u) => urlToIdx.get(u))
                  .filter((i): i is number => i != null)
                  .sort((a, b) => a - b);
                return {
                  address: target.address,
                  description: target.description,
                  photoIndices: indices,
                  category: target.category,
                  memo: target.memo,
                  zoneId: target.zoneId || null,
                  zoneSeqNo: target.zoneSeqNo || null,
                  zoneLandmark: target.zoneLandmark || null,
                  needsReview: false, // 분할 후에는 작아지므로 해제
                };
              });

              const updated = [...groups];
              updated.splice(splitGroupIdx, 1, ...newGroups);
              setGroups(updated);
              // iOS PWA: 진행 중인 click 이벤트가 끝나기 전에 모달이 unmount되면
              // 잔존 터치가 하단 요소에 잘못 매핑돼 클릭 무반응이 발생할 수 있음.
              // 다음 매크로태스크로 미뤄 이벤트 시퀀스 완결 후 unmount.
              setTimeout(() => setSplitGroupIdx(null), 0);
            }}
          />
        )}

        {/* 지도 미리보기 — 그룹 주소 빠른 확인 + 위치 선택 */}
        {mapGroupIdx !== null && groups[mapGroupIdx] && (() => {
          // EXIF GPS 우선 사용 — 주소 문자열 forward-geocoding은 "동 (도로명)" 괄호 포맷에서 깨짐
          const repExif = uploadedFiles[groups[mapGroupIdx].photoIndices[0] - 1]?.exif;
          return (
            <AddressMapModal
              address={groups[mapGroupIdx].address || undefined}
              lat={repExif?.lat}
              lng={repExif?.lng}
              title={`그룹 ${mapGroupIdx + 1}`}
              label={String(mapGroupIdx + 1)}
              onClose={() => setMapGroupIdx(null)}
              onLocationSelect={(addr) => {
                const updated = [...groups];
                updated[mapGroupIdx] = { ...updated[mapGroupIdx], address: addr };
                setGroups(updated);
              }}
            />
          );
        })()}
      </div>
    );
  }

  // ===== Step 5: 완료 =====
  return (
    <div className="flex flex-col items-center justify-center min-h-[40vh] space-y-4">
      <div className="w-16 h-16 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center text-3xl">✓</div>
      <h2 className="text-xl font-bold text-gray-900">입력 완료</h2>
      <p className="text-sm text-gray-500">{result?.count}건 등록됨</p>
      <button onClick={() => {
        setStep("pool"); setUploadedFiles([]); setThumbnails([]); setGroups([]); setResult(null);
      }} className="px-6 py-2 rounded-lg bg-emerald-600 text-white font-semibold">
        추가 입력
      </button>
    </div>
  );
}
