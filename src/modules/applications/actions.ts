"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { requireUser } from "@/lib/session";
import type { AiFailure } from "@/modules/ai/client";
import { ai } from "@/modules/ai/provider";
import { validateQuestion } from "./input";
import { addQuestions, deleteQuestion, getQuestion, updateQuestion } from "./repo";
import { selectForQuestion } from "./select";
import type { Draft } from "./types";
import { approveAndWrite, editParagraph, type RevisePreset, reviseParagraph } from "./write";

// 모든 액션은 requireUser()로 얻은 userId만 쓴다. 끝나면 자소서 화면을 다시 그리게 한다.
// 화면에서 받은 값(문항 글, 경험 id, expected 답)은 검사하거나 서버가 읽은 값과 비교하는 데만 쓰고 그대로 저장하지 않는다.

type Result = { ok: true } | { ok: false; message: string };

const MESSAGES = {
  not_found: "문항을 찾을 수 없습니다",
  not_apply: "지원으로 고른 공고에서만 쓸 수 있습니다",
  changed: "그사이 내용이 바뀌었습니다. 화면을 새로 고친 뒤 다시 해 주세요",
  stale: "고른 경험의 기록이 바뀌었습니다. 다시 고르기를 눌러 주세요",
  none_selected: "쓸 경험을 하나 이상 골라 주세요",
  too_many: "문항은 공고마다 10개까지 넣을 수 있습니다",
  empty_request: "고칠 방향을 골라 주세요",
  too_long: "문단은 2000자까지 쓸 수 있습니다",
} as const;

// 이 기능용 AI 실패 문구
const AI_MESSAGES: Record<"over_limit" | AiFailure, string> = {
  over_limit: "이번 달 AI 사용 한도에 닿았습니다. 답을 직접 써서 저장할 수 있습니다",
  refused: "AI가 이 문항을 쓰지 못했습니다. 다시 시도해 주세요",
  truncated: "AI의 답이 중간에 끊겼습니다. 다시 시도해 주세요",
  invalid: "AI의 답을 읽지 못했습니다. 다시 시도해 주세요",
  unavailable: "AI 서비스에 연결하지 못했습니다. 잠시 뒤 다시 시도해 주세요",
};

const messageOf = (reason: string) =>
  (MESSAGES as Record<string, string>)[reason] ?? (AI_MESSAGES as Record<string, string>)[reason] ?? AI_MESSAGES.unavailable;

const fail = (reason: string): Result => ({ ok: false, message: messageOf(reason) });

function refresh(postingId: string) {
  revalidatePath(`/postings/${postingId}/application`);
  revalidatePath(`/postings/${postingId}`);
}

// 끝난 문항의 공고 화면을 다시 그린다. 문항이 없어졌으면 그릴 곳을 알 수 없으므로 아무것도 하지 않는다
async function refreshOf(userId: string, questionId: string) {
  const question = await getQuestion(db, userId, questionId);
  if (question) refresh(question.postingId);
}

export async function addQuestionsAction(postingId: string, raw: unknown[]): Promise<Result> {
  const user = await requireUser();
  if (typeof postingId !== "string" || !Array.isArray(raw) || raw.length === 0) return fail("not_found");
  const values = [];
  for (const [index, item] of raw.entries()) {
    const checked = validateQuestion(item);
    if (!checked.ok) {
      const first = Object.values(checked.errors)[0] ?? "문항을 확인해 주세요";
      return { ok: false, message: `${index + 1}번 문항: ${first}` };
    }
    values.push(checked.value);
  }
  const result = await addQuestions(db, user.id, postingId, values);
  if (!result.ok) return fail(result.reason);
  refresh(postingId);
  return { ok: true };
}

export async function updateQuestionAction(id: string, raw: unknown): Promise<Result> {
  const user = await requireUser();
  if (typeof id !== "string") return fail("not_found");
  const checked = validateQuestion(raw);
  if (!checked.ok) return { ok: false, message: Object.values(checked.errors)[0] ?? "문항을 확인해 주세요" };
  const question = await getQuestion(db, user.id, id);
  if (!question) return fail("not_found");
  const result = await updateQuestion(db, user.id, id, checked.value);
  if (!result.ok) return fail(result.reason);
  refresh(question.postingId);
  return { ok: true };
}

export async function deleteQuestionAction(id: string): Promise<Result> {
  const user = await requireUser();
  if (typeof id !== "string") return fail("not_found");
  const question = await getQuestion(db, user.id, id);
  if (!question) return fail("not_found");
  const result = await deleteQuestion(db, user.id, id);
  if (!result.ok) return fail(result.reason);
  refresh(question.postingId);
  return { ok: true };
}

// 문항 하나에 쓸 경험을 고른다(AI 1번)
export async function selectAction(id: string): Promise<Result> {
  const user = await requireUser();
  if (typeof id !== "string") return fail("not_found");
  const result = await selectForQuestion(db, ai, user.id, id);
  if (!result.ok) return fail(result.reason);
  await refreshOf(user.id, id);
  return { ok: true };
}

// 체크한 경험을 승인하고 곧바로 답을 쓴다. 경험 id는 서버가 지금의 쓸 수 있는 경험과 맞춰 본다
export async function approveAndWriteAction(id: string, experienceIds: string[]): Promise<Result> {
  const user = await requireUser();
  if (typeof id !== "string") return fail("not_found");
  const ids = Array.isArray(experienceIds) ? experienceIds.filter((value): value is string => typeof value === "string") : [];
  const result = await approveAndWrite(db, ai, user.id, id, ids);
  if (!result.ok) return fail(result.reason);
  await refreshOf(user.id, id);
  return { ok: true };
}

const PRESETS: readonly string[] = ["shorter", "concrete", "natural"];

// 문단 하나를 AI로 고친다. expected는 화면이 그린 답이며 저장된 답과 같은지 비교하는 데만 쓴다
export async function reviseAction(
  id: string,
  index: number,
  preset: string | null,
  note: string,
  expected: Draft,
): Promise<Result> {
  const user = await requireUser();
  if (typeof id !== "string") return fail("not_found");
  const result = await reviseParagraph(
    db,
    ai,
    user.id,
    id,
    index,
    {
      preset: typeof preset === "string" && PRESETS.includes(preset) ? (preset as RevisePreset) : null,
      note: typeof note === "string" ? note : "",
    },
    expected,
  );
  if (!result.ok) return fail(result.reason);
  await refreshOf(user.id, id);
  return { ok: true };
}

// 문단을 직접 고친다(AI를 부르지 않는다)
export async function editParagraphAction(id: string, index: number, text: string, expected: Draft): Promise<Result> {
  const user = await requireUser();
  if (typeof id !== "string" || typeof text !== "string") return fail("not_found");
  const result = await editParagraph(db, user.id, id, index, text, expected);
  if (!result.ok) return fail(result.reason);
  await refreshOf(user.id, id);
  return { ok: true };
}
