"use client";

import { useState, useEffect, useRef } from "react";
import { CATEGORIES, CATEGORY_MAP } from "@/lib/categories";
import PhotoViewer from "@/components/photo-viewer";
import RedistributeModal from "@/components/redistribute-modal";
import AddressMapModal from "@/components/address-map-modal";
import { uploadPhotosChunked } from "@/lib/image-utils";
import { todayKr, dateKr } from "@/lib/date";

const KST_TIME_FMT = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Seoul",
  hour: "2-digit", minute: "2-digit", second: "2-digit",
  hour12: false,
});

const KST_DATE_TIME_SHORT = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit",
  hour12: false,
});

/** UTC ISO → KST HH:MM:SS */
function fmtKstTime(isoStr: string | null | undefined): string {
  if (!isoStr) return "";
  return KST_TIME_FMT.format(new Date(isoStr));
}

/** UTC ISO → KST "MM.DD. HH:MM" (구조화 뷰 카드 헤더용 짧은 포맷) */
function fmtKstShort(isoStr: string | null | undefined): string {
  if (!isoStr) return "";
  return KST_DATE_TIME_SHORT.format(new Date(isoStr))
    .replace(/\s/g, "")
    .replace(/(\d{2})\.(\d{2})\.(\d{2}):(\d{2})/, "$1.$2. $3:$4");
}

interface EvalItem {
  name: string;
  maxPoints: number;
  target: number;
  current: number;
  autoCount: number;
  earnedPoints: number;
  isManual: boolean;
}

interface Stats {
  today: number;
  week: number;
  pendingComplaints: number;
  evalProgress: EvalItem[];
  evalScore: number;
  categoryStats: { category: string; count: number }[];
  recentEntries: {
    id: string;
    userId: string;
    category: string;
    evalItem: string;
    photoCount: number;
    quantity: number;
    unit: string;
    memo: string | null;
    inputTrack: string;
    entryDate: string;
    createdAt: string;
  }[];
}

interface EntryDetail {
  id: string;
  userId: string;
  userName: string;
  category: string;
  evalItem: string | null;
  evalPoints: number | null;
  photoUrls: string[];
  photoCount: number;
  quantity: number;
  unit: string;
  memo: string | null;
  addressText: string | null;
  latitude: number | null;
  longitude: number | null;
  inputTrack: string;
  entryDate: string;
  createdAt: string;
  zoneId: string | null;
}

interface Zone {
  id: string;
  seqNo: number;
  address: string;
  landmark: string;
}

interface DateEntries {
  date: string;
  totalEntries: number;
  totalPhotos: number;
  categories: { category: string; label: string; count: number; photoCount: number }[];
  entries: {
    id: string;
    userId: string;
    category: string;
    photoUrls: string[];
    photoCount: number;
    quantity: number;
    unit: string;
    memo: string | null;
    addressText: string | null;
    address: string | null;
    latitude: number | null;
    longitude: number | null;
    inputTrack: string;
    createdAt: string;
    userName: string;
  }[];
}

interface CurrentUser {
  id: string;
  name: string;
  role: string;
  pool: string | null;
}

