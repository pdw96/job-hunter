import type { ExperienceInput } from "./input";
import type { SceneInput } from "./record-input";

// AI가 정리한 초안에, 사용자가 쓴 글에는 없던 숫자가 있는지 찾는다.
// 수치를 지어내는 것을 코드로 한 번 더 거르는 장치다. 뜻까지 보지는 못하므로 경고만 하고 판단은 사용자가 한다.

// 전각 숫자를 반각으로, "1,200"을 "1200"으로
const normalize = (text: string) =>
  text
    .normalize("NFKC")
    .replace(/(\d),(?=\d{3}(\D|$))/g, "$1")
    // 날짜 표기(2023.03, 2023-03-15, 2023/3)는 소수가 아니라 연도와 월로 본다
    // 연도(19xx, 20xx)와 월(1~12)일 때만 날짜로 본다. "1200.50만원" 같은 소수는 그대로 둔다
    .replace(/(?<![\d.])((?:19|20)\d{2})[./-](0?[1-9]|1[0-2])(?:[./-](\d{1,2}))?(?!\d)/g, "$1 $2 $3");

// "03" → "3", "4.50" → "4.5"
const canonical = (token: string) => String(Number(token));

export function numbersIn(text: string | null): string[] {
  if (!text) return [];
  return (normalize(text).match(/\d+(?:\.\d+)?/g) ?? []).map(canonical);
}

const TEXT_FIELDS = ["name", "organization", "role", "situation", "actions", "result", "notDone", "evidenceNote"] as const;

export function ungroundedNumbers(
  draft: ExperienceInput,
  sources: string[],
): Partial<Record<keyof ExperienceInput, string[]>> {
  const known = new Set(sources.flatMap(numbersIn));
  const missing = (texts: (string | null)[]) => [...new Set(texts.flatMap(numbersIn).filter((n) => !known.has(n)))];

  const found: Partial<Record<keyof ExperienceInput, string[]>> = {};
  const check = (field: keyof ExperienceInput, texts: (string | null)[]) => {
    const numbers = missing(texts);
    if (numbers.length > 0) found[field] = numbers;
  };

  for (const field of TEXT_FIELDS) check(field, [draft[field]]);
  check("metrics", draft.metrics.flatMap((metric) => [metric.text, metric.basis]));
  // 기간은 "2023-03"을 연도와 월로 나눠서 본다
  check("startMonth", [draft.startMonth?.replace("-", " ") ?? null]);
  check("endMonth", [draft.endMonth?.replace("-", " ") ?? null]);
  return found;
}

const SCENE_TEXT_FIELDS = ["title", "situation", "judgment", "actions", "result", "lessons", "notDone", "evidenceNote"] as const;
type SceneLike = Pick<SceneInput, (typeof SCENE_TEXT_FIELDS)[number] | "metrics" | "startMonth" | "endMonth">;

// 장면 초안에 대해 같은 일을 한다
export function ungroundedSceneNumbers(draft: SceneLike, sources: string[]): Partial<Record<keyof SceneInput, string[]>> {
  const known = new Set(sources.flatMap(numbersIn));
  const found: Partial<Record<keyof SceneInput, string[]>> = {};
  const check = (field: keyof SceneInput, texts: (string | null)[]) => {
    const numbers = [...new Set(texts.flatMap(numbersIn).filter((n) => !known.has(n)))];
    if (numbers.length > 0) found[field] = numbers;
  };
  for (const field of SCENE_TEXT_FIELDS) check(field, [draft[field]]);
  check("metrics", draft.metrics.flatMap((metric) => [metric.text, metric.basis]));
  check("startMonth", [draft.startMonth?.replace("-", " ") ?? null]);
  check("endMonth", [draft.endMonth?.replace("-", " ") ?? null]);
  return found;
}
