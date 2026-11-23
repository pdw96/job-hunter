import { z } from "zod";
import type { Db } from "@/db/types";
import { type AiClient, type AiFailure, runAi } from "@/modules/ai/client";
import { listWritingSources, type WritingSource } from "@/modules/experiences/sources";
import { getPosting } from "@/modules/postings/repo";
import { type Answer, listAnswersByIds } from "./answers-repo";
import { needsAnswers } from "./kinds";
import { ANSWER_TOPIC_LABELS, APPLICATION_LIMITS, type QuestionKind, QUESTION_KIND_LABELS } from "./options";
import { REVISE_SYSTEM, WRITE_SYSTEM } from "./prompts";
import { approveSelection, createDraft, getQuestion, replaceDraft, saveDraft } from "./repo";
import { describeSource, postingTextOf } from "./select";
import { editBlock, withEditLock } from "./submission-repo";
import { answerAlias, cut, resolveAlias } from "./text";
import type { Draft, Paragraph, SourceRef } from "./types";

// 승인한 경험과 지원자의 답(묻기)만으로 자소서 답을 쓰고, 문단 하나를 AI로 고치거나 직접 고친다.
// AI에게는 실제 id 대신 경험은 E1, E2, 지원자의 답은 A1, A2 같은 별명만 보내고, 문단의 별명은 코드가 실제 id로 바꾼다.
// 숫자·금지 표현은 저장 뒤 checkDraft가 표시한다(저장은 막지 않는다).

export type WriteFailure =
  | "not_found"
  | "not_apply"
  | "submitted"
  | "changed"
  | "stale"
  | "over_limit"
  | "too_many_selected"
  | "need_answers"
  | AiFailure;
export type RevisePreset = "shorter" | "concrete" | "natural";

const paragraphSchema = z.object({ text: z.string(), sources: z.array(z.string()) });
const writeSchema = z.object({ paragraphs: z.array(paragraphSchema), shortage: z.string() });

export type WriteInput = {
  prompt: string;
  charLimit: number | null;
  countSpaces: boolean;
  postingText: string;
  sources: WritingSource[]; // 승인한 경험
  kinds: QuestionKind[];
  answers: Answer[]; // 문항에 붙인 지원자의 답. 이력 사실(학력·자격)은 보내지 않는다
};

const PRESET_TEXT: Record<RevisePreset, string> = {
  shorter: "더 짧게",
  concrete: "더 구체적으로(기록에 있는 내용 안에서)",
  natural: "더 자연스럽게",
};

function limitText(charLimit: number | null, countSpaces: boolean): string {
  return charLimit === null ? "제한 없음" : `${charLimit}자 이내(${countSpaces ? "공백 포함" : "공백 제외"})`;
}

// 답의 질문 글에는 연결고리로 쓰인 교육·전공 이름이 남아 있을 수 있다(지시문이 한 줄만 쓰게 한다)
const describeAnswer = (alias: string, a: Answer) =>
  [alias, `- 주제: ${ANSWER_TOPIC_LABELS[a.topic]}`, `- 질문: ${a.question}`, `- 답: ${a.answer}`].join("\n");

const orNone = (blocks: string[]) => (blocks.length > 0 ? blocks.join("\n\n") : "없음");

function buildBase(input: WriteInput): [string, string][] {
  return [
    ["문항", input.prompt],
    ["문항 유형", input.kinds.map((kind) => QUESTION_KIND_LABELS[kind]).join(", ")],
    ["글자 수", limitText(input.charLimit, input.countSpaces)],
    ["공고", input.postingText],
    ["경험 기록", orNone(input.sources.map((s, i) => describeSource(`E${i + 1}`, s, true)))],
    ["내 답", orNone(input.answers.map((a, i) => describeAnswer(`A${i + 1}`, a)))],
  ];
}

const render = (sections: [string, string][]) => sections.map(([label, value]) => `[${label}]\n${value}`).join("\n\n");

