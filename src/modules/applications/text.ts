// 글자(코드 포인트) 단위로 자른다. 이모지가 반으로 잘리면 PostgreSQL jsonb가 저장을 거부한다
export const cut = (text: string, max: number): string => [...text].slice(0, max).join("");

// AI가 경험 별명을 "E1 (이름)", "[E1]", "e1", "E1:"처럼 조금 다르게 써도 읽는다. 별명이 정확히 하나일 때만 "E<n>"을 돌려준다
export function aliasKey(raw: string): string | null {
  const found = raw.match(/\bE\d+\b/gi);
  return found?.length === 1 ? found[0].toUpperCase() : null;
}

// 앞뒤의 따옴표·괄호를 떼고 공백을 하나로 줄인다
const normalizeName = (s: string): string =>
  s
    .trim()
    .replace(/^[\s"'`“”‘’「」『』<>()[\]{}]+|[\s"'`“”‘’「」『』<>()[\]{}]+$/g, "")
    .replace(/\s+/g, " ");

// AI가 경험을 가리키는 칸에 별명(E1) 대신 경험 이름을 적어도 읽는다. 별명이 먼저이고, 이름은 정확히 한 경험과 같을 때만 받아들인다
export function resolveAlias<T extends { name: string }>(raw: string, sources: T[]): T | undefined {
  const key = aliasKey(raw);
  if (key) return sources[Number(key.slice(1)) - 1];
  const want = normalizeName(raw);
  if (!want) return undefined;
  const hits = sources.filter((s) => normalizeName(s.name) === want);
  return hits.length === 1 ? hits[0] : undefined;
}
