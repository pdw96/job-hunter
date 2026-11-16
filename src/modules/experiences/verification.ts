import { type Kind, RUBRIC_ITEMS, type RubricItem } from "./options";

// 경험 기록의 검증 규칙. 화면과 DB를 모르는 순수 함수만 둔다.
// "지원서에는 확인됨만 쓴다"의 기준이 여기서 정해진다.

// unjudged 아직 판정 안 함 / met 충족 / unmet 미달 / closed 사용자가 해당 없음으로 닫음 / na 구분상 적용 안 함
export type ItemStatus = "unjudged" | "met" | "unmet" | "closed" | "na";
export type Rubric = Record<RubricItem, ItemStatus>;
export type VerificationState = "unconfirmed" | "partial" | "confirmed";

// 본인 역할·수준을 따지지 않는 구분
const PERIOD_ONLY: readonly Kind[] = ["school", "certificate", "gap"];
// 사용자가 "해당 없음"으로 닫을 수 있는 항목
const CLOSABLE: readonly RubricItem[] = ["metrics", "evidence"];

export function requiredItems(kind: Kind): RubricItem[] {
  return PERIOD_ONLY.includes(kind) ? ["period"] : ["period", "role", "level"];
}

export function appliesTo(kind: Kind, item: RubricItem): boolean {
  return !(PERIOD_ONLY.includes(kind) && (item === "role" || item === "level"));
}

export function canClose(kind: Kind, item: RubricItem): boolean {
  return CLOSABLE.includes(item) && appliesTo(kind, item);
}

const isMonth = (value: string | null): value is string => value !== null && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);

// 기간은 코드가 판정한다. 월은 YYYY-MM
export function judgePeriod(
  kind: Kind,
  startMonth: string | null,
  endMonth: string | null,
  isOngoing: boolean,
): "met" | "unmet" {
  if (!isMonth(startMonth)) return "unmet";
  if (kind === "certificate") return "met"; // 취득 월 하나로 충족
  if (isOngoing) return "met";
  return isMonth(endMonth) && endMonth >= startMonth ? "met" : "unmet";
}

export function initialRubric(kind: Kind, period: "met" | "unmet"): Rubric {
  return Object.fromEntries(
    RUBRIC_ITEMS.map((item) => [item, item === "period" ? period : appliesTo(kind, item) ? "unjudged" : "na"]),
  ) as Rubric;
}

export function verificationState(kind: Kind, rubric: Rubric, isConfirmed: boolean): VerificationState {
  if (!isConfirmed) return "unconfirmed";
  return requiredItems(kind).every((item) => rubric[item] === "met") ? "confirmed" : "partial";
}

// 내용이 바뀌었으면 다시 판정해야 한다. 닫아 둔 항목만 유지한다
export function rubricAfterContentEdit(kind: Kind, rubric: Rubric, period: "met" | "unmet"): Rubric {
  const fresh = initialRubric(kind, period);
  for (const item of CLOSABLE) {
    if (rubric[item] === "closed" && canClose(kind, item)) fresh[item] = "closed";
  }
  return fresh;
}

export function usableInApplications(state: VerificationState): boolean {
  return state === "confirmed";
}
