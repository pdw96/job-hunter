import type { ExperienceInput } from "./input";

// 가져온 기록의 "주장" 규칙. 화면과 DB를 모르는 순수 함수만 둔다.
// 가져온 자료는 AI가 쓴 것일 수 있어, 내용을 사실이 아니라 확인이 필요한 주장으로 다룬다.

export type ClaimKind = "period" | "metric" | "role";
// pending 아직 답하지 않음 / confirmed 맞음 / needs_fix 고쳐야 함 / fixed 고쳐서 닫힘 / removed 지워서 닫힘
export type ClaimStatus = "pending" | "confirmed" | "needs_fix" | "fixed" | "removed";
export type ClaimOrigin = "code" | "ai";

// phrase는 "과장임"을 눌렀을 때 금지 표현에 넣을 글
export type FoundClaim = { kind: ClaimKind; quote: string; phrase: string | null; origin: ClaimOrigin };
export type Claim = FoundClaim & { id: string; status: ClaimStatus };

export const MAX_CLAIMS = 30;
const MAX_QUOTE = 200;

// 실제보다 역할이 크게 들리기 쉬운 낱말
const INFLATING = ["주도", "총괄", "리드", "리딩", "단독", "전담", "책임", "이끌", "혼자", "주관", "진두지휘"];

const PROSE_FIELDS = ["situation", "actions", "result"] as const;

// 문장이나 줄 단위로 나눈다. 글머리 기호는 뗀다
export function sentences(text: string | null): string[] {
  if (!text) return [];
  return text
    .split(/\n|(?<=[.!?])\s+/)
    .map((part) => part.replace(/^\s*(?:[-•·*▪◦]|\d+[.)])\s+/, "").trim())
    .filter((part) => part !== "")
    .flatMap(quotePieces);
}

// 긴 문장은 잘라 버리지 않고 여러 조각으로 나눠, 뒤쪽의 숫자와 낱말도 빠지지 않게 한다. 되도록 띄어쓰기에서 나눈다
export function quotePieces(sentence: string): string[] {
  const parts: string[] = [];
  let rest = sentence;
  while (rest.length > MAX_QUOTE) {
    const space = rest.lastIndexOf(" ", MAX_QUOTE);
    const cut = space > 0 ? space : MAX_QUOTE;
    parts.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest !== "") parts.push(rest);
  return parts;
}

// 날짜 표기를 뺀 뒤에도 숫자가 남아 있는가
function hasNumber(sentence: string): boolean {
  const withoutDates = sentence
    // 연도(19xx, 20xx)와 월(1~12)일 때만 날짜로 본다. "1200.50만원" 같은 소수는 숫자로 남긴다
    .replace(/(?<![\d.])(?:19|20)\d{2}\s*[-./]\s*(?:0?[1-9]|1[0-2])(?:\s*[-./]\s*\d{1,2})?(?!\d)/g, " ")
    .replace(/\d{2,4}\s*년(?:\s*\d{1,2}\s*월)?(?:\s*\d{1,2}\s*일)?/g, " ")
    .replace(/\d{1,2}\s*월(?:\s*\d{1,2}\s*일)?/g, " ");
  return /\d/.test(withoutDates);
}

function periodQuote(input: ExperienceInput): string | null {
  if (!input.startMonth) return null;
  if (input.kind === "certificate") return `${input.startMonth} 취득`;
  if (input.isOngoing) return `${input.startMonth} ~ 진행 중`;
  return `${input.startMonth} ~ ${input.endMonth ?? "?"}`;
}

const sameClaim = (a: { kind: ClaimKind; quote: string }, b: { kind: ClaimKind; quote: string }) =>
  a.kind === b.kind && a.quote === b.quote;

// 코드가 찾는 주장: 기간, 수치(수치 칸과 본문의 숫자), 과장되기 쉬운 낱말
export function findClaims(input: ExperienceInput): FoundClaim[] {
  const found: FoundClaim[] = [];
  const add = (claim: FoundClaim) => {
    if (!found.some((existing) => sameClaim(existing, claim))) found.push(claim);
  };

  const period = periodQuote(input);
  if (period) add({ kind: "period", quote: period, phrase: null, origin: "code" });

  for (const metric of input.metrics) {
    // 수치 줄은 숫자가 없어도 묻는다. 긴 줄은 조각으로 나눠, 첫 조각과 숫자가 든 조각을 묻는다
    quotePieces(metric.text).forEach((piece, index) => {
      if (index === 0 || hasNumber(piece)) add({ kind: "metric", quote: piece, phrase: null, origin: "code" });
    });
  }
  for (const field of PROSE_FIELDS) {
    for (const sentence of sentences(input[field])) {
      if (hasNumber(sentence)) add({ kind: "metric", quote: sentence, phrase: null, origin: "code" });
    }
  }
  for (const field of PROSE_FIELDS) {
    for (const sentence of sentences(input[field])) {
      const word = INFLATING.find((candidate) => sentence.includes(candidate));
      if (word) add({ kind: "role", quote: sentence, phrase: word, origin: "code" });
    }
  }
  return found;
}

