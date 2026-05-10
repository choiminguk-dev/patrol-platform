"use client";

import { useState, useEffect } from "react";
import { todayKr } from "@/lib/date";

interface Doc {
  id: string;
  docType: string;
  title: string;
  content?: string;
  periodStart: string;
  periodEnd: string;
  createdAt: string;
}

/** 월별 주차 계산: 1주차=1일~첫 일요일, 이후 월~일 단위 */
function getMonthWeeks(year: number, month: number) {
  const weeks: { label: string; start: string; end: string }[] = [];
  const lastDate = new Date(year, month, 0).getDate(); // 해당 월 마지막 일
  let day = 1;
  let weekNum = 1;

  while (day <= lastDate) {
    const start = new Date(year, month - 1, day);
    let end: Date;

    if (weekNum === 1) {
      // 1주차: 1일 ~ 첫 일요일
      const dow = start.getDay(); // 0=일
      const sunOffset = dow === 0 ? 0 : 7 - dow;
      end = new Date(year, month - 1, Math.min(day + sunOffset, lastDate));
    } else {
      // 이후: 월~일 (7일)
      end = new Date(year, month - 1, Math.min(day + 6, lastDate));
    }

    const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const shortDate = (d: Date) => `${d.getMonth() + 1}.${d.getDate()}.`;
    weeks.push({
      label: `${weekNum}주차 (${shortDate(start)}~${shortDate(end)})`,
      start: fmt(start),
      end: fmt(end),
    });

    day = end.getDate() + 1;
    weekNum++;
  }
  return weeks;
}

const DOC_TYPES = [
  { id: "field_log", label: "동 현장 점검 일지", desc: "일일 현장 점검 양식" },
  { id: "weekly_report", label: "주간 순찰보고", desc: "주간 순찰 종합 보고서" },
  { id: "quarter_package", label: "실적 종합보고", desc: "기간별 실적 종합 분석" },
];

