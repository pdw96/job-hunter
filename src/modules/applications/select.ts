import { z } from "zod";
import type { Db } from "@/db/types";
import { type AiClient, type AiFailure, runAi } from "@/modules/ai/client";
import { numbersIn } from "@/modules/experiences/grounding";
import { KIND_LABELS } from "@/modules/experiences/options";
import { listWritingSources, type WritingSource } from "@/modules/experiences/writing";
import { getPosting } from "@/modules/postings/repo";
import { APPLICATION_LIMITS } from "./options";
import { SELECT_SYSTEM } from "./prompts";
import { getQuestion, listQuestions, saveSelection } from "./repo";
import type { PassedReason, PickReason, Selection } from "./types";

// AI가 문항 하나에 쓸 경험을 고르고 그 까닭을 적는다. 글은 쓰지 않는다.
// AI에게는 경험의 실제 id 대신 E1, E2 같은 별명만 보내고, 답의 별명은 코드가 실제 id와 버전으로 바꾼다.
// 수치는 보내지 않는다(쓰기 단계에서만 보낸다). 화면의 "확인된 수치 n개"는 코드가 붙인다.

const selectSchema = z.object({
  picks: z.array(z.object({ exp: z.string(), overlap: z.string(), role: z.string() })),
  passed: z.array(z.object({ exp: z.string(), whyNot: z.string() })),
});

export type SelectInput = {
  prompt: string;
  charLimit: number | null;
  postingText: string;
  requirements: string[];
  sources: WritingSource[];
  usedElsewhere: string[]; // 다른 문항에서 승인한 경험 id
};

type SelectValue = Omit<Selection, "questionVersion">;

const orNone = (value: string | null) => (value && value.trim() !== "" ? value : "없음");

// 경험 글 한 건을 AI용으로 적는다. 수치와 기준, 하지 않은 것, 금지 표현은 withMetrics일 때만 붙인다
export function describeSource(alias: string, s: WritingSource, withMetrics: boolean): string {
  const period =
    s.kind === "certificate" ? orNone(s.startMonth) : `${s.startMonth ?? "없음"} ~ ${s.isOngoing ? "진행 중" : (s.endMonth ?? "없음")}`;
  const lines: [string, string | null][] = [
    ["이름", s.name],
    ["구분", KIND_LABELS[s.kind]],
    ["소속·기관", s.organization],
    ["직무·역할", s.role],
    ["기간", period],
    ["상황", s.situation],
    ["본인이 한 일", s.actions],
    ["결과", s.result],
  ];
  if (withMetrics) {
    if (s.metrics.length === 0) lines.push(["수치", null]);
    for (const metric of s.metrics) lines.push(["수치", `${metric.text} (기준: ${orNone(metric.basis)})`]);
    lines.push(["하지 않은 것", s.notDone]);
    lines.push(["쓰면 안 되는 표현", s.bannedPhrases.length > 0 ? s.bannedPhrases.join(", ") : null]);
  }
  return [alias, ...lines.map(([label, value]) => `- ${label}: ${orNone(value)}`)].join("\n");
}

// 공고 원문에 인재상·회사 소개를 붙인 글. 쓰기·부분 수정도 같은 글을 쓴다
export function postingTextOf(posting: { rawText: string; companyNote: string | null }): string {
  return posting.companyNote ? `${posting.rawText}\n\n${posting.companyNote}` : posting.rawText;
}

function buildMessage(input: SelectInput): string {
  const experiences = input.sources.map((s, i) => describeSource(`E${i + 1}`, s, false)).join("\n\n");
  const aliasOf = new Map(input.sources.map((s, i) => [s.id, `E${i + 1}`]));
  const elsewhere = [...new Set(input.usedElsewhere)].flatMap((id) => aliasOf.get(id) ?? []);
  const sections: [string, string][] = [
    ["문항", input.prompt],
    ["글자 수", input.charLimit === null ? "없음" : String(input.charLimit)],
    ["공고", input.postingText],
    ["공고 요구 사항", input.requirements.length > 0 ? input.requirements.join("\n") : "없음"],
    ["경험 기록", experiences],
    ["다른 문항에서 쓰기로 한 경험", elsewhere.length > 0 ? elsewhere.join(", ") : "없음"],
  ];
  return sections.map(([label, value]) => `[${label}]\n${value}`).join("\n\n");
}

