"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { requireUser } from "@/lib/session";
import type { AiFailure } from "@/modules/ai/client";
import { ai } from "@/modules/ai/provider";
import { answerAsks, makeAsks, writeAnswer } from "./ask";
import { detachAnswer, getQuestion } from "./repo";

// 묻기: 질문 받기, 고른 답 저장, 직접 적기, 답 빼기. 모든 액션은 requireUser()로 얻은 userId만 쓰고, 끝나면 자소서 화면을 다시 그린다.
// 화면에서 받는 것은 문항 id, 주제, 고른 번호, 기타·직접 적기 글뿐이다. 선택지 글은 서버가 저장한 질문에서 꺼낸다

type Result = { ok: true } | { ok: false; message: string };

const MESSAGES = {
  not_found: "문항을 찾을 수 없습니다",
  not_apply: "지원으로 고른 공고에서만 쓸 수 있습니다",
  submitted: "제출한 뒤에는 고칠 수 없습니다. 공고 화면에서 새 버전 만들기를 누른 뒤 고쳐 주세요",
  changed: "그사이 문항이나 질문이 바뀌었습니다. 질문 받기를 다시 눌러 주세요",
  not_needed: "이 문항에서는 묻지 않는 주제입니다",
  none_picked: "선택지를 하나 이상 고르거나 기타를 적어 주세요",
  empty: "답을 적어 주세요",
  too_long: "답은 1000자까지 적을 수 있습니다",
  too_many: "답은 문항마다 6개까지 붙일 수 있습니다. 필요 없는 답을 빼 주세요",
} as const;

const AI_MESSAGES: Record<"over_limit" | AiFailure, string> = {
  over_limit: "이번 달 AI 사용 한도에 닿았습니다. 직접 적기로 답을 적을 수 있습니다",
  refused: "AI가 질문을 만들지 못했습니다. 다시 시도하거나 직접 적어 주세요",
  truncated: "AI의 답이 중간에 끊겼습니다. 다시 시도해 주세요",
  invalid: "AI의 답을 읽지 못했습니다. 다시 시도하거나 직접 적어 주세요",
  unavailable: "AI 서비스에 연결하지 못했습니다. 잠시 뒤 다시 시도하거나 직접 적어 주세요",
};

const messageOf = (reason: string) =>
  (MESSAGES as Record<string, string>)[reason] ?? (AI_MESSAGES as Record<string, string>)[reason] ?? AI_MESSAGES.unavailable;
const fail = (reason: string): Result => ({ ok: false, message: messageOf(reason) });

// 끝난 문항의 자소서 화면을 다시 그린다. 문항이 없어졌으면 그릴 곳을 알 수 없으므로 아무것도 하지 않는다
async function refreshOf(userId: string, questionId: string) {
  const question = await getQuestion(db, userId, questionId);
  if (!question) return;
  revalidatePath(`/postings/${question.postingId}/application`);
  revalidatePath(`/postings/${question.postingId}`);
}

// 문항 하나의 질문을 만든다(AI 1번). topics는 물을 주제(그 문항의 주제에 있는 것만 쓴다)
export async function makeAsksAction(id: string, topics: unknown): Promise<Result> {
  const user = await requireUser();
  if (typeof id !== "string") return fail("not_found");
  const result = await makeAsks(db, ai, user.id, id, topics);
  if (!result.ok) return fail(result.reason);
  await refreshOf(user.id, id);
  return { ok: true };
}

// 고른 답을 저장한다. picks는 [{ index, options, previous, note }]: 질문 번호, 고른 선택지 번호, 고른 지난 답 번호, 기타 한 줄
export async function answerAsksAction(id: string, picks: unknown): Promise<Result> {
  const user = await requireUser();
  if (typeof id !== "string") return fail("not_found");
  const result = await answerAsks(db, user.id, id, picks);
  if (!result.ok) return fail(result.reason === "empty" ? "none_picked" : result.reason);
  await refreshOf(user.id, id);
  return { ok: true };
}

// 직접 적기(AI를 부르지 않는다)
export async function writeAnswerAction(id: string, topic: unknown, text: string): Promise<Result> {
  const user = await requireUser();
  if (typeof id !== "string" || typeof text !== "string") return fail("not_found");
  const result = await writeAnswer(db, user.id, id, topic, text);
  if (!result.ok) return fail(result.reason);
  await refreshOf(user.id, id);
  return { ok: true };
}

// 붙인 답을 뺀다. 답 행은 남아 다른 공고에서 지난 답으로 다시 쓸 수 있다
export async function detachAnswerAction(id: string, answerId: string): Promise<Result> {
  const user = await requireUser();
  if (typeof id !== "string" || typeof answerId !== "string") return fail("not_found");
  const result = await detachAnswer(db, user.id, id, answerId);
  if (!result.ok) return fail(result.reason);
  await refreshOf(user.id, id);
  return { ok: true };
}
