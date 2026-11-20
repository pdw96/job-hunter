// 새 경험 기록(메뉴별 표)을 쓸지 정하는 스위치. 전환 PR에서 쓰기 시작한다
export function newRecordsOn(): boolean {
  return process.env.NEW_RECORDS === "1";
}
