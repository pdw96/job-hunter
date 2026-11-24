// 글자(코드 포인트) 단위로 자른다. 이모지가 반으로 잘리면 PostgreSQL jsonb가 저장을 거부한다
export const cut = (text: string, max: number): string => [...text].slice(0, max).join("");

import { type CompanyFact, hostOf } from "@/modules/postings/research";

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

// AI가 답 별명을 "A1", "[A1]", "a1", "A1 (지원동기)"처럼 조금 다르게 써도 읽는다. 별명으로 시작할 때만 번호를 돌려준다
export function answerAlias(raw: string): number | null {
  const found = raw.match(/^[\s"'`“”‘’「」『』<>()[\]{}]*A(\d+)\b/i);
  return found ? Number(found[1]) : null;
}

// 회사 정보 별명(C1, C2 …)을 answerAlias와 같은 방식으로 읽는다. C0처럼 1보다 작은 번호는 별명이 아니다
export function companyAlias(raw: string): number | null {
  const found = raw.match(/^[\s"'`“”‘’「」『』<>()[\]{}]*C([1-9]\d*)\b/i);
  return found ? Number(found[1]) : null;
}

// 회사 정보 한 줄(별명 없이). "인재상: (글) (출처: 호스트)" / "소식(날짜 또는 날짜 모름): (요약) (출처: 호스트)"
export function describeCompanyFact(fact: CompanyFact): string {
  const label = fact.kind === "talent" ? "인재상" : `소식(${fact.date ?? "날짜 모름"})`;
  return `${label}: ${fact.text} (출처: ${hostOf(fact.url)})`;
}
