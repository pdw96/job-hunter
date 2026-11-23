import { DEFAULT_DOCUMENTS, DOCUMENT_KINDS, DOCUMENT_LABELS, type DocumentKind, POSTING_LIMITS } from "./options";

// 공고에서 찾은 제출 서류와 자소서 문항. 화면과 DB를 모르는 순수 함수

export type FoundDocument = { kind: DocumentKind; label: string }; // label은 공고에 적힌 이름
export type FoundQuestion = { prompt: string; charLimit: number | null; countSpaces: boolean };
export type Found = { documents: FoundDocument[]; questions: FoundQuestion[] };

// 공백을 빼고 소문자로 바꾼다. 띄어쓰기가 달라도 같은 글로 본다
export const squash = (text: string) => text.replace(/\s+/g, "").toLowerCase();

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

// AI 답이나 브라우저가 보낸 값을 검사한다. 목록 밖 종류·빈 글·같은 (종류, 이름)은 버리고 한도로 자른다.
// 문항은 공백을 뺀 rawText에 공백을 뺀 문항 글이 들어 있을 때만 남긴다
export function cleanFound(raw: unknown, rawText: string): Found {
  const data = isObject(raw) ? raw : {};
  const documents: FoundDocument[] = [];
  const seen = new Set<string>();
  for (const item of Array.isArray(data.documents) ? data.documents : []) {
    if (documents.length >= POSTING_LIMITS.documents) break;
    if (!isObject(item) || !DOCUMENT_KINDS.includes(item.kind as DocumentKind)) continue;
    const kind = item.kind as DocumentKind;
    const label = (typeof item.label === "string" ? item.label.trim() : "").slice(0, POSTING_LIMITS.documentLabel);
    if (label === "") continue;
    const key = `${kind}\n${label}`;
    if (seen.has(key)) continue;
    seen.add(key);
    documents.push({ kind, label });
  }

  const source = squash(rawText);
  const questions: FoundQuestion[] = [];
  for (const item of Array.isArray(data.questions) ? data.questions : []) {
    if (questions.length >= POSTING_LIMITS.questions) break;
    if (!isObject(item) || typeof item.prompt !== "string") continue;
    const prompt = item.prompt.trim().slice(0, POSTING_LIMITS.questionPrompt);
    if (prompt === "" || !source.includes(squash(prompt))) continue;
    const limit = item.charLimit;
    const charLimit =
      typeof limit === "number" && Number.isInteger(limit) && limit >= POSTING_LIMITS.charLimitMin && limit <= POSTING_LIMITS.charLimitMax ? limit : null;
    questions.push({ prompt, charLimit, countSpaces: typeof item.countSpaces === "boolean" ? item.countSpaces : true });
  }
  return { documents, questions };
}

// 이 공고에 쓸 서류의 종류(DOCUMENT_KINDS 순서). 고른 것이 먼저, 없으면 찾은 서류, 그것도 없으면 이력서·자기소개서
export function chosenDocuments(p: { foundDocuments: FoundDocument[] | null; chosenDocuments: DocumentKind[] | null }): DocumentKind[] {
  const pick = (kinds: DocumentKind[]) => DOCUMENT_KINDS.filter((kind) => kinds.includes(kind));
  if (p.chosenDocuments && p.chosenDocuments.length > 0) return pick(p.chosenDocuments);
  const found = pick((p.foundDocuments ?? []).map((d) => d.kind));
  return found.length > 0 ? found : [...DEFAULT_DOCUMENTS];
}

// 서류 고르기 화면의 줄. 기타는 공고에서 찾았거나 이미 고른 경우에만 보인다(다시 읽어 사라져도 고른 것은 끌 수 있게).
// 기타의 이름은 공고에 적힌 이름들, 없으면 "기타"
export function documentRows(found: FoundDocument[] | null, chosen: DocumentKind[]): { kind: DocumentKind; name: string }[] {
  const others = (found ?? []).filter((item) => item.kind === "other").map((item) => item.label);
  return DOCUMENT_KINDS.filter((kind) => kind !== "other" || others.length > 0 || chosen.includes("other")).map((kind) => ({
    kind,
    name: kind === "other" && others.length > 0 ? others.join(", ") : DOCUMENT_LABELS[kind],
  }));
}