// AI가 준 문단을 검사한다. A 별명은 보낸 답의 id로, 그 밖의 별명은 승인 경험의 id로 바꾸고,
// 없는 별명은 버리고(같은 별명은 한 번), 글은 다듬고 2000자로 자른다.
// 근거가 없는 문단은 남긴다(checkDraft가 "근거 없음"으로 표시한다)
function cleanParagraph(
  text: string,
  aliases: string[],
  sources: WritingSource[],
  answers: Answer[],
): { text: string; sources: string[]; answers: string[] } {
  const ids = new Set<string>();
  const answerIds = new Set<string>();
  for (const alias of aliases) {
    const n = answerAlias(alias);
    const answer = n === null ? undefined : answers[n - 1];
    if (answer) {
      answerIds.add(answer.id);
      continue;
    }
    const s = resolveAlias(alias, sources);
    if (s) ids.add(s.id);
  }
  return { text: cut(text.trim(), APPLICATION_LIMITS.paragraph), sources: [...ids], answers: [...answerIds] };
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
    .map((p) => cleanParagraph(p.text, p.sources, input.sources, input.answers))
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
// 지원자의 답은 서버가 문항에 붙인 답(answerIds)에서 읽는다(지금 없는 답은 빼고 쓴다).
// 규칙: 유형에 동기포부형·자기소개형이 있는데 답이 없으면 need_answers이고 AI를 부르지 않는다.
// 고르기 결과가 없으면, 보낸 경험이 없고 유형에 경험형이 없을 때만 답만으로 쓴다(승인 없음). 아니면 changed.
// 보낸 id 중 이미 승인한 경험이 지금 목록에 없거나(확인 풀림, 요약만·제외) 버전이 다르면 stale이고 AI를 부르지 않는다.
// 이미 승인한 경험을 빼고 다른 묶음을 보내면 새 승인이다(지금 버전으로 다시 승인한다). 경험도 답도 없으면 none_selected
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

  const kinds: QuestionKind[] = question.kinds ?? ["experience"]; // 유형을 정하기 전의 옛 문항은 경험형으로 본다
  const answers = await listAnswersByIds(db, userId, question.answerIds);
  if (needsAnswers(kinds) && answers.length === 0) return { ok: false, reason: "need_answers" };

  const requested = [...new Set(experienceIds)];
  const selection = question.selection;
  let sources: WritingSource[] = [];
  let approved: SourceRef[] | null = null; // null: 고르기 없이 답만으로 쓴다
  if (!selection) {
    if (requested.length > 0 || kinds.includes("experience")) return { ok: false, reason: "changed" };
  } else {
    const listed = await listWritingSources(db, userId, posting.trackId);
    const byId = new Map(listed.map((s) => [s.id, s]));

    const stale = (selection.approved ?? []).some((ref) => {
      if (!requested.includes(ref.experienceId)) return false;
      const current = byId.get(ref.experienceId);
      return !current || current.contentVersion !== ref.contentVersion;
    });
    if (stale) return { ok: false, reason: "stale" };

    sources = requested.flatMap((id) => byId.get(id) ?? []);
    if (sources.length === 0 && answers.length === 0) return { ok: false, reason: "none_selected" };
    if (sources.length > APPLICATION_LIMITS.approved) return { ok: false, reason: "too_many_selected" };
    approved = sources.map((s) => ({ experienceId: s.id, contentVersion: s.contentVersion }));

    if (!selection.approved || !sameRefs(selection.approved, approved)) {
      const done = await approveSelection(db, userId, questionId, approved, selection, now);
      if (!done.ok) return done;
    }
  }

  const written = await writeText(
    db,
    ai,
    userId,
    {
      prompt: question.prompt,
      charLimit: question.charLimit,
      countSpaces: question.countSpaces,
      postingText: postingTextOf(posting),
      sources,
      kinds,
      answers,
    },
    now,
  );
  if (!written.ok) return written;
  // 읽었을 때의 문항 글, 승인, 붙인 답, 쓴 답 그대로일 때만 저장한다(그사이 고쳤거나 다시 골랐거나 답을 붙이거나 뗐거나 직접 고쳤으면 changed).
  // AI가 쓰는 사이 제출했으면 저장하지 않는다: 확인과 저장을 공고 잠금 안에서 한다
  const draft: Draft = {
    questionVersion: question.version,
    basedOn: approved ?? [],
    ...written.value,
    answers: answers.map((a) => a.id),
    writtenAt: now.toISOString(),
  };
  const saved = await withEditLock(db, userId, posting.id, (tx) =>
    saveDraft(tx, userId, questionId, draft, { version: question.version, approved, answerIds: question.answerIds, draft: question.draft }),
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

  // 근거로 삼은 경험이 하나라도 없어졌거나 버전이 다르면, 쓸 때 보낸 답이 하나라도 없어졌으면 막는다(답은 고치지 않으므로 버전이 없다)
  const listed = await listWritingSources(db, userId, posting.trackId);
  const byId = new Map(listed.map((s) => [s.id, s]));
  const sources: WritingSource[] = [];
  for (const ref of stored.basedOn) {
    const current = byId.get(ref.experienceId);
    if (!current || current.contentVersion !== ref.contentVersion) return { ok: false, reason: "stale" };
    sources.push(current);
  }
  const sentIds = stored.answers ?? [];
  const answers = await listAnswersByIds(db, userId, sentIds);
  if (answers.length !== sentIds.length) return { ok: false, reason: "stale" };

  const requestText = [request.preset ? PRESET_TEXT[request.preset] : "", note].filter(Boolean).join("\n");
  const sections = buildBase({
    prompt: question.prompt,
    charLimit: question.charLimit,
    countSpaces: question.countSpaces,
    postingText: postingTextOf(posting),
    sources,
    kinds: question.kinds ?? ["experience"],
    answers,
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

  const cleaned = cleanParagraph(result.value.text, result.value.sources, sources, answers);
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