export default function DocsPage() {
  const [docType, setDocType] = useState("field_log");
  const [startDate, setStartDate] = useState(todayKr());
  const [endDate, setEndDate] = useState(todayKr());
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<Doc | null>(null);
  const [history, setHistory] = useState<Doc[]>([]);
  const [viewDoc, setViewDoc] = useState<Doc | null>(null);
  const [error, setError] = useState("");
  const [dlStructured, setDlStructured] = useState(false);

  // 주차 탐색
  const todayDate = todayKr();
  const [weekYear, setWeekYear] = useState(parseInt(todayDate.slice(0, 4)));
  const [weekMonth, setWeekMonth] = useState(parseInt(todayDate.slice(5, 7)));
  const weeks = getMonthWeeks(weekYear, weekMonth);
  // 오늘이 포함된 주차를 기본 선택 — 같은 월/년이면 자동 매칭, 다르면 null(전체)
  const todayWeekKey = (() => {
    const todayY = parseInt(todayDate.slice(0, 4));
    const todayM = parseInt(todayDate.slice(5, 7));
    if (todayY !== weekYear || todayM !== weekMonth) return null;
    const w = weeks.find((wk) => todayDate >= wk.start && todayDate <= wk.end);
    return w ? `${w.start}~${w.end}` : null;
  })();
  const [selectedWeek, setSelectedWeek] = useState<string | null>(todayWeekKey);

  function downloadCsv(start: string, end: string) {
    const a = document.createElement("a");
    a.href = `/api/entries/csv?start=${start}&end=${end}`;
    a.download = `환경순찰_${start}_${end}.csv`;
    a.click();
  }

  /** 구조화 일지용 다운로드 (날짜 범위 → 각 날짜별 ZIP) */
  async function downloadStructured(start: string, end: string) {
    setDlStructured(true);
    try {
      const s = new Date(start + "T12:00:00");
      const e = new Date(end + "T12:00:00");
      for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
        const dateStr = d.toISOString().slice(0, 10);
        const res = await fetch(`/api/entries/download-photos?date=${dateStr}&structured=true&blur=true`);
        if (!res.ok) continue; // 해당 날짜 데이터 없으면 skip
        const blob = await res.blob();
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `환경순찰_${dateStr}_전체_구조화.zip`;
        a.click();
        URL.revokeObjectURL(a.href);
      }
    } finally {
      setDlStructured(false);
    }
  }

  useEffect(() => { loadHistory(); }, []);

  async function loadHistory() {
    const res = await fetch("/api/docs");
    if (res.ok) setHistory(await res.json());
  }

  async function handleGenerate() {
    setGenerating(true);
    setError("");
    setResult(null);

    try {
      const res = await fetch("/api/docs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ docType, startDate, endDate }),
      });
      const data = await res.json();
      if (res.ok) {
        setResult(data);
        loadHistory();
      } else {
        setError(data.error || "생성 실패");
      }
    } catch {
      setError("네트워크 오류");
    }
    setGenerating(false);
  }

  // 문서 보기 모드
  if (viewDoc) {
    return (
      <div className="p-4 md:p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-gray-900">{viewDoc.title}</h2>
          <button onClick={() => setViewDoc(null)} className="text-sm text-emerald-600">← 목록</button>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4 md:p-6 prose prose-sm max-w-none whitespace-pre-wrap text-sm leading-relaxed">
          {viewDoc.content}
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={() => downloadStructured(viewDoc.periodStart, viewDoc.periodEnd)}
            disabled={dlStructured}
            className="flex-1 py-2 rounded-lg bg-indigo-600 text-white text-sm font-semibold disabled:opacity-50">
            {dlStructured ? "준비 중..." : "📁 일지용"}
          </button>
          <button onClick={() => {
            const blob = new Blob([viewDoc.content || ""], { type: "text/plain;charset=utf-8" });
            const a = document.createElement("a");
            a.href = URL.createObjectURL(blob);
            a.download = `${viewDoc.title}.txt`;
            a.click();
          }} className="flex-1 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold">
            TXT
          </button>
          <button onClick={() => downloadCsv(viewDoc.periodStart, viewDoc.periodEnd)}
            className="flex-1 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold">
            CSV
          </button>
          <button onClick={() => { navigator.clipboard.writeText(viewDoc.content || ""); }}
            className="flex-1 py-2 rounded-lg border border-emerald-600 text-emerald-600 text-sm font-semibold">
            복사
          </button>
          <button onClick={async () => {
            if (!confirm("이 문서를 삭제하시겠습니까?")) return;
            await fetch(`/api/docs/${viewDoc.id}`, { method: "DELETE" });
            setViewDoc(null); loadHistory();
          }} className="py-2 px-3 rounded-lg border border-red-200 text-red-500 text-sm">
            삭제
          </button>
        </div>
      </div>
    );
  }

  // 생성 결과
  if (result) {
    return (
      <div className="p-4 md:p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-gray-900">{result.title}</h2>
          <button onClick={() => setResult(null)} className="text-sm text-emerald-600">← 돌아가기</button>
        </div>
        <p className="text-xs text-gray-500">{(result as any).entryCount}건 데이터 기반</p>
        <div className="bg-white rounded-xl border border-gray-200 p-4 md:p-6 whitespace-pre-wrap text-sm leading-relaxed">
          {result.content}
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={() => downloadStructured(startDate, endDate)}
            disabled={dlStructured}
            className="flex-1 py-2 rounded-lg bg-indigo-600 text-white text-sm font-semibold disabled:opacity-50">
            {dlStructured ? "준비 중..." : "📁 일지용"}
          </button>
          <button onClick={() => {
            const blob = new Blob([result.content || ""], { type: "text/plain;charset=utf-8" });
            const a = document.createElement("a");
            a.href = URL.createObjectURL(blob);
            a.download = `${result.title}.txt`;
            a.click();
          }} className="flex-1 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold">
            TXT
          </button>
          <button onClick={() => downloadCsv(startDate, endDate)}
            className="flex-1 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold">
            CSV
          </button>
          <button onClick={() => { navigator.clipboard.writeText(result.content || ""); }}
            className="flex-1 py-2 rounded-lg border border-emerald-600 text-emerald-600 text-sm font-semibold">
            복사
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-6">
      <h2 className="text-xl font-bold text-gray-900">문서 생성</h2>

      {/* 문서 유형 선택 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {DOC_TYPES.map((dt) => (
          <button key={dt.id} onClick={() => setDocType(dt.id)}
            className={`p-3 rounded-xl border text-left transition-colors ${
              docType === dt.id ? "border-emerald-500 bg-emerald-50" : "border-gray-200 bg-white"
            }`}>
            <p className="font-semibold text-sm">{dt.label}</p>
            <p className="text-xs text-gray-500 mt-0.5">{dt.desc}</p>
          </button>
        ))}
      </div>

      {/* 날짜 범위 */}
      <div className="flex gap-3 items-end">
        <div className="flex-1">
          <label className="block text-sm font-medium text-gray-700 mb-1">시작일</label>
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
        </div>
        <span className="pb-2 text-gray-400">~</span>
        <div className="flex-1">
          <label className="block text-sm font-medium text-gray-700 mb-1">종료일</label>
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
        </div>
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}

      <button onClick={handleGenerate} disabled={generating}
        className="w-full py-3 rounded-lg bg-emerald-600 text-white font-semibold disabled:opacity-50">
        {generating ? "AI 생성 중..." : "문서 생성"}
      </button>

      {/* 주차별 폴더 + 생성 이력 */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <h3 className="text-sm font-semibold text-gray-700">생성 이력</h3>
          <div className="flex items-center gap-1 ml-auto">
            <button onClick={() => {
              const d = new Date(weekYear, weekMonth - 2, 1);
              setWeekYear(d.getFullYear()); setWeekMonth(d.getMonth() + 1);
              setSelectedWeek(null);
            }} className="text-xs text-gray-400 px-1">◀</button>
            <span className="text-xs font-medium text-gray-600 min-w-[60px] text-center">
              {weekYear}.{String(weekMonth).padStart(2, "0")}
            </span>
            <button onClick={() => {
              const d = new Date(weekYear, weekMonth, 1);
              setWeekYear(d.getFullYear()); setWeekMonth(d.getMonth() + 1);
              setSelectedWeek(null);
            }} className="text-xs text-gray-400 px-1">▶</button>
          </div>
        </div>

        {/* 주차 버튼 */}
        <div className="flex gap-1.5 overflow-x-auto pb-2 mb-3">
          <button
            onClick={() => { setSelectedWeek(null); }}
            className={`shrink-0 text-[11px] px-2.5 py-1.5 rounded-lg font-medium transition-colors ${
              !selectedWeek ? "bg-emerald-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            전체
          </button>
          {weeks.map((w) => {
            const key = `${w.start}~${w.end}`;
            const isActive = selectedWeek === key;
            // 해당 주에 이력이 있는지
            const hasDoc = history.some((d) => d.periodStart >= w.start && d.periodStart <= w.end);
            return (
              <button
                key={key}
                onClick={() => {
                  setSelectedWeek(isActive ? null : key);
                  if (!isActive) {
                    setStartDate(w.start);
                    setEndDate(w.end);
                  }
                }}
                className={`shrink-0 text-[11px] px-2.5 py-1.5 rounded-lg font-medium transition-colors ${
                  isActive
                    ? "bg-emerald-600 text-white"
                    : hasDoc
                    ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                    : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                }`}
              >
                {w.label}
              </button>
            );
          })}
        </div>

        {/* 이력 목록 (주차 필터 적용) */}
        {(() => {
          const filtered = selectedWeek
            ? history.filter((d) => {
                const [ws, we] = selectedWeek.split("~");
                return d.periodStart >= ws && d.periodStart <= we;
              })
            : history;
          if (filtered.length === 0) {
            return (
              <p className="text-xs text-gray-400 text-center py-4">
                {selectedWeek ? "해당 주차의 생성 이력이 없습니다" : "생성 이력이 없습니다"}
              </p>
            );
          }
          return (
            <div className="space-y-2">
              {filtered.map((doc) => (
                <div key={doc.id} className="flex items-center gap-2">
                  <button onClick={async () => {
                    const res = await fetch(`/api/docs/${doc.id}`);
                    if (res.ok) setViewDoc(await res.json());
                  }}
                    className="flex-1 flex items-center justify-between bg-white rounded-lg border border-gray-200 px-3 py-2 text-left hover:border-emerald-400">
                    <div>
                      <p className="text-sm font-medium">{doc.title}</p>
                      <p className="text-xs text-gray-400">{doc.periodStart} ~ {doc.periodEnd}</p>
                    </div>
                    <p className="text-xs text-gray-400 shrink-0 ml-2">
                      {doc.createdAt?.slice(0, 10)}
                    </p>
                  </button>
                  <button onClick={async (e) => {
                    e.stopPropagation();
                    if (!confirm("이 문서를 삭제하시겠습니까?")) return;
                    await fetch(`/api/docs/${doc.id}`, { method: "DELETE" });
                    loadHistory();
                  }} className="text-xs text-red-400 shrink-0 px-2">삭제</button>
                </div>
              ))}
            </div>
          );
        })()}
      </div>
    </div>
  );
}
