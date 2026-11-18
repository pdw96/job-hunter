// 글자(코드 포인트) 단위로 자른다. 이모지가 반으로 잘리면 PostgreSQL jsonb가 저장을 거부한다
export const cut = (text: string, max: number): string => [...text].slice(0, max).join("");

// AI가 경험 별명을 "E1 (이름)", "[E1]", "e1", "E1:"처럼 조금 다르게 써도 읽는다. 별명이 정확히 하나일 때만 "E<n>"을 돌려준다
export function aliasKey(raw: string): string | null {
  const found = raw.match(/\bE\d+\b/gi);
  return found?.length === 1 ? found[0].toUpperCase() : null;
}
