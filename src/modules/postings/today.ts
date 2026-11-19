// 사용자가 있는 곳(한국)의 오늘 날짜를 YYYY-MM-DD로 돌려준다. 마감이 지났는지 볼 때 쓴다
export function todayInKorea(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(now);
}

// 어느 시각이든 한국 시각의 날짜(YYYY-MM-DD)로 돌려준다
export const koreaDate = (at: Date): string => todayInKorea(at);

// 한국 시각의 월/일(MM/DD)
export function koreaMonthDay(at: Date): string {
  return koreaDate(at).slice(5).replace("-", "/");
}