const squash = (text: string) => text.replace(/\s+/g, " ").trim();

// 구절이 남아 있는지 볼 때 살피는 칸
export type ClaimTexts = Pick<
  ExperienceInput,
  "name" | "organization" | "role" | "situation" | "actions" | "result" | "metrics" | "notDone" | "evidenceNote"
>;
// 주장으로 훑지는 않지만, 가져올 때 원본에 없던 숫자가 있으면 주장이 될 수 있는 칸
export const OTHER_FIELDS = ["name", "organization", "role", "notDone", "evidenceNote"] as const;

export function proseContains(input: ClaimTexts, quote: string): boolean {
  const needle = squash(quote);
  const texts = [
    ...PROSE_FIELDS.map((field) => input[field]),
    ...OTHER_FIELDS.map((field) => input[field]),
    ...input.metrics.map((metric) => metric.text),
  ];
  return texts.some((text) => text !== null && squash(text).includes(needle));
}

// AI가 짚은 구절을 더한다. 본문에 실제로 있는 구절만 받고, 이미 있는 것과 겹치면 넣지 않는다
export function mergeClaims(code: FoundClaim[], aiQuotes: string[], input: ExperienceInput): FoundClaim[] {
  const merged = [...code];
  for (const raw of aiQuotes) {
    const quote = raw.trim().slice(0, MAX_QUOTE);
    if (quote === "" || !proseContains(input, quote)) continue;
    if (merged.some((claim) => claim.kind === "role" && claim.quote === quote)) continue;
    merged.push({ kind: "role", quote, phrase: quote.slice(0, 100), origin: "ai" });
  }
  return merged.slice(0, MAX_CLAIMS);
}

// 그 구절(기간이면 그 기간)이 기록에 아직 있는가
export function stillPresent(claim: { kind: ClaimKind; quote: string }, input: ExperienceInput): boolean {
  return claim.kind === "period" ? periodQuote(input) === claim.quote : proseContains(input, claim.quote);
}

export function blocksConfirmation(claims: { status: ClaimStatus }[]): boolean {
  return claims.some((claim) => claim.status === "pending" || claim.status === "needs_fix");
}

// 기록을 고친 뒤 주장을 어떻게 바꿀지 정한다
export function claimsAfterEdit(
  existing: Claim[],
  input: ExperienceInput,
): { updates: { id: string; status: ClaimStatus }[]; deletes: string[]; adds: FoundClaim[] } {
  const updates: { id: string; status: ClaimStatus }[] = [];
  const deletes: string[] = [];

  for (const claim of existing) {
    const present = stillPresent(claim, input);
    if (claim.status === "needs_fix" && !present) updates.push({ id: claim.id, status: "fixed" });
    // 고쳐서 닫았던 구절을 다시 써 넣었으면 다시 물어본다
    else if ((claim.status === "fixed" || claim.status === "removed") && present) {
      updates.push({ id: claim.id, status: "pending" });
    }
    // 답하기 전이거나 맞다고 한 구절이 사라졌으면 주장도 없앤다
    else if ((claim.status === "pending" || claim.status === "confirmed") && !present) deletes.push(claim.id);
  }

  // 고쳐서 닫힌 옛 주장(fixed, removed)은 자리를 차지하지 않는다. 자리가 모자라면 오래된 것부터 지운다
  const statusAfter = (claim: Claim) => updates.find((update) => update.id === claim.id)?.status ?? claim.status;
  const kept = existing.filter((claim) => !deletes.includes(claim.id));
  const closed = kept.filter((claim) => ["fixed", "removed"].includes(statusAfter(claim)));
  const room = Math.max(0, MAX_CLAIMS - (kept.length - closed.length));
  const adds = findClaims(input)
    .filter((found) => !existing.some((claim) => sameClaim(claim, found)))
    .slice(0, room);
  const overflow = kept.length + adds.length - MAX_CLAIMS;
  if (overflow > 0) deletes.push(...closed.slice(0, overflow).map((claim) => claim.id));
  const gone = new Set(deletes);
  return { updates: updates.filter((update) => !gone.has(update.id)), deletes, adds };
}
