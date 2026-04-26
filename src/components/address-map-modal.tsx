"use client";

import { useEffect, useState } from "react";
import KakaoMap, { type MapMarker } from "./kakao-map";

interface AddressMapModalProps {
  /** 표시할 주소 (forward geocoding 적용) */
  address?: string;
  /** 또는 직접 좌표 */
  lat?: number;
  lng?: number;
  /** 모달 제목 */
  title?: string;
  /** 라벨 (예: "1") */
  label?: string;
  onClose: () => void;
  /** 위치 선택 모드 — 지도 터치 시 주소 자동 입력 */
  onLocationSelect?: (address: string, lat: number, lng: number) => void;
}

/**
 * 단일 위치 지도 미리보기 모달 (TrackB / Dashboard 양쪽 사용)
 * - address 주면 forward geocoding 후 표시
 * - lat/lng 직접 주면 즉시 표시
 * - onLocationSelect 주면: 지도 터치 → 역지오코딩 → "이 위치로 설정" 확인
 */
export default function AddressMapModal({
  address,
  lat,
  lng,
  title,
  label,
  onClose,
  onLocationSelect,
}: AddressMapModalProps) {
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(
    lat != null && lng != null ? { lat, lng } : null
  );
  const [loading, setLoading] = useState(!coords);
  const [error, setError] = useState<string | null>(null);

  // 위치 선택 상태
  const [selected, setSelected] = useState<{ lat: number; lng: number; address: string } | null>(null);
  const [resolving, setResolving] = useState(false);

  useEffect(() => {
    if (coords) return;
    if (!address) {
      // 주소도 좌표도 없으면 기본 위치(후암동)로 표시 (선택 모드에서 필요)
      if (onLocationSelect) {
        setCoords({ lat: 37.5505, lng: 126.9759 });
        setLoading(false);
        return;
      }
      setError("주소가 없습니다");
      setLoading(false);
      return;
    }

    setLoading(true);
    fetch(`/api/geocode?address=${encodeURIComponent(address)}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.coords) {
          setCoords(data.coords);
        } else {
          setError("주소를 좌표로 변환할 수 없습니다");
        }
      })
      .catch(() => setError("지도 조회 실패"))
      .finally(() => setLoading(false));
  }, [address, coords, onLocationSelect]);

  // 지도 클릭 → 역지오코딩 → 선택 상태 표시
  function handleMapClick(clickLat: number, clickLng: number) {
    if (!onLocationSelect) return;
    setResolving(true);
    setSelected(null);
    fetch(`/api/geocode?lat=${clickLat}&lng=${clickLng}`)
      .then((r) => r.json())
      .then((data) => {
        const addr = data.address || `${clickLat.toFixed(6)}, ${clickLng.toFixed(6)}`;
        setSelected({ lat: clickLat, lng: clickLng, address: addr });
      })
      .catch(() => {
        setSelected({ lat: clickLat, lng: clickLng, address: `${clickLat.toFixed(6)}, ${clickLng.toFixed(6)}` });
      })
      .finally(() => setResolving(false));
  }

  // 마커: 기존 위치(blue) + 선택 위치(red)
  const markers: MapMarker[] = [];
  if (coords) {
    markers.push({
      id: "original",
      lat: coords.lat,
      lng: coords.lng,
      label: label || "📍",
      title: title || address,
      color: "blue",
    });
  }
  if (selected) {
    markers.push({
      id: "selected",
      lat: selected.lat,
      lng: selected.lng,
      label: "✓",
      title: selected.address,
      color: "red",
    });
  }

  return (
    <div
      className="fixed inset-0 bg-black/60 z-[55] flex items-end md:items-center justify-center"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-t-2xl md:rounded-2xl w-full max-w-2xl p-4 space-y-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-bold truncate">{title || "위치 미리보기"}</h3>
            {address && <p className="text-xs text-gray-500 truncate">{address}</p>}
            {onLocationSelect && !selected && (
              <p className="text-[10px] text-indigo-500 mt-0.5">지도를 터치하면 해당 위치의 주소가 입력됩니다</p>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 text-2xl leading-none w-8 h-8 flex items-center justify-center shrink-0"
          >
            ×
          </button>
        </div>

        {loading ? (
          <div className="h-72 flex items-center justify-center text-sm text-gray-500 bg-gray-50 rounded-lg">
            지도 로딩 중...
          </div>
        ) : error ? (
          <div className="h-72 flex items-center justify-center text-sm text-gray-500 bg-gray-50 rounded-lg">
            {error}
          </div>
        ) : (
          <KakaoMap
            markers={markers}
            className="w-full h-[60vh] md:h-96"
            onMapClick={onLocationSelect ? handleMapClick : undefined}
          />
        )}

        {/* 위치 선택 확인 바 */}
        {resolving && (
          <div className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-2 text-sm text-gray-500">
            <div className="w-4 h-4 border-2 border-gray-300 border-t-indigo-600 rounded-full animate-spin" />
            주소 확인 중...
          </div>
        )}
        {selected && !resolving && (
          <div className="flex items-center gap-2 bg-indigo-50 rounded-lg px-3 py-2 border border-indigo-200">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-indigo-900 truncate">{selected.address}</p>
              <p className="text-[10px] text-indigo-500">위 주소를 파란 위치창에 입력합니다</p>
            </div>
            <button
              onClick={() => {
                onLocationSelect?.(selected.address, selected.lat, selected.lng);
                onClose();
              }}
              className="shrink-0 px-3 py-1.5 bg-indigo-600 text-white text-sm rounded-lg font-semibold hover:bg-indigo-700"
            >
              선택
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