// 문장의 숫자가 그 경험의 글(보낸 칸만), 문항, 공고에 있는지. 별명(E1)의 숫자는 보지 않는다
function grounded(sentence: string, s: WritingSource, known: Set<string>): boolean {
  const own = [s.name, s.organization, s.role, s.startMonth, s.endMonth, s.situation, s.actions, s.result].flatMap(numbersIn);
  const allowed = new Set([...known, ...own]);
  return numbersIn(sentence.replace(/\bE\d+\b/g, "")).every((n) => allowed.has(n));
}

// 저장하지 않는다. 프롬프트 점검도 이것을 쓴다
export async function selectText(
  db: Db,
  ai: AiClient,
  userId: string,
  input: SelectInput,
  now: Date = new Date(),
): Promise<{ ok: true; value: SelectValue } | { ok: false; reason: "over_limit" | AiFailure }> {
  const selectedAt = now.toISOString();
  const base = { approved: null, approvedAt: null, selectedAt };
  // 후보가 없으면 AI를 부르지 않는다
  if (input.sources.length === 0) return { ok: true, value: { picks: [], passed: [], noMatch: true, ...base } };

  const result = await runAi(
    db,
    ai,
    userId,
    {
      purpose: "application_select",
      system: SELECT_SYSTEM,
      messages: [{ role: "user", text: buildMessage(input) }],
      schema: selectSchema,
      effort: "medium",
      maxTokens: 8000,
    },
    now,
  );
  if (!result.ok) return { ok: false, reason: result.reason };

  // AI가 준 값도 코드가 검사한다. 없는 경험과 중복은 버리고, 지어낸 숫자가 든 문장은 비운다
  const byAlias = new Map(input.sources.map((s, i) => [`E${i + 1}`, s]));
  const known = new Set([input.prompt, input.postingText].flatMap(numbersIn));
  const clean = (text: string, s: WritingSource) => {
    const trimmed = text.trim().slice(0, APPLICATION_LIMITS.reason);
    return grounded(trimmed, s, known) ? trimmed : "";
  };

  const picks: PickReason[] = [];
  const picked = new Set<string>();
  for (const item of result.value.picks) {
    const s = byAlias.get(item.exp.trim());
    if (!s || picked.has(s.id) || picks.length >= APPLICATION_LIMITS.picks) continue;
    picked.add(s.id);
    picks.push({ experienceId: s.id, contentVersion: s.contentVersion, overlap: clean(item.overlap, s), role: clean(item.role, s) });
  }

  const passed: PassedReason[] = [];
  const seen = new Set<string>();
  for (const item of result.value.passed) {
    const s = byAlias.get(item.exp.trim());
    if (!s || picked.has(s.id) || seen.has(s.id) || passed.length >= APPLICATION_LIMITS.passed) continue;
    seen.add(s.id);
    passed.push({ experienceId: s.id, contentVersion: s.contentVersion, whyNot: clean(item.whyNot, s) });
  }

  return { ok: true, value: { picks, passed, noMatch: picks.length === 0, ...base } };
}

export async function selectForQuestion(
  db: Db,
  ai: AiClient,
  userId: string,
  questionId: string,
  now: Date = new Date(),
): Promise<
  { ok: true; value: Selection } | { ok: false; reason: "not_found" | "not_apply" | "changed" | "over_limit" | AiFailure }
> {
  const question = await getQuestion(db, userId, questionId);
  if (!question) return { ok: false, reason: "not_found" };
  const posting = await getPosting(db, userId, question.postingId);
  if (!posting) return { ok: false, reason: "not_found" };
  if (posting.status !== "apply") return { ok: false, reason: "not_apply" };

  const [sources, questions] = await Promise.all([
    listWritingSources(db, userId, posting.trackId),
    listQuestions(db, userId, question.postingId),
  ]);
  const usedElsewhere = questions
    .filter((other) => other.id !== question.id)
    .flatMap((other) => other.selection?.approved?.map((ref) => ref.experienceId) ?? []);

  const selected = await selectText(
    db,
    ai,
    userId,
    {
      prompt: question.prompt,
      charLimit: question.charLimit,
      postingText: postingTextOf(posting),
      requirements: posting.analysis?.requirements.map((r) => r.text) ?? [],
      sources,
      usedElsewhere,
    },
    now,
  );
  if (!selected.ok) return selected;

  // 읽었을 때의 문항 글 그대로일 때만 저장한다(그사이 고쳤으면 changed)
  const value: Selection = { questionVersion: question.version, ...selected.value };
  const saved = await saveSelection(db, userId, questionId, value);
  return saved.ok ? { ok: true, value } : saved;
}
