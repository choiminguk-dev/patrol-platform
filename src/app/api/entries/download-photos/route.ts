import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { queryMany } from "@/lib/db";
import { CATEGORY_MAP } from "@/lib/categories";
import { readFile } from "fs/promises";
import { join } from "path";
import { zipSync } from "fflate";

const UPLOAD_DIR = join(process.cwd(), "uploads");

/** 사진 파일 읽기 — blur=true면 _blur 버전 우선, 없으면 원본 폴백.
 *  isBlurred = true면 _blur 파일이 실제로 사용됨 (얼굴 감지된 사진) */
async function readPhoto(url: string, blur: boolean): Promise<{ data: Uint8Array; ext: string; isBlurred: boolean } | null> {
  const relPath = url.replace("/api/uploads/", "");
  const filePath = join(UPLOAD_DIR, ...relPath.split("/"));
  const ext = filePath.split(".").pop() || "jpg";

  if (blur) {
    const blurPath = filePath.replace(`.${ext}`, `_blur.${ext}`);
    try {
      const data = await readFile(blurPath);
      return { data: new Uint8Array(data), ext, isBlurred: true };
    } catch {
      // _blur 파일 없으면 원본 폴백
    }
  }

  try {
    const data = await readFile(filePath);
    return { data: new Uint8Array(data), ext, isBlurred: false };
  } catch {
    return null;
  }
}

