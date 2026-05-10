"use client";

import { useEffect, useRef, useState } from "react";

declare global {
  interface Window {
    kakao: any;
  }
}

export interface MapMarker {
  id: string;
  lat: number;
  lng: number;
  label?: string;       // 마커 위 표시 텍스트 (예: "1")
  title?: string;       // 인포 윈도우 제목
  description?: string; // 인포 윈도우 본문
  color?: string;       // emerald, blue, amber, red 등
}

export interface HeatCircle {
  lat: number;
  lng: number;
  intensity: number;  // 1~10 (빈도 기반)
  color?: string;     // hex color (기본: #ef4444)
}

interface KakaoMapProps {
  markers: MapMarker[];
  /** 히트맵 원형 오버레이 */
  heatCircles?: HeatCircle[];
  /** 지도 중심 좌표 (기본: 후암동) */
  center?: { lat: number; lng: number };
  /** 줌 레벨 (기본 4) */
  level?: number;
  /** 클래스명 (높이 등) */
  className?: string;
  /** 마커 클릭 콜백 */
  onMarkerClick?: (marker: MapMarker) => void;
  /** 지도 빈 영역 클릭 콜백 (위치 선택용) */
  onMapClick?: (lat: number, lng: number) => void;
}

const DEFAULT_CENTER = { lat: 37.5505, lng: 126.9759 }; // 후암동 중심

const COLOR_HEX: Record<string, string> = {
  emerald: "#10b981",
  blue: "#3b82f6",
  amber: "#f59e0b",
  red: "#ef4444",
  violet: "#8b5cf6",
  pink: "#ec4899",
};

let sdkLoadPromise: Promise<void> | null = null;

