/**
 * 한국 시간(KST) 기준 날짜 헬퍼
 * 클라이언트/서버 모두 동일하게 동작 (Asia/Seoul 명시)
 *
 * 문제: new Date().toISOString().slice(0,10)은 UTC 기준 → 한국 자정 직후 전날 표시
 * 해결: Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }) 사용
 *       en-CA 로케일은 YYYY-MM-DD 형식 반환
 */

const KR_FORMAT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** 오늘 (한국 기준) YYYY-MM-DD */
export function todayKr(): string {
  return KR_FORMAT.format(new Date());
}

/** 특정 Date를 한국 기준 YYYY-MM-DD로 변환 */
export function dateKr(date: Date | number): string {
  return KR_FORMAT.format(new Date(date));
}

/** N일 전 (한국 기준) YYYY-MM-DD */
export function daysAgoKr(days: number): string {
  return KR_FORMAT.format(new Date(Date.now() - days * 86400000));
}
