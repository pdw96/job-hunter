// 목차에서 굵게 보일 묶음 고르기. tops는 화면 위쪽에서 잰 각 묶음 제목의 높이(문서 순서), line은 기준선
// 기준선 위로 올라간 마지막 묶음이 지금 묶음이고, 아직 하나도 안 올라갔으면 첫 묶음이다
export function activeSection(tops: { id: string; top: number }[], line: number): string | null {
  if (tops.length === 0) return null;
  let current = tops[0].id;
  for (const { id, top } of tops) {
    if (top <= line) current = id;
  }
  return current;
}
