import { z } from "zod";
import type { Db } from "@/db/types";
import { type AiClient, type AiFailure, runAi } from "@/modules/ai/client";
import { listWritingSources, type WritingSource } from "@/modules/experiences/sources";
import { getPosting } from "@/modules/postings/repo";
import { APPLICATION_LIMITS } from "./options";
import { REVISE_SYSTEM, WRITE_SYSTEM } from "./prompts";
import { approveSelection, createDraft, getQuestion, replaceDraft, saveDraft } from "./repo";
import { describeSource, postingTextOf } from "./select";
import { editBlock, withEditLock } from "./submission-repo";
import { cut, resolveAlias } from "./text";
import type { Draft, Paragraph, SourceRef } from "./types";

// 승인한 경험만으로 답을 쓰고, 문단 하나를 AI로 고치거나 직접 고친다.
// AI에게는 경험의 실제 id 대신 E1, E2 같은 별명만 보내고, 답의 별명은 코드가 실제 id로 바꾼다.
// 숫자·금지 표현은 저장 뒤 checkDraft가 표시한다(저장은 막지 않는다).

export type WriteFailure = "not_found" | "not_apply" | "submitted" | "changed" | "stale" | "over_limit" | "too_many_selected" | AiFailure;
export type RevisePreset = "shorter" | "concrete" | "natural";

const paragraphSchema = z.object({ text: z.string(), sources: z.array(z.string()) });
const writeSchema = z.object({ paragraphs: z.array(paragraphSchema), shortage: z.string() });

export type WriteInput = {
  prompt: string;
  charLimit: number | null;
  countSpaces: boolean;
  postingText: string;
  sources: WritingSource[]; // 승인한 경험
};

const PRESET_TEXT: Record<RevisePreset, string> = {
  shorter: "더 짧게",
  concrete: "더 구체적으로(기록에 있는 내용 안에서)",
  natural: "더 자연스럽게",
};

function limitText(charLimit: number | null, countSpaces: boolean): string {
  return charLimit === null ? "제한 없음" : `${charLimit}자 이내(${countSpaces ? "공백 포함" : "공백 제외"})`;
}

function buildBase(input: WriteInput): [string, string][] {
  return [
    ["문항", input.prompt],
    ["글자 수", limitText(input.charLimit, input.countSpaces)],
    ["공고", input.postingText],
    ["경험 기록", input.sources.map((s, i) => describeSource(`E${i + 1}`, s, true)).join("\n\n")],
  ];
}

const render = (sections: [string, string][]) => sections.map(([label, value]) => `[${label}]\n${value}`).join("\n\n");

// AI가 준 문단을 검사한다. 승인 경험에 없는 별명은 버리고(같은 별명은 한 번), 글은 다듬고 2000자로 자른다.
// 근거가 없는 문단은 남긴다(checkDraft가 "근거 없음"으로 표시한다)
function cleanParagraph(text: string, aliases: string[], sources: WritingSource[]): { text: string; sources: string[] } {
  const ids = new Set<string>();
  for (const alias of aliases) {
    const s = resolveAlias(alias, sources);
    if (s) ids.add(s.id);
  }
  return { text: cut(text.trim(), APPLICATION_LIMITS.paragraph), sources: [...ids] };
}

// 저장하지 않는다. 프롬프트 점검도 이것을 쓴다
export async function writeText(
  db: Db,
  ai: AiClient,
  userId: string,
  input: WriteInput,
  now: Date = new Date(),
): Promise<{ ok: true; value: Pick<Draft, "paragraphs" | "shortage"> } | { ok: false; reason: "over_limit" | AiFailure }> {
  const result = await runAi(
    db,
    ai,
    userId,
    {
      purpose: "application_write",
      system: WRITE_SYSTEM,
      messages: [{ role: "user", text: render(buildBase(input)) }],
      schema: writeSchema,
      effort: "medium",
      maxTokens: 16000,
    },
    now,
  );
  if (!result.ok) return { ok: false, reason: result.reason };

  const paragraphs: Paragraph[] = result.value.paragraphs
    .map((p) => cleanParagraph(p.text, p.sources, input.sources))
    .filter((p) => p.text !== "")
    .slice(0, APPLICATION_LIMITS.paragraphs)
    .map((p) => ({ ...p, edited: false }));
  if (paragraphs.length === 0) return { ok: false, reason: "invalid" };
  return { ok: true, value: { paragraphs, shortage: cut(result.value.shortage.trim(), APPLICATION_LIMITS.shortage) } };
}

const sameRef = (a: SourceRef, b: SourceRef) => a.experienceId === b.experienceId && a.contentVersion === b.contentVersion;
const sameRefs = (a: SourceRef[], b: SourceRef[]) => a.length === b.length && a.every((ref, i) => sameRef(ref, b[i]));

