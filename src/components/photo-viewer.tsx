"use client";

import { useState, useEffect, useRef, useCallback } from "react";

interface PhotoViewerProps {
  photos: string[];          // 사진 URL 배열
  initialIdx: number;        // 0-based 시작 인덱스
  onClose: () => void;
  caption?: string;          // 상단 표시 텍스트 (선택)
  addressInput?: {           // 주소 인라인 편집 (TrackB용, 선택)
    value: string;
    onChange: (v: string) => void;
    placeholder?: string;
  };
}

const MIN_SCALE = 1;
const MAX_SCALE = 5;
const DOUBLE_TAP_MS = 300;

export default function PhotoViewer({
  photos,
  initialIdx,
  onClose,
  caption,
  addressInput,
}: PhotoViewerProps) {
  const [idx, setIdx] = useState(initialIdx);
  // 줌 상태
  const [scale, setScale] = useState(1);
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);

  // 터치/드래그 ref
  const lastTap = useRef(0);
  const pinchStart = useRef<{ dist: number; scale: number } | null>(null);
  const dragStart = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);
  const swipeStart = useRef<{ x: number; y: number; time: number } | null>(null);

  const isZoomed = scale > 1.001;

  // 사진 변경 시 줌 리셋
  useEffect(() => {
    setScale(1);
    setTx(0);
    setTy(0);
  }, [idx]);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft" && !isZoomed) setIdx((i) => Math.max(0, i - 1));
      else if (e.key === "ArrowRight" && !isZoomed) setIdx((i) => Math.min(photos.length - 1, i + 1));
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [photos.length, onClose, isZoomed]);

  const reset = useCallback(() => {
    setScale(1);
    setTx(0);
    setTy(0);
  }, []);

  function handleTouchStart(e: React.TouchEvent<HTMLImageElement>) {
    if (e.touches.length === 2) {
      // 핀치 시작
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      pinchStart.current = { dist: Math.hypot(dx, dy), scale };
      dragStart.current = null;
      swipeStart.current = null;
    } else if (e.touches.length === 1) {
      const t = e.touches[0];
      if (isZoomed) {
        // 줌 상태에서는 드래그(팬)
        dragStart.current = { x: t.clientX, y: t.clientY, tx, ty };
        swipeStart.current = null;
      } else {
        // 스와이프 시작점 기록 (touchend에서 판단)
        swipeStart.current = { x: t.clientX, y: t.clientY, time: Date.now() };
        // 더블탭 감지
        const now = Date.now();
        if (now - lastTap.current < DOUBLE_TAP_MS) {
          // 더블탭 → 줌 토글
          if (isZoomed) reset();
          else setScale(2.5);
          lastTap.current = 0;
          swipeStart.current = null; // 더블탭이면 스와이프 취소
        } else {
          lastTap.current = now;
        }
      }
    }
  }

  function handleTouchMove(e: React.TouchEvent<HTMLImageElement>) {
    if (e.touches.length === 2 && pinchStart.current) {
      e.preventDefault();
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.hypot(dx, dy);
      const newScale = Math.max(
        MIN_SCALE,
        Math.min(MAX_SCALE, pinchStart.current.scale * (dist / pinchStart.current.dist))
      );
      setScale(newScale);
    } else if (e.touches.length === 1 && dragStart.current && isZoomed) {
      e.preventDefault();
      const t = e.touches[0];
      setTx(dragStart.current.tx + (t.clientX - dragStart.current.x));
      setTy(dragStart.current.ty + (t.clientY - dragStart.current.y));
    }
  }

  function handleTouchEnd(e: React.TouchEvent<HTMLImageElement>) {
    // 스와이프 판정 (단일 터치, 줌 안 됨, 핀치/드래그 아님)
    if (
      swipeStart.current &&
      !isZoomed &&
      !pinchStart.current &&
      !dragStart.current
    ) {
      const ct = e.changedTouches[0];
      if (ct) {
        const dx = ct.clientX - swipeStart.current.x;
        const dy = ct.clientY - swipeStart.current.y;
        const dt = Date.now() - swipeStart.current.time;
        // 가로 우세 + 일정 거리 + 빠른 동작
        if (Math.abs(dx) > 50 && Math.abs(dy) < 60 && dt < 600) {
          if (dx > 0 && idx > 0) {
            setIdx(idx - 1);
            lastTap.current = 0; // 스와이프 후 더블탭 오인식 방지
          } else if (dx < 0 && idx < photos.length - 1) {
            setIdx(idx + 1);
            lastTap.current = 0;
          }
        }
      }
    }
    pinchStart.current = null;
    dragStart.current = null;
    swipeStart.current = null;
    // 줌이 거의 1이면 완전 리셋
    if (scale < 1.05) reset();
  }

  // 데스크톱 휠 줌 (선택적)
  function handleWheel(e: React.WheelEvent<HTMLImageElement>) {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    const delta = -e.deltaY * 0.005;
    const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale + delta));
    setScale(newScale);
    if (newScale < 1.05) reset();
  }

  // 데스크톱 더블클릭 줌 토글
  function handleDoubleClick(e: React.MouseEvent<HTMLImageElement>) {
    e.stopPropagation();
    if (isZoomed) reset();
    else setScale(2.5);
  }

  if (idx < 0 || idx >= photos.length) return null;

  return (
    <div className="fixed inset-0 bg-black/95 z-[60] flex flex-col">
      {/* 헤더 */}
      <div className="flex items-center justify-between p-3 text-white shrink-0">
        <span className="text-sm truncate flex-1 mr-2">
          {idx + 1} / {photos.length}
          {caption ? ` · ${caption}` : ""}
          {isZoomed && <span className="ml-2 text-xs text-emerald-300">{scale.toFixed(1)}×</span>}
        </span>
        {isZoomed && (
          <button
            onClick={reset}
            className="text-xs text-white/70 px-2 py-1 mr-1 rounded bg-white/10"
          >
            원본
          </button>
        )}
        <button
          onClick={onClose}
          className="text-3xl leading-none w-9 h-9 flex items-center justify-center shrink-0"
          aria-label="닫기"
        >
          ×
        </button>
      </div>

      {/* 사진 영역 */}
      <div
        className="flex-1 flex items-center justify-center overflow-hidden px-2 select-none"
        onClick={() => !isZoomed && onClose()}
      >
        <img
          src={photos[idx]}
          alt=""
          className="max-w-full max-h-full object-contain"
          style={{
            transform: `translate(${tx}px, ${ty}px) scale(${scale})`,
            transition: pinchStart.current || dragStart.current ? "none" : "transform 0.2s",
            touchAction: "none",
            cursor: isZoomed ? "grab" : "zoom-in",
          }}
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={handleDoubleClick}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onWheel={handleWheel}
          draggable={false}
        />
      </div>

      {/* 주소 인라인 편집 (선택) */}
      {addressInput && !isZoomed && (
        <div className="p-3 shrink-0">
          <input
            type="text"
            value={addressInput.value}
            onChange={(e) => addressInput.onChange(e.target.value)}
            placeholder={addressInput.placeholder || "주소 입력/수정"}
            className="w-full px-3 py-2 bg-white/10 border border-white/30 rounded-lg text-white text-sm placeholder-white/40"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}

      {/* 좌우 탐색 (줌 시 숨김) */}
      {!isZoomed && (
        <div className="flex justify-center gap-6 pb-4 shrink-0">
          <button
            onClick={() => setIdx(Math.max(0, idx - 1))}
            disabled={idx === 0}
            className="px-5 py-2 rounded-lg bg-white/10 text-white text-sm disabled:opacity-20"
          >
            ◀ 이전
          </button>
          <button
            onClick={() => setIdx(Math.min(photos.length - 1, idx + 1))}
            disabled={idx === photos.length - 1}
            className="px-5 py-2 rounded-lg bg-white/10 text-white text-sm disabled:opacity-20"
          >
            다음 ▶
          </button>
        </div>
      )}

      {/* 줌 도움말 (첫 사용 안내) */}
      {!isZoomed && (
        <div className="text-center pb-2 text-[10px] text-white/40 shrink-0">
          더블탭 / 핀치 줌 · ESC 닫기
        </div>
      )}
    </div>
  );
}
