"use client";

import { useState, useEffect, useRef } from "react";
import { CATEGORIES, CATEGORY_MAP } from "@/lib/categories";

// 역할별 카테고리
const SAFETY_IDS = ["road_clean", "road_mgmt", "safety_check", "building_check", "night_patrol", "flood_control", "etc"];
const ADMIN_IDS = [
  "road_clean", "road_mgmt", "alley_clean", "illegal_dump", "warning_post",
  "night_patrol", "patrol_check", "special_mgmt", "greenery", "streetlight",
  "snow_removal", "safety_check", "building_check", "flood_control", "etc",
];
const SAFETY_CAT_LIST = CATEGORIES.filter((c) => SAFETY_IDS.includes(c.id));
const ADMIN_CAT_LIST = CATEGORIES.filter((c) => ADMIN_IDS.includes(c.id));
import { compressImage, uploadPhotosChunked, createThumbnail, extractExif } from "@/lib/image-utils";
import { todayKr } from "@/lib/date";

interface TodayEntry {
  id: string;
  category: string;
  evalItem: string;
  photoCount: number;
  quantity: number;
  unit: string;
  memo: string | null;
  addressText: string | null;
  inputTrack: string;
  createdAt: string;
}

interface UploadedPhoto {
  url: string;
  filename: string;
  exif?: { lat?: number; lng?: number; date?: string; heading?: number } | null;
}

/** 카메라 방향(방위각)으로 GPS 좌표 전진 — 카메라가 향하는 위치 추정 */
function projectForward(lat: number, lng: number, heading: number, meters: number): { lat: number; lng: number } {
  // 1° 위도 ≈ 111,320m, 경도 ≈ 111,320 * cos(lat)m
  const rad = (heading * Math.PI) / 180;
  const dLat = (meters * Math.cos(rad)) / 111320;
  const dLng = (meters * Math.sin(rad)) / (111320 * Math.cos((lat * Math.PI) / 180));
  return { lat: lat + dLat, lng: lng + dLng };
}