// 키 순서와 상관없는 JSON 비교(DB의 jsonb는 키 순서를 바꿔 돌려준다)
function canon(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canon).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([k, v]) => `${JSON.stringify(k)}:${canon(v)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
const sameJson = (a: unknown, b: unknown) => canon(a) === canon(b);

// 고른 경험을 승인하고 곧바로 쓴다. experienceIds는 화면이 보낸 것이므로 지금의 WritingSource에 있는 것만 받는다.
// 규칙: 보낸 id 중 이미 승인한 경험이 지금 목록에 없거나(확인 풀림, 요약만·제외) 버전이 다르면 stale이고 AI를 부르지 않는다.
// 이미 승인한 경험을 빼고 다른 묶음을 보내면 새 승인이다(지금 버전으로 다시 승인한다)
export async function approveAndWrite(
  db: Db,
  ai: AiClient,
  userId: string,
  questionId: string,
  experienceIds: string[],
  now: Date = new Date(),
): Promise<{ ok: true; value: Draft } | { ok: false; reason: WriteFailure | "none_selected" }> {
  const question = await getQuestion(db, userId, questionId);
  if (!question) return { ok: false, reason: "not_found" };
  const posting = await getPosting(db, userId, question.postingId);
  if (!posting) return { ok: false, reason: "not_found" };
  const block = await editBlock(db, userId, posting);
  if (block) return { ok: false, reason: block };
  const selection = question.selection;
  if (!selection) return { ok: false, reason: "changed" };

  const listed = await listWritingSources(db, userId, posting.trackId);
  const byId = new Map(listed.map((s) => [s.id, s]));
  const requested = [...new Set(experienceIds)];

  const stale = (selection.approved ?? []).some((ref) => {
    if (!requested.includes(ref.experienceId)) return false;
    const current = byId.get(ref.experienceId);
    return !current || current.contentVersion !== ref.contentVersion;
  });
  if (stale) return { ok: false, reason: "stale" };

  const sources = requested.flatMap((id) => byId.get(id) ?? []);
  if (sources.length === 0) return { ok: false, reason: "none_selected" };
  if (sources.length > APPLICATION_LIMITS.approved) return { ok: false, reason: "too_many_selected" };
  const approved: SourceRef[] = sources.map((s) => ({ experienceId: s.id, contentVersion: s.contentVersion }));

  if (!selection.approved || !sameRefs(selection.approved, approved)) {
    const done = await approveSelection(db, userId, questionId, approved, selection, now);
    if (!done.ok) return done;
  }

  const written = await writeText(
    db,
    ai,
    userId,
    { prompt: question.prompt, charLimit: question.charLimit, countSpaces: question.countSpaces, postingText: postingTextOf(posting), sources },
    now,
  );
  if (!written.ok) return written;
  // 읽었을 때의 문항 글, 승인, 답 그대로일 때만 저장한다(그사이 고쳤거나 다시 골랐거나 직접 고쳤으면 changed).
  // AI가 쓰는 사이 제출했으면 저장하지 않는다: 확인과 저장을 공고 잠금 안에서 한다
  const draft: Draft = { questionVersion: question.version, basedOn: approved, ...written.value, writtenAt: now.toISOString() };
  const saved = await withEditLock(db, userId, posting.id, (tx) =>
    saveDraft(tx, userId, questionId, draft, { version: question.version, approved, draft: question.draft }),
  );
  return saved.ok ? { ok: true, value: draft } : saved;
}

export async function reviseParagraph(
  db: Db,
  ai: AiClient,
  userId: string,
  questionId: string,
  index: number,
  request: { preset: RevisePreset | null; note: string },
  expected: Draft,
  now: Date = new Date(),
): Promise<{ ok: true; value: Draft } | { ok: false; reason: WriteFailure | "empty_request" }> {
  const note = cut(request.note.trim(), APPLICATION_LIMITS.note);
  if (!request.preset && note === "") return { ok: false, reason: "empty_request" };

  const question = await getQuestion(db, userId, questionId);
  if (!question) return { ok: false, reason: "not_found" };
  const posting = await getPosting(db, userId, question.postingId);
  if (!posting) return { ok: false, reason: "not_found" };
  const block = await editBlock(db, userId, posting);
  if (block) return { ok: false, reason: block };

  // 저장된 답이 화면이 읽은 것과 같을 때만 고친다. 고친 답은 저장된 것에서 만든다
  const stored = question.draft;
  if (!stored || !sameJson(stored, expected) || !Number.isInteger(index) || index < 0 || index >= stored.paragraphs.length) {
    return { ok: false, reason: "changed" };
  }

  // 근거로 삼은 경험이 하나라도 없어졌거나 버전이 다르면 막는다
  const listed = await listWritingSources(db, userId, posting.trackId);
  const byId = new Map(listed.map((s) => [s.id, s]));
  const sources: WritingSource[] = [];
  for (const ref of stored.basedOn) {
    const current = byId.get(ref.experienceId);
    if (!current || current.contentVersion !== ref.contentVersion) return { ok: false, reason: "stale" };
    sources.push(current);
  }

  const requestText = [request.preset ? PRESET_TEXT[request.preset] : "", note].filter(Boolean).join("\n");
  const sections = buildBase({
    prompt: question.prompt,
    charLimit: question.charLimit,
    countSpaces: question.countSpaces,
    postingText: postingTextOf(posting),
    sources,
  });
  sections.push(
    ["지금 답", stored.paragraphs.map((p) => p.text).join("\n")],
    ["고칠 문단", stored.paragraphs[index].text],
    ["요청", requestText],
  );
  const result = await runAi(
    db,
    ai,
    userId,
    {
      purpose: "application_revise",
      system: REVISE_SYSTEM,
      messages: [{ role: "user", text: render(sections) }],
      schema: paragraphSchema,
      effort: "low",
      maxTokens: 8000,
    },
    now,
  );
  if (!result.ok) return { ok: false, reason: result.reason };

  const cleaned = cleanParagraph(result.value.text, result.value.sources, sources);
  if (cleaned.text === "") return { ok: false, reason: "invalid" };
  const next: Draft = {
    ...stored,
    paragraphs: stored.paragraphs.map((p, i) => (i === index ? { ...cleaned, edited: false } : p)),
  };
  const saved = await withEditLock(db, userId, posting.id, (tx) => replaceDraft(tx, userId, questionId, expected, next));
  return saved.ok ? { ok: true, value: next } : saved;
}

// 직접 고친 문단은 edited가 되고(sources는 남긴다), 글이 비면 그 문단을 지운다. 지원이 아닌 공고의 답은 읽기만 한다
export async function editParagraph(
  db: Db,
  userId: string,
  questionId: string,
  index: number,
  text: string,
  expected: Draft,
  now: Date = new Date(),
): Promise<{ ok: true; value: Draft } | { ok: false; reason: "not_found" | "not_apply" | "submitted" | "changed" | "too_long" }> {
  void now; // 다른 함수와 서명을 맞추려고 남겨 둔다(저장 시각은 replaceDraft가 정한다)
  const trimmed = text.trim();
  if ([...trimmed].length > APPLICATION_LIMITS.paragraph) return { ok: false, reason: "too_long" };

  const question = await getQuestion(db, userId, questionId);
  if (!question) return { ok: false, reason: "not_found" };
  const posting = await getPosting(db, userId, question.postingId);
  if (!posting) return { ok: false, reason: "not_found" };
  const block = await editBlock(db, userId, posting);
  if (block) return { ok: false, reason: block };
  const stored = question.draft;
  if (!stored || !sameJson(stored, expected) || !Number.isInteger(index) || index < 0 || index >= stored.paragraphs.length) {
    return { ok: false, reason: "changed" };
  }

  const paragraphs =
    trimmed === ""
      ? stored.paragraphs.filter((_, i) => i !== index)
      : stored.paragraphs.map((p, i) => (i === index ? { ...p, text: trimmed, edited: true } : p));
  const next: Draft = { ...stored, paragraphs };
  const saved = await withEditLock(db, userId, posting.id, (tx) => replaceDraft(tx, userId, questionId, expected, next));
  return saved.ok ? { ok: true, value: next } : saved;
}

// AI 없이 직접 쓴 답을 처음 저장한다(AI 한도와 상관없다). 빈 줄로 문단을 나누고 모든 문단은 직접 쓴 것(edited)이다.
// 이미 답이 있으면 덮어쓰지 않고 changed
export async function writeManually(
  db: Db,
  userId: string,
  questionId: string,
  text: string,
  now: Date = new Date(),
): Promise<{ ok: true; value: Draft } | { ok: false; reason: "not_found" | "not_apply" | "submitted" | "changed" | "empty" | "too_long" }> {
  const parts = text
    .trim()
    .split(/\n[^\S\n]*\n\s*/u)
    .map((part) => part.trim())
    .filter((part) => part !== "");
  if (parts.length === 0) return { ok: false, reason: "empty" };
  if (parts.length > APPLICATION_LIMITS.paragraphs || parts.some((part) => [...part].length > APPLICATION_LIMITS.paragraph)) {
    return { ok: false, reason: "too_long" };
  }

  const question = await getQuestion(db, userId, questionId);
  if (!question) return { ok: false, reason: "not_found" };
  const posting = await getPosting(db, userId, question.postingId);
  if (!posting) return { ok: false, reason: "not_found" };
  const block = await editBlock(db, userId, posting);
  if (block) return { ok: false, reason: block };

  const draft: Draft = {
    questionVersion: question.version,
    basedOn: question.selection?.approved ?? [],
    paragraphs: parts.map((part) => ({ text: part, sources: [], edited: true })),
    shortage: "",
    writtenAt: now.toISOString(),
  };
  const saved = await withEditLock(db, userId, posting.id, (tx) => createDraft(tx, userId, questionId, draft));
  return saved.ok ? { ok: true, value: draft } : saved;
}