/** 파일명에 쓸 수 없는 문자/공백 정리 */
function safeName(s: string, max = 30): string {
  return (s || "")
    .replace(/[\\/:*?"<>|]/g, "")
    .replace(/\s+/g, "_")
    .slice(0, max);
}

/** CSV 셀 이스케이프 */
function csvCell(v: string): string {
  return `"${(v || "").replace(/"/g, '""')}"`;
}

/** HTML 본문 이스케이프 */
function htmlEscape(s: string): string {
  return (s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** HTML 속성 이스케이프 (개행 보존) */
function htmlAttr(s: string): string {
  return (s || "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\r/g, "")
    .replace(/\n/g, "&#10;");
}

/** 사진 다운로드
 *  - 기본: 평탄(flat) ZIP — 파일명 {HHMMSS}-{사진순번}.jpg
 *  - ?structured=true: 항목별 폴더 + _목록.csv (일일순찰일지 hwpx 작성용)
 *
 *  시간(createdAt) 기반 파일명이라 삭제/추가에도 절대 변하지 않음 → 대시보드 시간과 매칭
 */
export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "인증 필요" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const date = searchParams.get("date");
  const category = searchParams.get("category");
  const idsParam = searchParams.get("ids"); // 쉼표 구분 ID 리스트 (선택)
  const structured = searchParams.get("structured") === "true";
  const useBlur = searchParams.get("blur") === "true"; // 블러 버전 사용

  if (!date) {
    return NextResponse.json({ error: "date 필수" }, { status: 400 });
  }

  // 구조화 모드는 시간 오름차순(연번 1=가장 이른 시각), 평탄 모드는 기존 동작 유지
  const orderDir = structured ? "ASC" : "DESC";
  const allEntries = await queryMany<{
    id: string;
    photoUrls: string[];
    category: string;
    addressText: string | null;
    memo: string | null;
    zoneId: string | null;
    landmark: string | null;
    userName: string;
    createdAt: string;
  }>(
    `SELECT e.id, e."photoUrls", e.category, e."addressText", e.memo, e."zoneId",
            z.landmark, u.name as "userName", e."createdAt"
     FROM patrol_entries e
     JOIN users u ON u.id = e."userId"
     LEFT JOIN patrol_zones z ON z.id = e."zoneId"
     WHERE e."entryDate" = $1
     ORDER BY e."createdAt" ${orderDir}`,
    [date]
  );

  // 다운로드 대상 필터링
  const ids = idsParam ? idsParam.split(",").filter(Boolean) : null;
  let targets = allEntries;
  if (ids) {
    targets = allEntries.filter((e) => ids.includes(e.id));
  } else if (category) {
    targets = allEntries.filter((e) => e.category === category);
  }

  const files: Record<string, Uint8Array> = {};

  // KST 시간 추출 헬퍼
  const kstFmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Seoul",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  });
  const extractHHMMSS = (iso: string) => {
    const parts = kstFmt.formatToParts(new Date(iso));
    const hh = parts.find(p => p.type === "hour")?.value || "00";
    const mm = parts.find(p => p.type === "minute")?.value || "00";
    const ss = parts.find(p => p.type === "second")?.value || "00";
    return { hh, mm, ss };
  };

  // 복붙용 일시 포맷 (KST): "4.9. 22:25"
  const kstDateFmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Seoul",
    month: "numeric", day: "numeric",
  });
  const formatDateTime = (iso: string): string => {
    const dParts = kstDateFmt.formatToParts(new Date(iso));
    const mo = dParts.find(p => p.type === "month")?.value || "0";
    const da = dParts.find(p => p.type === "day")?.value || "0";
    const { hh, mm } = extractHHMMSS(iso);
    return `${mo}.${da}. ${hh}:${mm}`;
  };

  // ===== 구조화 모드: 항목별 폴더 + _목록.csv + _미리보기.html =====
  if (structured) {
    if (targets.length === 0) {
      return NextResponse.json(
        { error: "다운로드할 사진이 없습니다" },
        { status: 404 }
      );
    }

    const csvRows: string[] = [];
    csvRows.push(["연번", "일시", "카테고리", "위치", "구역", "사진수", "메모", "담당"].map(csvCell).join(","));

    const htmlCards: string[] = [];
    let totalPhotoCount = 0;
    let blurredPhotoCount = 0;

    let seq = 1;
    for (const entry of targets) {
      const { hh, mm, ss } = extractHHMMSS(entry.createdAt);
      const dateTimeStr = formatDateTime(entry.createdAt); // "4.9. 22:25"
      const timeKey = `${hh}${mm}${ss}`;
      const seqStr = String(seq).padStart(4, "0");
      const folderBase = safeName(entry.addressText || "위치미상");
      const folderName = `${seqStr}_${timeKey}_${folderBase}`;

      const catLabel = CATEGORY_MAP[entry.category]?.label || entry.category;
      const photoCount = (entry.photoUrls || []).length;

      // _info.txt — 일일순찰일지 양식 셀에 바로 복붙할 수 있는 포맷
      const infoLines = [
        `연번: ${seq}`,
        `일시: ${dateTimeStr}`,
        `카테고리: ${catLabel}`,
        `위치: ${entry.addressText || "(미입력)"}`,
        `구역: ${entry.landmark || "-"}`,
        `사진수: ${photoCount}장`,
        `메모: ${entry.memo || "-"}`,
        `담당: ${entry.userName}`,
      ];
      files[`${folderName}/_info.txt`] = new TextEncoder().encode(infoLines.join("\r\n"));

      // CSV 행 (엑셀 호환)
      csvRows.push([
        String(seq),
        dateTimeStr,
        catLabel,
        entry.addressText || "",
        entry.landmark || "",
        String(photoCount),
        (entry.memo || "").replace(/[\r\n]+/g, " "),
        entry.userName,
      ].map(csvCell).join(","));

      // 사진 (1.jpg, 2.jpg ...) + HTML용 상대 경로 + 블러 여부 수집
      const photoRelPaths: { path: string; isBlurred: boolean }[] = [];
      let photoIdx = 1;
      for (const url of entry.photoUrls || []) {
        const photo = await readPhoto(url, useBlur);
        if (!photo) continue;
        const fileName = `${photoIdx}.${photo.ext}`;
        files[`${folderName}/${fileName}`] = photo.data;
        photoRelPaths.push({
          path: `${encodeURIComponent(folderName)}/${encodeURIComponent(fileName)}`,
          isBlurred: photo.isBlurred,
        });
        totalPhotoCount++;
        if (photo.isBlurred) blurredPhotoCount++;
        photoIdx++;
      }

      // HTML 카드
      const copyText = [
        `${seq} · ${dateTimeStr}`,
        entry.addressText || "(미입력)",
        entry.landmark ? `구역: ${entry.landmark}` : "",
        `${catLabel} · 사진 ${photoCount}장`,
        entry.memo ? `메모: ${entry.memo}` : "",
      ].filter(Boolean).join("\n");

      const photoLinksHtml = photoRelPaths
        .map(
          (p) =>
            `<a href="${p.path}" target="_blank"${p.isBlurred ? ' class="blurred" title="얼굴 감지·블러 처리됨"' : ""}><img src="${p.path}" loading="lazy" alt=""></a>`
        )
        .join("");

      htmlCards.push(
        `<div class="card">
  <div class="meta">
    <div class="title"><span class="seq">${seq}</span>${htmlEscape(dateTimeStr)}</div>
    <div><span class="label">위치</span>${htmlEscape(entry.addressText || "(미입력)")}</div>
    <div><span class="label">구역</span>${htmlEscape(entry.landmark || "-")}</div>
    <div><span class="label">분류</span>${htmlEscape(catLabel)} · 사진 ${photoCount}장</div>
    <div><span class="label">담당</span>${htmlEscape(entry.userName)}</div>
    ${entry.memo ? `<div class="memo"><span class="label">메모</span><span class="memo-body">${htmlEscape(entry.memo)}</span></div>` : ""}
    <button class="copy" data-text="${htmlAttr(copyText)}">복사</button>
  </div>
  <div class="photos">${photoLinksHtml}</div>
</div>`
      );

      seq++;
    }

    // BOM 포함 CSV (엑셀에서 한글 깨짐 방지)
    const csvContent = "\uFEFF" + csvRows.join("\r\n");
    files["_목록.csv"] = new TextEncoder().encode(csvContent);

    // _미리보기.html — 더블클릭 시 브라우저에서 모든 항목 카드 형태로 열림
    const html = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>환경순찰 ${date} 미리보기</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "Segoe UI", "Malgun Gothic", "맑은 고딕", sans-serif; background: #f3f4f6; margin: 0; padding: 20px; color: #111827; }
  h1 { font-size: 18px; margin: 0 0 16px; color: #065f46; display: flex; align-items: baseline; gap: 10px; }
  h1 .cnt { font-size: 13px; color: #059669; font-weight: 500; }
  .hint { font-size: 12px; color: #6b7280; margin-bottom: 16px; }
  .card { background: white; border-radius: 12px; padding: 16px; margin-bottom: 14px; box-shadow: 0 1px 3px rgba(0,0,0,0.06); display: flex; gap: 16px; align-items: flex-start; }
  .card .meta { flex: 0 0 300px; font-size: 13px; line-height: 1.8; }
  .card .meta .title { font-size: 15px; font-weight: 600; margin-bottom: 6px; color: #065f46; }
  .card .meta .seq { display: inline-block; background: #065f46; color: white; padding: 2px 9px; border-radius: 4px; font-weight: 700; margin-right: 8px; font-size: 12px; vertical-align: middle; }
  .card .meta .label { color: #9ca3af; display: inline-block; min-width: 38px; margin-right: 4px; font-size: 11px; }
  .card .meta .memo { display: block; margin-top: 4px; }
  .card .meta .memo-body { white-space: pre-wrap; word-break: break-word; color: #374151; }
  .card .photos { flex: 1; display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 8px; min-width: 0; }
  .card .photos a { display: block; aspect-ratio: 1; overflow: hidden; border-radius: 8px; background: #f3f4f6; border: 1px solid #e5e7eb; position: relative; }
  .card .photos img { width: 100%; height: 100%; object-fit: cover; display: block; transition: transform 0.2s; }
  .card .photos a:hover img { transform: scale(1.05); }
  /* 블러 처리된 사진 — 주황 테두리 + 좌상단 배지로 식별 */
  .card .photos a.blurred { border: 3px solid #f59e0b; box-shadow: 0 0 0 2px rgba(245, 158, 11, 0.25); }
  .card .photos a.blurred::before {
    content: "🔒 블러";
    position: absolute; top: 6px; left: 6px; z-index: 1;
    background: #f59e0b; color: white;
    font-size: 11px; font-weight: 700;
    padding: 3px 8px; border-radius: 4px;
    letter-spacing: 0.5px;
    box-shadow: 0 1px 3px rgba(0,0,0,0.2);
    pointer-events: none;
  }
  .copy { margin-top: 10px; background: #4f46e5; color: white; border: none; padding: 6px 14px; border-radius: 6px; font-size: 12px; cursor: pointer; font-weight: 500; }
  .copy:hover { background: #4338ca; }
  .copy.done { background: #059669; }
  @media (max-width: 720px) {
    .card { flex-direction: column; }
    .card .meta { flex: none; width: 100%; }
  }
</style>
</head>
<body>
<h1>환경순찰 ${date} 미리보기 <span class="cnt">총 ${targets.length}건 · 사진 ${totalPhotoCount}장${blurredPhotoCount > 0 ? ` (🔒 블러 ${blurredPhotoCount}장)` : ""}</span></h1>
<div class="hint">사진 클릭 → 원본 열림 · "복사" 버튼 → 일시/위치/메모 클립보드 복사 → hwpx 셀에 붙여넣기${blurredPhotoCount > 0 ? ` · <span style="color:#d97706;font-weight:600;">🔒 주황 테두리 = 얼굴 감지·블러 처리됨</span>` : ""}</div>
${htmlCards.join("\n")}
<script>
document.querySelectorAll('.copy').forEach(function(btn){
  btn.addEventListener('click', function(){
    var text = btn.getAttribute('data-text') || '';
    navigator.clipboard.writeText(text).then(function(){
      var orig = btn.textContent;
      btn.textContent = '복사됨';
      btn.classList.add('done');
      setTimeout(function(){ btn.textContent = orig; btn.classList.remove('done'); }, 1500);
    }).catch(function(){
      // 폴백: textarea 트릭
      var ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch(e) {}
      document.body.removeChild(ta);
      btn.textContent = '복사됨';
      btn.classList.add('done');
      setTimeout(function(){ btn.textContent = '복사'; btn.classList.remove('done'); }, 1500);
    });
  });
});
</script>
</body>
</html>`;
    files["_미리보기.html"] = new TextEncoder().encode(html);

    const zipped = zipSync(files, { level: 0 });
    const catLabel = ids
      ? `선택${ids.length}건`
      : category
      ? CATEGORY_MAP[category]?.label || category
      : "전체";
    const filename = `환경순찰_${date}_${catLabel}_구조화.zip`;

    return new Response(Buffer.from(zipped), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      },
    });
  }

  // ===== 평탄 모드(기본): {HHMMSS}-{N}.ext =====
  // 같은 초에 여러 항목이 있으면 _2, _3 접미사
  const usedTimePrefix: Record<string, number> = {};

  for (const entry of targets) {
    const { hh, mm, ss } = extractHHMMSS(entry.createdAt);
    let timeKey = `${hh}${mm}${ss}`;

    // 동일 시각 충돌 처리 (드물지만)
    if (usedTimePrefix[timeKey]) {
      usedTimePrefix[timeKey] += 1;
      timeKey = `${timeKey}_${usedTimePrefix[timeKey]}`;
    } else {
      usedTimePrefix[timeKey] = 1;
    }

    let photoIdx = 1;
    for (const url of entry.photoUrls || []) {
      const photo = await readPhoto(url, useBlur);
      if (!photo) continue;
      files[`${timeKey}-${photoIdx}.${photo.ext}`] = photo.data;
      photoIdx++;
    }
  }

  if (Object.keys(files).length === 0) {
    return NextResponse.json(
      { error: "다운로드할 사진이 없습니다" },
      { status: 404 }
    );
  }

  const zipped = zipSync(files, { level: 0 });
  const catLabel = ids
    ? `선택${ids.length}건`
    : category
    ? CATEGORY_MAP[category]?.label || category
    : "전체";
  const filename = `환경순찰_${date}_${catLabel}.zip`;

  return new Response(Buffer.from(zipped), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  });
}