export default function TrackA() {
  const [category, setCategory] = useState("road_clean");
  const [memo, setMemo] = useState("");
  const [photos, setPhotos] = useState<UploadedPhoto[]>([]);
  const [thumbnails, setThumbnails] = useState<(string | null)[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState({ phase: "", done: 0, total: 0 });
  const [submitting, setSubmitting] = useState(false);
  const [addressText, setAddressText] = useState("");
  const [gps, setGps] = useState<{ lat: number; lng: number } | null>(null);
  const [gpsStatus, setGpsStatus] = useState<"idle" | "loading" | "ok" | "fail">("idle");
  const [gpsAddress, setGpsAddress] = useState<string | null>(null);
  const [geocoding, setGeocoding] = useState(false);
  const [todayEntries, setTodayEntries] = useState<TodayEntry[]>([]);
  const [toast, setToast] = useState("");
  const [classifying, setClassifying] = useState(false);
  const [detail, setDetail] = useState<any>(null);
  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [aiSuggestion, setAiSuggestion] = useState<{ category: string; address: string | null; memo: string; needsAnonymization: boolean } | null>(null);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [viewPhotoIdx, setViewPhotoIdx] = useState<number | null>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/auth/me").then((r) => r.json()).then((d) => setUserRole(d.role));
  }, []);

  useEffect(() => {
    // GPS는 HTTPS에서만 동작 — HTTP IP 접속 시 자동 실패 처리
    if (typeof navigator !== "undefined" && navigator.geolocation) {
      setGpsStatus("loading");
      navigator.geolocation.getCurrentPosition(
        (pos) => { setGps({ lat: pos.coords.latitude, lng: pos.coords.longitude }); setGpsStatus("ok"); },
        () => setGpsStatus("fail"),
        { enableHighAccuracy: true, timeout: 5000 }
      );
    } else {
      setGpsStatus("fail");
    }
  }, []);

  // GPS 변경 시 자동 역지오코딩
  useEffect(() => {
    if (!gps) return;
    setGeocoding(true);
    fetch(`/api/geocode?lat=${gps.lat}&lng=${gps.lng}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.address) {
          setGpsAddress(data.address);
          // 사용자가 입력 안 했으면 자동 채움
          setAddressText((prev) => prev || data.address);
        }
      })
      .catch(() => { /* 무시 */ })
      .finally(() => setGeocoding(false));
  }, [gps]);

  useEffect(() => { loadToday(); }, []);

  async function loadToday() {
    const res = await fetch("/api/entries?date=" + todayKr());
    if (res.ok) setTodayEntries(await res.json());
  }

  /** 카메라 촬영 — 1장 */
  async function handleCapture(file: File | undefined) {
    console.log("[A-CAP-1] handleCapture", file?.name, file?.size, file?.type);
    if (!file) return;
    setUploading(true);
    try {
      console.log("[A-CAP-2] compressImage 시작");
      const blob = await compressImage(file);
      console.log("[A-CAP-3] compressImage 완료, blob=", !!blob);
      if (!blob) { setUploading(false); alert("이미지 압축 실패"); return; }

      console.log("[A-CAP-4] createThumbnail 시작");
      const thumb = await createThumbnail(file);
      console.log("[A-CAP-5] thumbnail=", !!thumb);
      setThumbnails((prev) => [...prev, thumb]);

      const formData = new FormData();
      formData.append("photos", blob, file.name);
      console.log("[A-CAP-6] extractExif 시작");
      const exif = await extractExif(file);
      console.log("[A-CAP-7] exif=", exif);
      formData.append("exifData", JSON.stringify([exif]));
      console.log("[A-CAP-8] /api/uploads 전송");
      const res = await fetch("/api/uploads", { method: "POST", body: formData });
      console.log("[A-CAP-9] 응답", res.status);
      if (res.ok) {
        const data = await res.json();
        if (data.files?.[0]) {
          const f = data.files[0];
          setPhotos((prev) => [...prev, { url: f.url, filename: f.filename, exif: f.exif }]);
          if (f.exif?.lat && f.exif?.lng) {
            const target = typeof f.exif.heading === "number"
              ? projectForward(f.exif.lat, f.exif.lng, f.exif.heading, 5)
              : { lat: f.exif.lat, lng: f.exif.lng };
            setGps(target);
            setGpsStatus("ok");
          }
          if (photos.length === 0) classifyInBackground(blob);
        }
      } else {
        alert("업로드 실패: " + res.status);
      }
    } catch (err) {
      console.error("[A-CAP-ERR]", err);
      alert("촬영 업로드 오류: " + (err instanceof Error ? err.message : String(err)));
    }
    setUploading(false);
  }

  /** 갤러리 — 다중 선택 */
  async function handleGallery(files: FileList | null) {
    console.log("[A-GAL-1] handleGallery", files?.length);
    if (!files?.length) return;
    // CRITICAL: FileList 스냅샷을 첫 await 전에 확보
    const arr = Array.from(files);
    console.log("[A-GAL-1b] snapshot=", arr.length);
    setUploading(true);
    try {
      console.log("[A-GAL-2] files=", arr.map((f) => ({ name: f.name, size: f.size, type: f.type })));
      setUploadProgress({ phase: "compress", done: 0, total: arr.length });

      console.log("[A-GAL-3] 썸네일 생성");
      const thumbs = await Promise.all(arr.map((f) => createThumbnail(f)));
      console.log("[A-GAL-4] 썸네일 완료", thumbs.filter(Boolean).length, "/", arr.length);
      setThumbnails((prev) => [...prev, ...thumbs]);

      console.log("[A-GAL-5] uploadPhotosChunked 시작");
      const results = await uploadPhotosChunked(arr, 10, (phase, done, total) => {
        console.log(`[A-GAL-upload] ${phase} ${done}/${total}`);
        setUploadProgress({ phase, done, total });
      });
      console.log("[A-GAL-6] 업로드 완료", results.length);

      setPhotos((prev) => [...prev, ...results.map((r) => ({ url: r.url, filename: r.filename, exif: r.exif }))]);

      const withGps = results.find((r) => r.exif?.lat && r.exif?.lng);
      if (withGps?.exif) {
        const target = typeof withGps.exif.heading === "number"
          ? projectForward(withGps.exif.lat!, withGps.exif.lng!, withGps.exif.heading, 5)
          : { lat: withGps.exif.lat!, lng: withGps.exif.lng! };
        setGps(target);
        setGpsStatus("ok");
      }

      if (photos.length === 0 && results.length > 0) {
        const firstBlob = await compressImage(arr[0]);
        if (firstBlob) classifyInBackground(firstBlob);
      }
    } catch (err) {
      console.error("[A-GAL-ERR]", err);
      alert("갤러리 업로드 오류: " + (err instanceof Error ? err.message : String(err)));
    }
    setUploading(false);
  }

  async function classifyInBackground(blob: Blob) {
    setClassifying(true);
    setAiSuggestion(null);
    try {
      const base64 = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve((reader.result as string).replace(/^data:image\/\w+;base64,/, ""));
        reader.readAsDataURL(blob);
      });
      const res = await fetch("/api/classify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: base64, mediaType: "image/jpeg" }),
      });
      if (res.ok) {
        const result = await res.json();
        setAiSuggestion(result);
        if (result.confidence !== "low" && result.category !== "etc") {
          setCategory(result.category);
          showToast(`AI: ${CATEGORY_MAP[result.category]?.label || result.category}`);
        }
        // AI가 주소를 인식하면 자동 입력
        if (result.address && !addressText) {
          setAddressText(result.address);
        }
      }
    } catch { /* API 키 미설정 — 무시 */ }
    setClassifying(false);
  }

  async function handleSubmit() {
    setSubmitting(true);
    try {
      const res = await fetch("/api/entries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category,
          photoUrls: photos.map((p) => p.url),
          memo: memo || undefined,
          addressText: addressText || undefined,
          latitude: gps?.lat,
          longitude: gps?.lng,
        }),
      });
      if (res.ok) {
        showToast(`${photos.length}장 등록 완료`);
        setPhotos([]);
        setThumbnails([]);
        setMemo("");
        setAddressText("");
        setAiSuggestion(null);
        loadToday();
        navigator.geolocation.getCurrentPosition(
          (pos) => setGps({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
          () => {}, { enableHighAccuracy: true, timeout: 5000 }
        );
      } else {
        const data = await res.json();
        alert(data.error || "등록 실패");
      }
    } catch { alert("네트워크 오류"); }
    setSubmitting(false);
  }

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(""), 2000);
  }

  function removePhoto(idx: number) {
    setPhotos((prev) => prev.filter((_, i) => i !== idx));
    setThumbnails((prev) => prev.filter((_, i) => i !== idx));
  }

  const catInfo = CATEGORY_MAP[category];

  return (
    <div className="space-y-5">
      {/* 카테고리 */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">카테고리</label>
        <select value={category} onChange={(e) => setCategory(e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
          {(userRole === "SAFETY" ? SAFETY_CAT_LIST : ADMIN_CAT_LIST).map((c) => (
            <option key={c.id} value={c.id}>{c.label}</option>
          ))}
        </select>
      </div>

      {/* 위치 정보 */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-sm">
          <span className={`w-2 h-2 rounded-full ${gpsStatus === "ok" ? "bg-emerald-500" : gpsStatus === "fail" ? "bg-gray-300" : "bg-yellow-400 animate-pulse"}`} />
          <span className="text-gray-500 truncate">
            {gpsStatus === "ok" ? (
              geocoding ? `GPS 위치 변환 중...` :
              gpsAddress ? `📍 ${gpsAddress}` :
              `GPS: ${gps!.lat.toFixed(5)}, ${gps!.lng.toFixed(5)}`
            ) : gpsStatus === "fail" ? "GPS 미사용 (사진 EXIF 또는 수동 입력)" : "GPS 수집 중..."}
          </span>
        </div>
        <input type="text" value={addressText} onChange={(e) => setAddressText(e.target.value)}
          placeholder="주소/위치 (자동 인식 또는 수동 입력)"
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
      </div>

      {/* 촬영/갤러리 버튼 */}
      <div className="flex gap-3">
        <button onClick={() => cameraRef.current?.click()}
          className="flex-1 py-3 rounded-lg bg-emerald-600 text-white font-semibold active:scale-95 transition-transform">
          📷 촬영
        </button>
        <button onClick={() => galleryRef.current?.click()}
          className="flex-1 py-3 rounded-lg border border-emerald-600 text-emerald-600 font-semibold active:scale-95 transition-transform">
          🖼 갤러리
        </button>
        <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden"
          onChange={(e) => { handleCapture(e.target.files?.[0]); e.target.value = ""; }} />
        <input ref={galleryRef} type="file" accept="image/*" multiple className="hidden"
          onChange={(e) => { handleGallery(e.target.files); e.target.value = ""; }} />
      </div>

      {/* 업로드 진행률 */}
      {uploading && (
        <div className="space-y-1">
          <div className="flex justify-between text-sm text-emerald-600">
            <span>{uploadProgress.phase === "compress" ? "압축 중..." : uploadProgress.total > 1 ? "업로드 중..." : "처리 중..."}</span>
            {uploadProgress.total > 1 && <span>{uploadProgress.done}/{uploadProgress.total}장</span>}
          </div>
          {uploadProgress.total > 1 && (
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div className="bg-emerald-600 h-2 rounded-full transition-all duration-300"
                style={{ width: `${uploadProgress.total ? (uploadProgress.done / uploadProgress.total) * 100 : 0}%` }} />
            </div>
          )}
        </div>
      )}

      {/* 사진 미리보기 */}
      {(photos.length > 0 || thumbnails.length > 0) && (
        <div className="space-y-2">
          <p className="text-sm font-medium text-gray-700">{photos.length}장 선택됨</p>
          <div className="grid grid-cols-4 md:grid-cols-6 gap-2">
            {(uploading && thumbnails.length > photos.length ? thumbnails : photos).map((item, i) => {
              if (!item) return null;
              const src = typeof item === "string" ? item : "url" in item ? item.url : null;
              if (!src) return null;
              return (
                <div key={i} className="relative aspect-square rounded-lg overflow-hidden bg-gray-100"
                  onClick={() => !uploading && i < photos.length && setViewPhotoIdx(i)}>
                  <img src={src} alt="" className="w-full h-full object-cover" />
                  {!uploading && (
                    <button onClick={(ev) => { ev.stopPropagation(); removePhoto(i); }}
                      className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/50 text-white text-xs flex items-center justify-center">×</button>
                  )}
                </div>
              );
            })}
          </div>

          {/* AI 분류 결과 */}
          {(classifying || aiSuggestion) && (
            <div className="bg-emerald-50 rounded-lg p-3">
              {classifying && <p className="text-xs text-emerald-600 animate-pulse">AI 분류 중...</p>}
              {aiSuggestion && (
                <div className="flex items-center justify-between gap-2">
                  <button
                    onClick={() => {
                      setCategory(aiSuggestion.category);
                      showToast(`카테고리 변경: ${CATEGORY_MAP[aiSuggestion.category]?.label}`);
                    }}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-sm font-medium transition-colors ${
                      category === aiSuggestion.category
                        ? "bg-emerald-600 text-white"
                        : "bg-white border border-emerald-400 text-emerald-700 hover:bg-emerald-100 active:scale-95"
                    }`}
                  >
                    <span className="text-xs">AI</span>
                    <span>{CATEGORY_MAP[aiSuggestion.category]?.label || aiSuggestion.category}</span>
                    {category !== aiSuggestion.category && <span className="text-xs">← 적용</span>}
                  </button>
                  <div className="flex items-center gap-2 shrink-0">
                    {aiSuggestion.address && <span className="text-xs text-gray-500">{aiSuggestion.address}</span>}
                    {aiSuggestion.needsAnonymization && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-100 text-red-600">비식별화 필요</span>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* 사진 상세보기 */}
      {viewPhotoIdx !== null && photos[viewPhotoIdx] && (
        <div className="fixed inset-0 bg-black/95 z-50 flex flex-col">
          {/* 헤더 */}
          <div className="flex items-center justify-between p-3 text-white shrink-0">
            <span className="text-sm">{viewPhotoIdx + 1} / {photos.length}</span>
            <button onClick={() => setViewPhotoIdx(null)} className="text-2xl leading-none">×</button>
          </div>
          {/* 사진 */}
          <div className="flex-1 flex items-center justify-center overflow-hidden px-2"
            onClick={() => setViewPhotoIdx(null)}>
            <img src={photos[viewPhotoIdx].url} alt=""
              className="max-w-full max-h-full object-contain"
              onClick={(e) => e.stopPropagation()} />
          </div>
          {/* 주소 입력 */}
          <div className="p-3 shrink-0">
            <input type="text" value={addressText} onChange={(e) => setAddressText(e.target.value)}
              placeholder="주소 입력/수정 (예: 후암로 123 앞)"
              className="w-full px-3 py-2 bg-white/10 border border-white/30 rounded-lg text-white text-sm placeholder-white/40"
              onClick={(e) => e.stopPropagation()} />
          </div>
          {/* 좌우 탐색 */}
          <div className="flex justify-center gap-6 pb-4 shrink-0">
            <button onClick={() => setViewPhotoIdx(Math.max(0, viewPhotoIdx - 1))}
              disabled={viewPhotoIdx === 0}
              className="px-5 py-2 rounded-lg bg-white/10 text-white text-sm disabled:opacity-20">
              ◀ 이전
            </button>
            <button onClick={() => setViewPhotoIdx(Math.min(photos.length - 1, viewPhotoIdx + 1))}
              disabled={viewPhotoIdx === photos.length - 1}
              className="px-5 py-2 rounded-lg bg-white/10 text-white text-sm disabled:opacity-20">
              다음 ▶
            </button>
          </div>
        </div>
      )}

      {/* 메모 */}
      <input type="text" value={memo} onChange={(e) => setMemo(e.target.value)}
        placeholder="메모 (선택)" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
        onKeyDown={(e) => { if (e.key === "Enter" && photos.length > 0) handleSubmit(); }} />

      {/* 등록 버튼 */}
      <button onClick={handleSubmit} disabled={submitting || photos.length === 0}
        className="w-full py-3 rounded-lg bg-emerald-600 text-white font-semibold disabled:opacity-50 active:scale-95 transition-transform">
        {submitting ? "등록 중..." : photos.length > 0
          ? `${catInfo?.label} ${photos.length}장 등록`
          : `사진을 선택하세요`}
      </button>

      {/* 토스트 */}
      {toast && (
        <div className="fixed bottom-20 left-1/2 -translate-x-1/2 bg-gray-800 text-white text-sm px-4 py-2 rounded-full shadow-lg z-50">
          {toast}
        </div>
      )}

      {/* 오늘 입력 내역 */}
      {todayEntries.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-medium text-gray-700">오늘 입력: {todayEntries.length}건</h3>
            <div className="flex gap-2">
              {selecting ? (
                <>
                  <button onClick={async () => {
                    if (!selectedIds.length) return;
                    if (!confirm(`선택한 ${selectedIds.length}건을 삭제하시겠습니까?`)) return;
                    await fetch("/api/entries/bulk-delete", {
                      method: "POST", headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ ids: selectedIds }),
                    });
                    setSelectedIds([]); setSelecting(false); loadToday();
                  }} className="text-xs text-red-500">{selectedIds.length}건 삭제</button>
                  <button onClick={() => { setSelecting(false); setSelectedIds([]); }} className="text-xs text-gray-400">취소</button>
                </>
              ) : (
                <button onClick={() => setSelecting(true)} className="text-xs text-gray-400">선택</button>
              )}
            </div>
          </div>
          <div className="space-y-2">
            {todayEntries.map((e) => (
              <div key={e.id} className="flex items-center gap-2">
                {selecting && (
                  <input type="checkbox" checked={selectedIds.includes(e.id)}
                    onChange={(ev) => setSelectedIds(ev.target.checked
                      ? [...selectedIds, e.id] : selectedIds.filter((x) => x !== e.id)
                    )} className="shrink-0" />
                )}
                <button onClick={async () => {
                  if (selecting) return;
                  const res = await fetch(`/api/entries/${e.id}`);
                  if (res.ok) setDetail(await res.json());
                }} className="flex-1 min-w-0 bg-white rounded-lg border border-gray-200 px-3 py-2 text-left hover:border-emerald-400 overflow-hidden">
                  <p className="text-sm font-medium break-words">{CATEGORY_MAP[e.category]?.label || e.category}</p>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className="text-xs text-gray-400">{e.photoCount}장</span>
                    <span className="text-xs text-gray-400">{e.createdAt?.slice(11, 16)}</span>
                  </div>
                  {e.memo && <p className="text-xs text-gray-400 break-words mt-0.5">{e.memo}</p>}
                </button>
              </div>
            ))}
          </div>
          {selecting && todayEntries.length > 1 && (
            <button onClick={() => setSelectedIds(
              selectedIds.length === todayEntries.length ? [] : todayEntries.map((e) => e.id)
            )} className="text-xs text-emerald-600 mt-2">
              {selectedIds.length === todayEntries.length ? "전체 해제" : "전체 선택"}
            </button>
          )}
        </div>
      )}

      {/* 상세 모달 */}
      {detail && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end md:items-center justify-center" onClick={() => setDetail(null)}>
          <div className="bg-white rounded-t-2xl md:rounded-2xl w-full max-w-lg max-h-[85vh] overflow-y-auto p-4 space-y-4" onClick={(ev) => ev.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold">{CATEGORY_MAP[detail.category]?.label}</h3>
              <button onClick={() => setDetail(null)} className="text-gray-400 text-xl">×</button>
            </div>
            <div className="space-y-2 text-sm">
              {[
                ["날짜", detail.entryDate],
                ["시간", detail.createdAt?.slice(11, 16)],
                ["위치", detail.addressText || "-"],
                ["메모", detail.memo || "-"],
                ["수량", `${detail.quantity}${detail.unit}`],
              ].map(([k, v]: any) => (
                <div key={k} className="flex justify-between">
                  <span className="text-gray-500">{k}</span>
                  <span className="font-medium">{v}</span>
                </div>
              ))}
            </div>
            {/* 카테고리 변경 */}
            <div>
              <label className="block text-xs text-gray-500 mb-1">카테고리 변경</label>
              <select
                defaultValue={detail.category}
                onChange={async (e) => {
                  await fetch(`/api/entries/${detail.id}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ category: e.target.value }),
                  });
                  showToast("카테고리 변경됨");
                  loadToday();
                  const res = await fetch(`/api/entries/${detail.id}`);
                  if (res.ok) setDetail(await res.json());
                }}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              >
                {CATEGORIES.map((c) => (
                  <option key={c.id} value={c.id}>{c.label}</option>
                ))}
              </select>
            </div>

            {detail.photoUrls?.length > 0 && (
              <div>
                <p className="text-sm font-medium text-gray-700 mb-2">현장사진 ({detail.photoUrls.length}장)</p>
                <div className="grid grid-cols-3 gap-2">
                  {detail.photoUrls.map((url: string, i: number) => (
                    <div key={i} className="aspect-square rounded-lg overflow-hidden bg-gray-100">
                      <img src={url} alt="" className="w-full h-full object-cover" />
                    </div>
                  ))}
                </div>
              </div>
            )}
            <button onClick={async () => {
              if (!confirm("이 항목을 삭제하시겠습니까?")) return;
              await fetch(`/api/entries/${detail.id}`, { method: "DELETE" });
              setDetail(null); loadToday();
            }} className="w-full py-2 text-sm text-red-500 border border-red-200 rounded-lg">
              삭제
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