function loadKakaoSdk(): Promise<void> {
  if (typeof window === "undefined") return Promise.reject(new Error("SSR"));
  if (window.kakao?.maps) return Promise.resolve();
  if (sdkLoadPromise) return sdkLoadPromise;

  const key = process.env.NEXT_PUBLIC_KAKAO_JS_KEY;
  if (!key) {
    return Promise.reject(new Error("NEXT_PUBLIC_KAKAO_JS_KEY 미설정"));
  }

  sdkLoadPromise = new Promise<void>((resolve, reject) => {
    const existing = document.getElementById("kakao-map-sdk");
    if (existing) {
      // 이미 로드 중
      const check = setInterval(() => {
        if (window.kakao?.maps) {
          clearInterval(check);
          window.kakao.maps.load(() => resolve());
        }
      }, 50);
      setTimeout(() => { clearInterval(check); reject(new Error("SDK 로드 타임아웃")); }, 10000);
      return;
    }

    const script = document.createElement("script");
    script.id = "kakao-map-sdk";
    script.async = true;
    script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${key}&autoload=false&libraries=services`;
    script.onload = () => {
      window.kakao.maps.load(() => resolve());
    };
    script.onerror = () => reject(new Error("Kakao SDK 로드 실패"));
    document.head.appendChild(script);
  });

  return sdkLoadPromise;
}

export default function KakaoMap({
  markers,
  heatCircles,
  center,
  level = 4,
  className = "w-full h-96",
  onMarkerClick,
  onMapClick,
}: KakaoMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markerObjsRef = useRef<any[]>([]);
  const heatObjsRef = useRef<any[]>([]);
  const onMarkerClickRef = useRef(onMarkerClick);
  onMarkerClickRef.current = onMarkerClick;
  const onMapClickRef = useRef(onMapClick);
  onMapClickRef.current = onMapClick;
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [ready, setReady] = useState(false); // ★ SDK 로드 완료 시그널

  // 1) SDK 로드 + 지도 초기화
  useEffect(() => {
    loadKakaoSdk()
      .then(() => {
        if (!containerRef.current) return;
        const c = center || DEFAULT_CENTER;
        const map = new window.kakao.maps.Map(containerRef.current, {
          center: new window.kakao.maps.LatLng(c.lat, c.lng),
          level,
        });
        mapRef.current = map;

        // 지도 클릭 → 좌표 반환 (위치 선택용)
        window.kakao.maps.event.addListener(map, "click", (mouseEvent: any) => {
          const latlng = mouseEvent.latLng;
          onMapClickRef.current?.(latlng.getLat(), latlng.getLng());
        });

        setLoading(false);
        setReady(true); // ★ 마커 useEffect 재실행 트리거
      })
      .catch((e) => {
        setError(e.message || "지도 로드 실패");
        setLoading(false);
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 2) 마커 갱신 (ready + markers 의존성)
  useEffect(() => {
    if (!ready || !mapRef.current || !window.kakao?.maps) return;

    // 기존 마커 제거
    for (const m of markerObjsRef.current) m.setMap(null);
    markerObjsRef.current = [];

    if (markers.length === 0) return;

    const bounds = new window.kakao.maps.LatLngBounds();

    for (const mk of markers) {
      const pos = new window.kakao.maps.LatLng(mk.lat, mk.lng);
      bounds.extend(pos);

      const color = COLOR_HEX[mk.color || "emerald"] || COLOR_HEX.emerald;
      const labelText = mk.label || "";

      // DOM element 직접 생성 — 터치 영역 24px, 시각 도트 20px (기존 60% 축소)
      const el = document.createElement("div");
      el.style.cssText = `display:flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:50%;cursor:pointer;`;
      const dot = document.createElement("div");
      dot.style.cssText = `display:flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:50%;background:${color};color:white;font-weight:bold;font-size:8px;border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,0.25);`;
      dot.textContent = labelText;
      el.appendChild(dot);

      // 클릭 이벤트 — ref 경유로 stale closure 방지
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        if (onMarkerClickRef.current) {
          onMarkerClickRef.current(mk);
        } else if (mk.title) {
          const iw = new window.kakao.maps.InfoWindow({
            content: `<div style="padding:8px;font-size:12px;">
              <strong>${mk.title}</strong>
              ${mk.description ? `<br/>${mk.description}` : ""}
            </div>`,
          });
          iw.open(mapRef.current, new window.kakao.maps.Marker({ position: pos }));
        }
      });

      const overlay = new window.kakao.maps.CustomOverlay({
        position: pos,
        content: el,
        yAnchor: 0.5,
        xAnchor: 0.5,
        clickable: true,
      });
      overlay.setMap(mapRef.current);
      markerObjsRef.current.push(overlay);
    }

    // 모든 마커가 보이도록 자동 조정
    if (markers.length > 1) {
      mapRef.current.setBounds(bounds, 30, 30, 30, 30);
    } else {
      mapRef.current.setCenter(new window.kakao.maps.LatLng(markers[0].lat, markers[0].lng));
    }
  }, [ready, markers]);

  // 3) 히트맵 원형 오버레이 (빈도 기반)
  useEffect(() => {
    if (!ready || !mapRef.current || !window.kakao?.maps) return;

    // 기존 히트 원형 제거
    for (const c of heatObjsRef.current) c.setMap(null);
    heatObjsRef.current = [];

    if (!heatCircles?.length) return;

    for (const hc of heatCircles) {
      const radius = 12 + hc.intensity * 4;                // 16m ~ 52m
      const opacity = 0.06 + hc.intensity * 0.025;         // 0.085 ~ 0.31
      const fillColor = hc.color || "#ef4444";

      const circle = new window.kakao.maps.Circle({
        center: new window.kakao.maps.LatLng(hc.lat, hc.lng),
        radius,
        strokeWeight: 1,
        strokeColor: fillColor,
        strokeOpacity: 0.2,
        fillColor,
        fillOpacity: Math.min(0.35, opacity),
      });
      circle.setMap(mapRef.current);
      heatObjsRef.current.push(circle);
    }
  }, [ready, heatCircles]);

  if (error) {
    return (
      <div className={`${className} bg-gray-50 border border-gray-200 rounded-lg flex items-center justify-center text-sm text-gray-500 p-4 text-center`}>
        지도 로드 실패: {error}
        <br />
        <span className="text-xs mt-1">관리자: NEXT_PUBLIC_KAKAO_JS_KEY 환경변수를 설정하세요</span>
      </div>
    );
  }

  return (
    <div className={`${className} relative rounded-lg overflow-hidden border border-gray-200`}>
      <div ref={containerRef} className="w-full h-full" />
      {loading && (
        <div className="absolute inset-0 bg-white/80 flex items-center justify-center text-sm text-gray-500">
          지도 로딩 중...
        </div>
      )}
    </div>
  );
}