const DAY_NAMES = ["일", "월", "화", "수", "목", "금", "토"];

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [scope, setScope] = useState<"all" | "me">("all");
  const [activeTab, setActiveTab] = useState<"entries" | "dashboard">("entries");
  const [detail, setDetail] = useState<EntryDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [me, setMe] = useState<CurrentUser | null>(null);

  // 일자별 입력 (한국 시간 기준)
  const today = todayKr();
  const [browseDate, setBrowseDate] = useState(today);
  const [dateEntries, setDateEntries] = useState<DateEntries | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [showCalendar, setShowCalendar] = useState(false);
  const [moveDate, setMoveDate] = useState<string | null>(null); // 날짜 이동 모드
  // 보기 모드: 구조화(보고서/일지 카드) 기본 / 목록(연번 단순 나열)
  const [viewMode, setViewMode] = useState<"structured" | "list">("structured");
  const calRef = useRef<HTMLDivElement>(null);
  const entriesRef = useRef<HTMLDivElement>(null);

  // 달력 외부 클릭 시 닫기 (fixed 배경 대신 → 스크롤 차단 없음)
  useEffect(() => {
    if (!showCalendar) return;
    function handleDown(e: MouseEvent | TouchEvent) {
      if (calRef.current && !calRef.current.contains(e.target as Node)) {
        setShowCalendar(false);
      }
    }
    document.addEventListener("mousedown", handleDown);
    document.addEventListener("touchstart", handleDown);
    return () => {
      document.removeEventListener("mousedown", handleDown);
      document.removeEventListener("touchstart", handleDown);
    };
  }, [showCalendar]);

  async function openDetail(id: string) {
    setLoadingDetail(true);
    const res = await fetch(`/api/entries/${id}`);
    if (res.ok) setDetail(await res.json());
    setLoadingDetail(false);
  }

  useEffect(() => {
    fetch("/api/auth/me").then((r) => r.json()).then(setMe);
  }, []);

  useEffect(() => {
    fetch(`/api/stats?scope=${scope}`)
      .then((r) => r.json())
      .then(setStats);
  }, [scope]);

  useEffect(() => {
    setDateEntries(null);
    setSelecting(false);
    setSelectedIds([]);
    fetch(`/api/entries/by-date?date=${browseDate}`)
      .then((r) => r.json())
      .then(setDateEntries);
  }, [browseDate]);

  function refreshDateEntries() {
    fetch(`/api/entries/by-date?date=${browseDate}`).then((r) => r.json()).then(setDateEntries);
    fetch(`/api/stats?scope=${scope}`).then((r) => r.json()).then(setStats);
  }

  async function deleteSelected() {
    if (!selectedIds.length) return;
    if (!confirm(`선택한 ${selectedIds.length}건을 삭제하시겠습니까?`)) return;
    await fetch("/api/entries/bulk-delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: selectedIds }),
    });
    setSelectedIds([]);
    setSelecting(false);
    refreshDateEntries();
  }

  async function moveSelectedToDate() {
    if (!selectedIds.length || !moveDate) return;
    if (moveDate === browseDate) { setMoveDate(null); return; }
    if (!confirm(`선택한 ${selectedIds.length}건을 ${moveDate}로 이동하시겠습니까?`)) return;
    await Promise.all(
      selectedIds.map((id) =>
        fetch(`/api/entries/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ entryDate: moveDate }),
        })
      )
    );
    setSelectedIds([]);
    setSelecting(false);
    setMoveDate(null);
    refreshDateEntries();
  }

  function changeDate(delta: number) {
    // 정오 기준으로 잡아 timezone 경계 문제 회피
    const d = new Date(browseDate + "T12:00:00");
    d.setDate(d.getDate() + delta);
    setBrowseDate(dateKr(d));
    scrollToEntries();
  }

  async function downloadPhotos(category?: string) {
    const key = category || "all";
    setDownloading(key);
    try {
      const url = `/api/entries/download-photos?date=${browseDate}${category ? `&category=${category}` : ""}`;
      const res = await fetch(url);
      if (!res.ok) return;
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      const catLabel = category ? CATEGORY_MAP[category]?.label || category : "전체";
      a.download = `환경순찰_${browseDate}_${catLabel}.zip`;
      a.click();
      URL.revokeObjectURL(a.href);
    } finally {
      setDownloading(null);
    }
  }

  async function downloadSelected() {
    if (selectedIds.length === 0) return;
    setDownloading("selected");
    try {
      const url = `/api/entries/download-photos?date=${browseDate}&ids=${selectedIds.join(",")}`;
      const res = await fetch(url);
      if (!res.ok) return;
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `환경순찰_${browseDate}_선택${selectedIds.length}건.zip`;
      a.click();
      URL.revokeObjectURL(a.href);
    } finally {
      setDownloading(null);
    }
  }

  /** 구조화 다운로드 — 일일순찰일지(hwpx) 작성용
   *  ZIP 안에 _목록.csv + 항목별 폴더({연번}_{시간}_{주소}/_info.txt + 1.jpg ...)
   */
  async function downloadStructured() {
    setDownloading("structured");
    try {
      const url = `/api/entries/download-photos?date=${browseDate}&structured=true&blur=true`;
      const res = await fetch(url);
      if (!res.ok) return;
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `환경순찰_${browseDate}_전체_구조화.zip`;
      a.click();
      URL.revokeObjectURL(a.href);
    } finally {
      setDownloading(null);
    }
  }

  async function autoMergeDate() {
    if (!confirm("같은 구역 또는 같은 주소 항목들을 자동으로 병합하시겠습니까?\n(첫 항목으로 사진이 합쳐지고 나머지는 삭제됩니다)")) return;
    const res = await fetch("/api/entries/auto-merge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date: browseDate }),
    });
    if (res.ok) {
      const data = await res.json();
      if (data.mergedGroups === 0) {
        alert("병합할 항목이 없습니다 (같은 구역/주소 중복 없음)");
      } else {
        alert(`${data.mergedGroups}개 그룹 병합 완료 (${data.removedEntries}개 항목 정리)`);
      }
      refreshDateEntries();
    } else {
      const data = await res.json();
      alert(data.error || "병합 실패");
    }
  }

  if (!stats) {
    return <div className="p-4 text-sm text-gray-400">로딩 중...</div>;
  }

  const dayName = DAY_NAMES[new Date(browseDate + "T12:00:00").getDay()];

  // 달력용 계산
  const calYear = parseInt(browseDate.slice(0, 4));
  const calMonth = parseInt(browseDate.slice(5, 7)); // 1-based
  const calFirstDay = new Date(calYear, calMonth - 1, 1).getDay();
  const calDaysInMonth = new Date(calYear, calMonth, 0).getDate();
  const calDays: (number | null)[] = [];
  for (let i = 0; i < calFirstDay; i++) calDays.push(null);
  for (let d = 1; d <= calDaysInMonth; d++) calDays.push(d);

  function calChangeMonth(delta: number) {
    const d = new Date(calYear, calMonth - 1 + delta, 1);
    const newDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${browseDate.slice(8, 10)}`;
    // 날짜 유효성 (31일→30일 등)
    const maxDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    const day = Math.min(parseInt(browseDate.slice(8, 10)), maxDay);
    setBrowseDate(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`);
  }

  function scrollToEntries() {
    setTimeout(() => {
      entriesRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 100);
  }

  function calSelectDay(day: number) {
    const selected = `${calYear}-${String(calMonth).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    if (selected <= today) {
      setBrowseDate(selected);
      setShowCalendar(false);
      scrollToEntries();
    }
  }

  return (
    <div className="p-4 md:p-6 space-y-6">
      {/* 헤더 + 범위 토글 */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-gray-900">현황</h2>
        <div className="flex bg-gray-100 rounded-lg p-0.5 text-sm">
          <button onClick={() => setScope("all")}
            className={`px-3 py-1 rounded-md ${scope === "all" ? "bg-white shadow-sm font-medium" : "text-gray-500"}`}>
            전체
          </button>
          <button onClick={() => setScope("me")}
            className={`px-3 py-1 rounded-md ${scope === "me" ? "bg-white shadow-sm font-medium" : "text-gray-500"}`}>
            내 실적
          </button>
        </div>
      </div>

      {/* 탭 토글 */}
      <div className="flex bg-gray-100 rounded-xl p-1 text-sm">
        <button onClick={() => setActiveTab("entries")}
          className={`flex-1 px-3 py-2 rounded-lg transition-colors ${
            activeTab === "entries" ? "bg-white shadow-sm font-semibold text-emerald-700" : "text-gray-500"
          }`}>
          순찰 내역
        </button>
        <button onClick={() => setActiveTab("dashboard")}
          className={`flex-1 px-3 py-2 rounded-lg transition-colors ${
            activeTab === "dashboard" ? "bg-white shadow-sm font-semibold text-emerald-700" : "text-gray-500"
          }`}>
          대시보드
        </button>
      </div>

      {/* 요약 카드 — 순찰 내역 탭에서만 노출, 클릭 시 대시보드 탭으로 전환 */}
      {activeTab === "entries" && (
        <div className="grid grid-cols-3 gap-3">
          <SummaryCard label="오늘" value={`${stats.today}건`} color="bg-emerald-50 text-emerald-700"
            onClick={() => setActiveTab("dashboard")} />
          <SummaryCard label="이번 주" value={`${stats.week}건`} color="bg-blue-50 text-blue-700"
            onClick={() => setActiveTab("dashboard")} />
          <SummaryCard label="평가 점수" value={`${stats.evalScore}%`} color="bg-violet-50 text-violet-700"
            onClick={() => setActiveTab("dashboard")} />
        </div>
      )}

      {/* 대시보드 탭: 평가 진척도 + 카테고리별 실적 */}
      {activeTab === "dashboard" && (
        <>
          <EvalProgressSection evalProgress={stats.evalProgress} isAdmin={me?.role === "ADMIN"} onUpdate={() => {
            fetch(`/api/stats?scope=${scope}`).then((r) => r.json()).then(setStats);
          }} />

          {stats.categoryStats.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-gray-700 mb-3">카테고리별 실적</h3>
              <div className="grid grid-cols-2 gap-2">
                {stats.categoryStats.map((c) => (
                  <div key={c.category} className="flex justify-between items-center bg-white rounded-lg border border-gray-200 px-3 py-2">
                    <span className="text-sm">{CATEGORY_MAP[c.category]?.label || c.category}</span>
                    <span className="text-sm font-bold text-emerald-600">{c.count}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* 상세 모달 */}
      {detail && <DetailModal entry={detail} currentUser={me} onClose={() => setDetail(null)} onUpdate={() => {
        fetch(`/api/stats?scope=${scope}`).then((r) => r.json()).then(setStats);
        fetch(`/api/entries/by-date?date=${browseDate}`).then((r) => r.json()).then(setDateEntries);
      }} />}
      {loadingDetail && (
        <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center">
          <div className="bg-white rounded-xl p-4 text-sm">로딩 중...</div>
        </div>
      )}

      {/* 순찰 내역 — 일자별 입력 */}
      {activeTab === "entries" && (
      <div ref={entriesRef}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-700">일자 선택</h3>
          <div className="flex items-center gap-1 relative">
            <button onClick={() => changeDate(-1)}
              className="w-7 h-7 flex items-center justify-center rounded-md bg-gray-100 text-gray-600 hover:bg-gray-200 text-xs">
              ◀
            </button>
            <button onClick={() => setShowCalendar(!showCalendar)}
              className={`px-2 py-1 rounded-md text-xs ${browseDate === today ? "bg-emerald-100 text-emerald-700 font-medium" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>
              {browseDate} ({dayName})
            </button>
            <button onClick={() => changeDate(1)}
              disabled={browseDate >= today}
              className="w-7 h-7 flex items-center justify-center rounded-md bg-gray-100 text-gray-600 hover:bg-gray-200 text-xs disabled:opacity-30">
              ▶
            </button>

            {/* 달력 팝업 (fixed 배경 없음 → 스크롤 가능) */}
            {showCalendar && (
              <div ref={calRef} className="absolute top-8 right-0 z-50 bg-white rounded-xl shadow-xl border border-gray-200 p-3 w-72">
                  {/* 월 네비게이션 */}
                  <div className="flex items-center justify-between mb-2">
                    <button onClick={() => calChangeMonth(-1)}
                      className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-gray-100 text-gray-600 text-sm">
                      ◀
                    </button>
                    <span className="text-sm font-semibold text-gray-800">
                      {calYear}년 {calMonth}월
                    </span>
                    <button onClick={() => calChangeMonth(1)}
                      disabled={`${calYear}-${String(calMonth).padStart(2, "0")}` >= today.slice(0, 7)}
                      className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-gray-100 text-gray-600 text-sm disabled:opacity-30">
                      ▶
                    </button>
                  </div>
                  {/* 요일 헤더 */}
                  <div className="grid grid-cols-7 gap-0.5 mb-1">
                    {DAY_NAMES.map((d) => (
                      <div key={d} className={`text-center text-[10px] font-medium py-0.5 ${d === "일" ? "text-red-400" : d === "토" ? "text-blue-400" : "text-gray-400"}`}>
                        {d}
                      </div>
                    ))}
                  </div>
                  {/* 날짜 그리드 */}
                  <div className="grid grid-cols-7 gap-0.5">
                    {calDays.map((day, i) => {
                      if (day === null) return <div key={`e${i}`} />;
                      const dateStr = `${calYear}-${String(calMonth).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
                      const isToday = dateStr === today;
                      const isSelected = dateStr === browseDate;
                      const isFuture = dateStr > today;
                      const dow = (calFirstDay + day - 1) % 7;
                      return (
                        <button
                          key={day}
                          onClick={() => calSelectDay(day)}
                          disabled={isFuture}
                          className={`w-8 h-8 mx-auto flex items-center justify-center rounded-full text-xs transition-colors
                            ${isSelected ? "bg-emerald-600 text-white font-bold" : ""}
                            ${isToday && !isSelected ? "ring-1 ring-emerald-400 font-semibold text-emerald-700" : ""}
                            ${isFuture ? "text-gray-200 cursor-not-allowed" : ""}
                            ${!isSelected && !isFuture && !isToday ? "hover:bg-emerald-50" : ""}
                            ${!isSelected && !isFuture && dow === 0 ? "text-red-500" : ""}
                            ${!isSelected && !isFuture && dow === 6 ? "text-blue-500" : ""}
                          `}
                        >
                          {day}
                        </button>
                      );
                    })}
                  </div>
                  {/* 오늘 바로가기 */}
                  {browseDate !== today && (
                    <button onClick={() => { setBrowseDate(today); setShowCalendar(false); scrollToEntries(); }}
                      className="w-full mt-2 py-1.5 text-xs text-emerald-600 font-medium rounded-lg hover:bg-emerald-50 transition-colors">
                      오늘로 이동
                    </button>
                  )}
                </div>
            )}
          </div>
        </div>

        {!dateEntries ? (
          <p className="text-sm text-gray-400">로딩 중...</p>
        ) : dateEntries.totalEntries === 0 ? (
          <p className="text-sm text-gray-400">입력 기록이 없습니다</p>
        ) : (
          <>
            {/* 전체 요약 + 다운로드 */}
            <div className="flex items-center justify-between bg-emerald-50 rounded-lg px-3 py-2 mb-3">
              <span className="text-sm font-medium text-emerald-700">
                총 {dateEntries.totalEntries}건 · {dateEntries.totalPhotos}장
              </span>
              {dateEntries.totalPhotos > 0 && (
                <div className="flex gap-1.5">
                  <button onClick={downloadStructured}
                    disabled={downloading === "structured"}
                    title="일일순찰일지용 — 항목별 폴더 + _목록.csv"
                    className="text-xs bg-indigo-600 text-white px-3 py-1.5 rounded-lg hover:bg-indigo-700 disabled:opacity-50">
                    {downloading === "structured" ? "준비 중..." : "📁 일지용"}
                  </button>
                  <button onClick={() => downloadPhotos()}
                    disabled={downloading === "all"}
                    className="text-xs bg-emerald-600 text-white px-3 py-1.5 rounded-lg hover:bg-emerald-700 disabled:opacity-50">
                    {downloading === "all" ? "준비 중..." : "전체 사진 다운"}
                  </button>
                </div>
              )}
            </div>

            {/* 카테고리별 다운로드 */}
            {dateEntries.categories.length > 1 && (
              <div className="flex flex-wrap gap-1.5 mb-3">
                {dateEntries.categories.map((c) => (
                  <button key={c.category} onClick={() => downloadPhotos(c.category)}
                    disabled={downloading === c.category || c.photoCount === 0}
                    className="text-xs bg-white border border-gray-200 rounded-lg px-2.5 py-1.5 hover:border-emerald-400 disabled:opacity-40 transition-colors">
                    {c.label} {c.count}건·{c.photoCount}장
                    <span className="ml-1">{downloading === c.category ? "⏳" : "↓"}</span>
                  </button>
                ))}
              </div>
            )}

            {/* 입력 목록 헤더 (선택/삭제/다운로드/AI 병합) */}
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-gray-500">{dateEntries.entries.length}건</span>
              <div className="flex gap-2 items-center">
                {selecting ? (
                  <>
                    <button onClick={downloadSelected}
                      disabled={selectedIds.length === 0 || downloading === "selected"}
                      className="text-xs text-emerald-600 disabled:opacity-30">
                      {downloading === "selected" ? "준비 중..." : `${selectedIds.length}건 다운`}
                    </button>
                    {selectedIds.length > 0 && (
                      moveDate !== null ? (
                        <div className="flex items-center gap-1">
                          <input type="date" value={moveDate}
                            onChange={(e) => setMoveDate(e.target.value)}
                            className="text-xs border border-indigo-300 rounded px-1.5 py-0.5 w-[120px]" />
                          <button onClick={moveSelectedToDate}
                            disabled={!moveDate || moveDate === browseDate}
                            className="text-xs text-white bg-indigo-600 px-2 py-0.5 rounded disabled:opacity-30">
                            이동
                          </button>
                          <button onClick={() => setMoveDate(null)}
                            className="text-xs text-gray-400">×</button>
                        </div>
                      ) : (
                        <button onClick={() => setMoveDate(browseDate)}
                          className="text-xs text-indigo-600">
                          날짜 이동
                        </button>
                      )
                    )}
                    {me?.role === "ADMIN" && (
                      <button onClick={deleteSelected}
                        disabled={selectedIds.length === 0}
                        className="text-xs text-red-500 disabled:opacity-30">
                        {selectedIds.length}건 삭제
                      </button>
                    )}
                    <button onClick={() => { setSelecting(false); setSelectedIds([]); setMoveDate(null); }}
                      className="text-xs text-gray-400">취소</button>
                  </>
                ) : (
                  <>
                    {me?.role === "ADMIN" && dateEntries.entries.length > 1 && (
                      <button
                        onClick={autoMergeDate}
                        className="text-xs px-2 py-0.5 rounded-md bg-purple-600 text-white font-semibold"
                        title="같은 구역 또는 같은 주소 항목을 자동 병합"
                      >
                        🤖 AI 병합
                      </button>
                    )}
                    {dateEntries.entries.length > 0 && (
                      <button onClick={() => setSelecting(true)} className="text-xs text-gray-400">선택</button>
                    )}
                  </>
                )}
              </div>
            </div>

            {/* 보기 방식 토글 — 구조화(일지/보고서 카드) / 목록 */}
            <div className="flex bg-gray-100 rounded-lg p-1 mb-3 max-w-[280px]">
              <button
                onClick={() => setViewMode("structured")}
                className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  viewMode === "structured" ? "bg-white text-emerald-700 shadow-sm" : "text-gray-500"
                }`}
              >
                📋 구조화
              </button>
              <button
                onClick={() => setViewMode("list")}
                className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  viewMode === "list" ? "bg-white text-emerald-700 shadow-sm" : "text-gray-500"
                }`}
              >
                ☰ 목록
              </button>
            </div>

            {/* 구조화 뷰 — 좌측 메타 + 우측 사진 그리드 */}
            {viewMode === "structured" && (
              <div className="space-y-3">
                {dateEntries.entries.map((e, listIdx) => {
                  const seq = listIdx + 1;
                  const canSelect = me?.role === "ADMIN" || e.userId === me?.id;
                  const isChecked = selectedIds.includes(e.id);
                  const catLabel = CATEGORY_MAP[e.category]?.label || e.category;
                  const loc = e.addressText || e.address ||
                    (e.latitude != null && e.longitude != null
                      ? `${e.latitude.toFixed(5)}, ${e.longitude.toFixed(5)}`
                      : null);
                  const copyText = [
                    `${seq} · ${fmtKstShort(e.createdAt)}`,
                    loc || "(미입력)",
                    `${catLabel} · 사진 ${e.photoCount}장`,
                    e.memo ? `메모: ${e.memo}` : null,
                  ].filter(Boolean).join("\n");

                  function toggleSelect() {
                    if (!canSelect) return;
                    if (!selecting) setSelecting(true);
                    setSelectedIds((prev) =>
                      prev.includes(e.id) ? prev.filter((x) => x !== e.id) : [...prev, e.id]
                    );
                  }

                  return (
                    <article
                      key={e.id}
                      className={`bg-white rounded-xl border p-4 flex flex-col md:flex-row gap-4 items-start ${
                        isChecked ? "border-blue-500 ring-2 ring-blue-200" : "border-gray-200"
                      }`}
                    >
                      {/* 좌측: 메타 — 박스 자체가 상세 진입 */}
                      <div
                        className="md:flex-none md:w-[280px] w-full text-sm leading-relaxed min-w-0 cursor-pointer"
                        onClick={(ev) => {
                          const t = ev.target as HTMLElement;
                          if (t.closest("button, input, select, a")) return;
                          if (selecting) toggleSelect();
                          else openDetail(e.id);
                        }}
                        title={selecting ? "클릭하면 선택/해제" : "클릭하면 상세보기"}
                      >
                        <div className="text-base font-semibold text-emerald-800 mb-1.5 flex items-center gap-2 flex-wrap">
                          <button
                            type="button"
                            onClick={(ev) => { ev.stopPropagation(); toggleSelect(); }}
                            disabled={!canSelect}
                            className={`px-2 py-0.5 rounded text-xs font-bold transition-colors ${
                              isChecked
                                ? "bg-blue-600 text-white"
                                : "bg-emerald-700 text-white hover:bg-emerald-600"
                            } disabled:opacity-50`}
                            title={canSelect ? "클릭하면 선택/해제 (다중 선택 가능)" : "권한 없음"}
                          >
                            {isChecked ? "✓" : seq}
                          </button>
                          <span>{fmtKstShort(e.createdAt)}</span>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded font-normal ${
                            e.inputTrack === "batch" ? "bg-blue-100 text-blue-600" : "bg-emerald-100 text-emerald-600"
                          }`}>
                            {e.inputTrack === "batch" ? "일괄" : "실시간"}
                          </span>
                        </div>
                        <div className="text-[13px] space-y-0.5">
                          <div>
                            <span className="text-gray-400 inline-block w-10 mr-1 text-[11px]">위치</span>
                            <span className="text-gray-700">{loc || "(미입력)"}</span>
                          </div>
                          <div>
                            <span className="text-gray-400 inline-block w-10 mr-1 text-[11px]">분류</span>
                            <span className="text-gray-700">{catLabel} · 사진 {e.photoCount}장</span>
                          </div>
                          <div>
                            <span className="text-gray-400 inline-block w-10 mr-1 text-[11px]">담당</span>
                            <span className="text-gray-700">{e.userName}</span>
                          </div>
                          {e.memo && (
                            <div className="mt-1.5">
                              <span className="text-gray-400 inline-block w-10 mr-1 text-[11px]">메모</span>
                              <span className="text-gray-700 whitespace-pre-wrap break-words text-[12px]">{e.memo}</span>
                            </div>
                          )}
                        </div>
                        <button
                          onClick={(ev) => {
                            ev.stopPropagation();
                            navigator.clipboard?.writeText(copyText).catch(() => {});
                          }}
                          className="mt-2 inline-flex items-center gap-1 text-[11px] text-indigo-600 hover:text-indigo-800"
                          title="이 항목 메타데이터를 클립보드에 복사"
                        >
                          📋 복사
                        </button>
                      </div>
                      {/* 우측: 사진 그리드 */}
                      <div className="flex-1 grid grid-cols-3 sm:grid-cols-4 md:grid-cols-4 lg:grid-cols-5 gap-2 min-w-0 w-full">
                        {(e.photoUrls || []).map((url, i) => (
                          <a
                            key={i}
                            href={url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="block aspect-square rounded-lg overflow-hidden bg-gray-100 border border-gray-200 hover:border-emerald-400 transition-colors"
                            title="클릭하면 새 창에서 원본 보기"
                          >
                            <img
                              src={url}
                              alt=""
                              loading="lazy"
                              className="w-full h-full object-cover hover:scale-105 transition-transform duration-200"
                            />
                          </a>
                        ))}
                      </div>
                    </article>
                  );
                })}
              </div>
            )}

            {/* 목록 뷰 — 단순 한 줄 카드 */}
            {viewMode === "list" && (
            <div className="space-y-2">
              {dateEntries.entries.map((e, listIdx) => {
                const canSelect = me?.role === "ADMIN" || e.userId === me?.id;
                const seqNo = listIdx + 1;
                return (
                  <div key={e.id} className="flex items-center gap-2">
                    {selecting && (
                      <input type="checkbox"
                        disabled={!canSelect}
                        checked={selectedIds.includes(e.id)}
                        onChange={(ev) => setSelectedIds(ev.target.checked
                          ? [...selectedIds, e.id] : selectedIds.filter((x) => x !== e.id)
                        )} className="shrink-0" />
                    )}
                    <button onClick={() => !selecting && openDetail(e.id)}
                      className="flex-1 flex items-center justify-between bg-white rounded-lg border border-gray-200 px-3 py-2 text-left hover:border-emerald-400 transition-colors">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="shrink-0 text-[11px] font-bold text-emerald-700 bg-emerald-50 rounded px-1.5 py-0.5 min-w-[24px] text-center">
                            {seqNo}
                          </span>
                          <p className="text-sm font-medium truncate">{CATEGORY_MAP[e.category]?.label || e.category}</p>
                          <span className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded ${
                            e.inputTrack === "batch" ? "bg-blue-100 text-blue-600" : "bg-emerald-100 text-emerald-600"
                          }`}>
                            {e.inputTrack === "batch" ? "일괄" : "실시간"}
                          </span>
                        </div>
                        {(() => {
                          const loc = e.addressText || e.address ||
                            (e.latitude != null && e.longitude != null
                              ? `${e.latitude.toFixed(5)}, ${e.longitude.toFixed(5)}`
                              : null);
                          return loc ? <p className="text-xs text-gray-400 truncate">{loc}</p> : null;
                        })()}
                        {e.memo && <p className="text-xs text-gray-400 truncate">{e.memo}</p>}
                      </div>
                      <div className="text-right shrink-0 ml-2">
                        <p className="text-xs text-gray-500 font-mono" title="다운로드 사진 파일명: HHMMSS-N.jpg">
                          {fmtKstTime(e.createdAt)}
                        </p>
                        <p className="text-xs text-gray-400">
                          {e.photoCount}장 · {e.quantity}{e.unit}
                        </p>
                      </div>
                    </button>
                  </div>
                );
              })}
            </div>
            )}

            {/* 전체 선택/해제 */}
            {selecting && dateEntries.entries.length > 1 && (
              <button onClick={() => {
                const selectable = dateEntries.entries.filter((e) => me?.role === "ADMIN" || e.userId === me?.id).map((e) => e.id);
                setSelectedIds(selectedIds.length === selectable.length ? [] : selectable);
              }} className="text-xs text-emerald-600 mt-2">
                {selectedIds.length === dateEntries.entries.filter((e) => me?.role === "ADMIN" || e.userId === me?.id).length ? "전체 해제" : "전체 선택"}
              </button>
            )}
          </>
        )}
      </div>
      )}
    </div>
  );
}

function DetailModal({ entry, currentUser, onClose, onUpdate }: { entry: EntryDetail; currentUser: CurrentUser | null; onClose: () => void; onUpdate: () => void }) {
  const [cat, setCat] = useState(entry.category);
  const [editAddr, setEditAddr] = useState(entry.addressText || "");
  const [editMemo, setEditMemo] = useState(entry.memo || "");
  const [photoUrls, setPhotoUrls] = useState<string[]>(entry.photoUrls);
  const [photoEditMode, setPhotoEditMode] = useState(false);
  const [viewerIdx, setViewerIdx] = useState<number | null>(null);
  const [redistMode, setRedistMode] = useState(false);
  const [showMap, setShowMap] = useState(false);
  const [zones, setZones] = useState<Zone[]>([]);
  const [saving, setSaving] = useState(false);
  const [adding, setAdding] = useState(false);
  const photoAddRef = useRef<HTMLInputElement>(null);
  const catInfo = CATEGORY_MAP[cat];
  const canDelete = currentUser?.role === "ADMIN" || entry.userId === currentUser?.id;
  const canEdit = currentUser?.role === "ADMIN" || entry.userId === currentUser?.id;

  useEffect(() => {
    fetch("/api/zones").then((r) => r.json()).then((d) => { if (Array.isArray(d)) setZones(d); });
  }, []);

  async function patch(updates: Record<string, unknown>) {
    setSaving(true);
    try {
      const res = await fetch(`/api/entries/${entry.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      if (!res.ok) {
        const data = await res.json();
        alert(data.error || "저장 실패");
      } else {
        onUpdate();
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleCategoryChange(newCat: string) {
    setCat(newCat);
    await patch({ category: newCat });
  }

  async function saveAddress() {
    const trimmed = editAddr.trim();
    if (trimmed === (entry.addressText || "").trim()) return;
    await patch({ addressText: trimmed });
  }

  async function saveMemo() {
    const trimmed = editMemo.trim();
    if (trimmed === (entry.memo || "").trim()) return;
    await patch({ memo: trimmed });
  }

  async function deletePhoto(idx: number) {
    if (photoUrls.length <= 1) {
      alert("사진은 최소 1장 이상이어야 합니다");
      return;
    }
    if (!confirm(`${idx + 1}번 사진을 삭제하시겠습니까?`)) return;
    const newUrls = photoUrls.filter((_, i) => i !== idx);
    setPhotoUrls(newUrls);
    await patch({ photoUrls: newUrls });
  }

  async function handleAddPhotos(files: FileList | null) {
    if (!files?.length) return;
    setAdding(true);
    try {
      const arr = Array.from(files);
      const results = await uploadPhotosChunked(arr, 10);
      const newUrls = results.map((r) => r.url);
      if (newUrls.length === 0) {
        alert("업로드 실패");
        return;
      }
      const combined = [...photoUrls, ...newUrls];
      setPhotoUrls(combined);
      await patch({ photoUrls: combined });
    } catch {
      alert("사진 추가 실패");
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-end md:items-center justify-center" onClick={onClose}>
      <div className="bg-white rounded-t-2xl md:rounded-2xl w-full max-w-lg max-h-[85vh] overflow-y-auto p-4 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold">{catInfo?.label || cat}</h3>
          <button onClick={onClose} className="text-gray-400 text-xl">×</button>
        </div>

        <div className="space-y-2 text-sm">
          {[
            ["입력자", entry.userName],
            ["날짜", entry.entryDate],
            ["시간", fmtKstTime(entry.createdAt)],
            ["방식", entry.inputTrack === "batch" ? "일괄" : "실시간"],
            ["평가", `${catInfo?.eval || "별도"} (${catInfo?.points || 0}점)`],
            ["수량", `${entry.quantity}${entry.unit}`],
          ].map(([k, v]) => (
            <div key={k} className="flex justify-between">
              <span className="text-gray-500">{k}</span>
              <span className="font-medium">{v}</span>
            </div>
          ))}
        </div>

        {/* 위치 (인라인 편집) */}
        <div>
          <label className="block text-xs text-gray-500 mb-1">위치</label>
          {canEdit ? (
            <input
              type="text"
              value={editAddr}
              onChange={(e) => setEditAddr(e.target.value)}
              onBlur={saveAddress}
              placeholder="주소 입력"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:border-emerald-400 focus:outline-none"
            />
          ) : (
            <p className="text-sm">{editAddr || "-"}</p>
          )}
        </div>

        {/* 메모 (인라인 편집) */}
        <div>
          <label className="block text-xs text-gray-500 mb-1">메모</label>
          {canEdit ? (
            <textarea
              value={editMemo}
              onChange={(e) => setEditMemo(e.target.value)}
              onBlur={saveMemo}
              placeholder="메모 입력"
              rows={2}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:border-emerald-400 focus:outline-none resize-none"
            />
          ) : (
            <p className="text-sm whitespace-pre-wrap">{editMemo || "-"}</p>
          )}
        </div>

        {saving && <p className="text-[10px] text-emerald-600">저장 중...</p>}

        <div>
          <label className="block text-xs text-gray-500 mb-1">카테고리 변경</label>
          <select value={cat} onChange={(e) => handleCategoryChange(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
            {CATEGORIES.map((c) => (
              <option key={c.id} value={c.id}>{c.label}</option>
            ))}
          </select>
        </div>

        {photoUrls.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-medium text-gray-700">현장사진 ({photoUrls.length}장)</p>
              <div className="flex gap-1 flex-wrap justify-end">
                {(editAddr || (entry.latitude != null && entry.longitude != null)) && (
                  <button
                    onClick={() => setShowMap(true)}
                    className="text-xs px-2 py-1 rounded-md border border-violet-400 text-violet-700 hover:bg-violet-50"
                    title="이 항목의 위치를 지도에서 보기"
                  >
                    🗺 지도
                  </button>
                )}
                {canEdit && (
                  <button
                    onClick={() => photoAddRef.current?.click()}
                    disabled={adding}
                    className="text-xs px-2 py-1 rounded-md border border-blue-400 text-blue-700 hover:bg-blue-50 disabled:opacity-40"
                    title="사진 추가"
                  >
                    {adding ? "업로드 중..." : "+ 사진 추가"}
                  </button>
                )}
                {canEdit && (
                  <button
                    onClick={() => setPhotoEditMode(!photoEditMode)}
                    className={`text-xs px-2 py-1 rounded-md border ${
                      photoEditMode
                        ? "bg-red-50 border-red-400 text-red-700"
                        : "border-gray-300 text-gray-600 hover:bg-gray-50"
                    }`}
                    title="사진 삭제 모드 토글"
                  >
                    {photoEditMode ? "완료" : "사진 편집"}
                  </button>
                )}
                {canEdit && zones.length > 0 && photoUrls.length > 1 && (
                  <button
                    onClick={() => setRedistMode(true)}
                    className="text-xs px-2 py-1 rounded-md border border-emerald-400 text-emerald-700 hover:bg-emerald-50"
                    title="잘못 묶인 사진을 사진별로 구역에 재배정"
                  >
                    구역 분배
                  </button>
                )}
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {photoUrls.map((url, i) => (
                <div key={url} className="relative aspect-square rounded-lg overflow-hidden bg-gray-100">
                  <button
                    type="button"
                    onClick={() => !photoEditMode && setViewerIdx(i)}
                    className="w-full h-full hover:ring-2 hover:ring-emerald-400 transition-all"
                  >
                    <img src={url} alt="" className="w-full h-full object-cover pointer-events-none" />
                  </button>
                  {photoEditMode && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        deletePhoto(i);
                      }}
                      className="absolute top-1 right-1 w-6 h-6 rounded-full bg-red-600 text-white text-xs font-bold flex items-center justify-center shadow-lg hover:bg-red-700"
                      title="삭제"
                    >
                      ×
                    </button>
                  )}
                </div>
              ))}
            </div>
            {photoEditMode && (
              <p className="text-[10px] text-gray-400 mt-1">
                ⚠ 삭제는 즉시 반영됩니다. 최소 1장 이상 유지해야 합니다.
              </p>
            )}
            {/* 숨겨진 파일 input — "사진 추가" 버튼이 트리거 */}
            <input
              ref={photoAddRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => {
                handleAddPhotos(e.target.files);
                e.target.value = "";
              }}
            />
          </div>
        )}

        {showMap && (
          <AddressMapModal
            address={editAddr || undefined}
            lat={entry.latitude ?? undefined}
            lng={entry.longitude ?? undefined}
            title={catInfo?.label || cat}
            onClose={() => setShowMap(false)}
            onLocationSelect={(addr) => {
              setEditAddr(addr);
              patch({ addressText: addr });
            }}
          />
        )}

        {redistMode && (
          <RedistributeModal
            photoUrls={photoUrls}
            initialZoneId={entry.zoneId}
            zones={zones}
            onClose={() => setRedistMode(false)}
            onApply={async (assignments) => {
              const res = await fetch(`/api/entries/${entry.id}/redistribute`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ assignments }),
              });
              if (res.ok) {
                const data = await res.json();
                alert(`${data.created}건으로 분배 완료`);
                setRedistMode(false);
                onClose();
                onUpdate();
              } else {
                const data = await res.json();
                alert(data.error || "분배 실패");
              }
            }}
          />
        )}

        {viewerIdx !== null && (
          <PhotoViewer
            photos={photoUrls}
            initialIdx={Math.min(viewerIdx, photoUrls.length - 1)}
            onClose={() => setViewerIdx(null)}
            caption={`${catInfo?.label || cat}${editAddr ? ` · ${editAddr}` : ""}`}
          />
        )}

        {canDelete && (
          <button onClick={async () => {
            if (!confirm("이 항목을 삭제하시겠습니까?")) return;
            const res = await fetch(`/api/entries/${entry.id}`, { method: "DELETE" });
            if (!res.ok) { alert("삭제 권한이 없습니다"); return; }
            onClose(); onUpdate();
          }} className="w-full py-2 text-sm text-red-500 border border-red-200 rounded-lg">
            삭제
          </button>
        )}
      </div>
    </div>
  );
}

function SummaryCard({ label, value, color, onClick }: { label: string; value: string; color: string; onClick?: () => void }) {
  return (
    <div
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } } : undefined}
      className={`rounded-xl p-3 ${color} ${onClick ? "cursor-pointer hover:shadow-md active:scale-95 transition-all" : ""}`}
    >
      <p className="text-xs opacity-70">{label}</p>
      <p className="text-2xl font-bold mt-1">{value}</p>
    </div>
  );
}

/** 수동 입력 가능한 평가항목 */
const MANUAL_ITEMS = new Set([
  "과태료", "경고판",
  "분리배출(폐건전지)", "분리배출(폐소형가전)", "분리배출(투명페트병)",
  "특수사업",
]);

const BUNRI_ITEMS = ["분리배출(폐건전지)", "분리배출(폐소형가전)", "분리배출(투명페트병)"];
const BUNRI_LABELS: Record<string, string> = {
  "분리배출(폐건전지)": "폐건전지",
  "분리배출(폐소형가전)": "폐소형가전",
  "분리배출(투명페트병)": "투명페트병",
};

function EvalProgressSection({
  evalProgress,
  isAdmin,
  onUpdate,
}: {
  evalProgress: EvalItem[];
  isAdmin: boolean;
  onUpdate: () => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [editVal, setEditVal] = useState(0);
  const [editNote, setEditNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [bunriOpen, setBunriOpen] = useState(false);

  async function saveManual(evalItem: string) {
    setSaving(true);
    await fetch("/api/eval-manual", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ evalItem, manualCount: editVal, note: editNote || null }),
    });
    setSaving(false);
    setEditing(null);
    onUpdate();
  }

  // 분리배출 3파트 → 합산 게이지
  const bunriItems = evalProgress.filter((e) => BUNRI_ITEMS.includes(e.name));
  const bunriTotalMax = bunriItems.reduce((s, e) => s + e.maxPoints, 0) || 15;
  const bunriTotalEarned = bunriItems.reduce((s, e) => s + e.earnedPoints, 0);
  const bunriHasAny = bunriItems.some((e) => e.current > 0);

  // 분리배출 제외한 일반 항목
  const normalItems = evalProgress.filter((e) => !BUNRI_ITEMS.includes(e.name));

  function renderItem(item: EvalItem, label?: string) {
    const canManual = MANUAL_ITEMS.has(item.name) && isAdmin;
    const isEditing = editing === item.name;
    const displayName = label || item.name;

    return (
      <div key={item.name}>
        <div className="flex justify-between text-sm mb-1">
          <div className="flex items-center gap-1.5">
            <span className="text-gray-600">{displayName}</span>
            {item.isManual && (
              <span className="text-[9px] px-1 py-0.5 rounded bg-amber-100 text-amber-700 font-medium">수동</span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-gray-900 font-medium">
              {item.current}건
              {item.isManual && item.autoCount > 0 && (
                <span className="text-gray-300 ml-1">(자동 {item.autoCount})</span>
              )}
              {item.target > 0 && <span className="text-gray-400"> / {item.target}</span>}
              <span className="text-gray-400 ml-1">({item.maxPoints}점)</span>
            </span>
            {canManual && !isEditing && (
              <button
                onClick={() => { setEditing(item.name); setEditVal(item.current); setEditNote(""); }}
                className="text-[10px] text-indigo-500 hover:text-indigo-700"
                title="수동 입력"
              >
                ✏️
              </button>
            )}
          </div>
        </div>
        {isEditing && (
          <div className="flex gap-2 mb-1.5 items-center">
            <input type="number" min={0} value={editVal}
              onChange={(e) => setEditVal(parseInt(e.target.value) || 0)}
              className="w-20 px-2 py-1 border border-indigo-300 rounded text-sm text-center" />
            <input type="text" value={editNote}
              onChange={(e) => setEditNote(e.target.value)}
              placeholder="비고 (선택)"
              className="flex-1 px-2 py-1 border border-gray-300 rounded text-xs" />
            <button onClick={() => saveManual(item.name)} disabled={saving}
              className="text-xs px-2.5 py-1 bg-indigo-600 text-white rounded font-semibold disabled:opacity-50">
              저장
            </button>
            <button onClick={() => setEditing(null)} className="text-xs text-gray-400">취소</button>
          </div>
        )}
        <div className="w-full bg-gray-200 rounded-full h-2.5">
          <div className={`h-2.5 rounded-full transition-all ${item.current > 0 ? "bg-emerald-500" : "bg-gray-300"}`}
            style={{ width: `${item.target > 0 ? Math.min(100, (item.current / item.target) * 100) : item.current > 0 ? 100 : 0}%` }} />
        </div>
      </div>
    );
  }

  return (
    <div>
      <h3 className="text-sm font-semibold text-gray-700 mb-3">반기 평가 진척도 (100점)</h3>
      <div className="space-y-3">
        {normalItems.map((item) => {
          // 분리배출 합산 행 삽입 위치: 현장평가 다음
          if (item.name === "특수사업" && bunriItems.length > 0) {
            return (
              <div key="__bunri_group__">
                {/* 분리배출 합산 헤더 (클릭 → 펼침) */}
                <div>
                  <button
                    onClick={() => setBunriOpen(!bunriOpen)}
                    className="w-full flex justify-between text-sm mb-1 text-left"
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="text-gray-600">분리배출</span>
                      <span className="text-[9px] px-1 py-0.5 rounded bg-amber-100 text-amber-700 font-medium">수동</span>
                      <span className="text-gray-400 text-[10px]">{bunriOpen ? "▲" : "▼"}</span>
                    </div>
                    <span className="text-gray-900 font-medium">
                      {bunriTotalEarned}점<span className="text-gray-400">/{bunriTotalMax}점</span>
                    </span>
                  </button>
                  <div className="w-full bg-gray-200 rounded-full h-2.5">
                    <div className={`h-2.5 rounded-full transition-all ${bunriHasAny ? "bg-emerald-500" : "bg-gray-300"}`}
                      style={{ width: `${Math.min(100, (bunriTotalEarned / bunriTotalMax) * 100)}%` }} />
                  </div>
                </div>
                {/* 펼침: 하위 3파트 */}
                {bunriOpen && (
                  <div className="ml-4 mt-2 space-y-2 border-l-2 border-emerald-200 pl-3">
                    {bunriItems.map((bi) => renderItem(bi, BUNRI_LABELS[bi.name] || bi.name))}
                  </div>
                )}
                {/* 특수사업 (원래 이 위치) */}
                <div className="mt-3">{renderItem(item)}</div>
              </div>
            );
          }
          return renderItem(item);
        })}
      </div>
    </div>
  );
}


