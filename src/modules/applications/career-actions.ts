"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { requireUser } from "@/lib/session";
import type { AiFailure } from "@/modules/ai/client";
import { ai } from "@/modules/ai/provider";
import { editCareer, type CareerEdit } from "./career-edit";
import { getCareer } from "./career-repo";
import { buildTailoredCareer, selectCareerEmphasis } from "./career-tailor";
import { rewriteCareerItems, startCommonCareer } from "./career-write";

// 경력기술서 공통본·맞춤본 액션. 모두 requireUser()로 얻은 userId만 쓰고, 끝나면 그 화면을 다시 그리게 한다.
// 화면에서 받은 값(항목 id, expectedVersion, 고친 줄)은 검사하거나 서버가 읽은 값과 비교하는 데만 쓴다.

type Result = { ok: true } | { ok: false; message: string };

const MESSAGES = {
  not_found: "찾을 수 없습니다. 화면을 새로 고쳐 주세요",
  exists: "이미 공통본이 있습니다. 화면을 새로 고쳐 주세요",
  no_jobs: "경력이 없어 경력기술서를 만들 수 없습니다",
  no_common: "트랙의 경력기술서 공통본을 먼저 만들어 주세요",
  not_apply: "지원으로 고른 공고에서만 쓸 수 있습니다",
  submitted: "제출한 뒤에는 고칠 수 없습니다. 공고 화면에서 새 버전 만들기를 누른 뒤 고쳐 주세요",
  changed: "그사이 내용이 바뀌었습니다. 화면을 새로 고친 뒤 다시 해 주세요",
  full: "경력기술서 항목은 30개까지입니다. 항목을 빼고 넣어 주세요",
  none_selected: "다시 쓸 수 있는 항목이 없습니다. 기록이 확인됐는지, 트랙에서 제외되지 않았는지 보세요",
  too_many_selected: "강조할 항목은 5개까지 골라 주세요",
  too_many_lines: "줄은 8개까지 쓸 수 있습니다",
  too_long: "한 줄은 150자까지 쓸 수 있습니다",
  invalid_edit: "고친 내용을 읽지 못했습니다. 줄은 8개, 한 줄은 150자까지 쓸 수 있습니다",
} as const;

// 이 기능용 AI 실패 문구
const AI_MESSAGES: Record<"over_limit" | AiFailure, string> = {
  over_limit: "이번 달 AI 사용 한도에 닿았습니다. 줄은 직접 고칠 수 있습니다",
  refused: "AI가 경력기술서를 쓰지 못했습니다. 다시 시도해 주세요",
  truncated: "AI의 답이 중간에 끊겼습니다. 다시 시도해 주세요",
  invalid: "AI의 답을 읽지 못했습니다. 다시 시도해 주세요",
  unavailable: "AI 서비스에 연결하지 못했습니다. 잠시 뒤 다시 시도해 주세요",
};

type Reason = keyof typeof MESSAGES | keyof typeof AI_MESSAGES;

// 새 사유가 생기면 여기서 컴파일 오류가 나도록 모든 사유를 키로 받는다
const fail = (reason: Reason): Result => ({
  ok: false,
  message: reason in MESSAGES ? MESSAGES[reason as keyof typeof MESSAGES] : AI_MESSAGES[reason as keyof typeof AI_MESSAGES],
});

const MAX_IDS = 100;
const text = z.string().max(2000);
const editSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("lines"), itemId: text, field: z.enum(["done", "results"]), text }),
  z.object({ type: z.literal("move"), itemId: text, direction: z.enum(["up", "down"]) }),
  z.object({ type: z.literal("remove"), itemId: text }),
]);

const idsOf = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((id): id is string => typeof id === "string" && id.length <= 2000).slice(0, MAX_IDS) : [];
const isVersion = (value: unknown): value is number => Number.isInteger(value);

function refreshPosting(postingId: string) {
  revalidatePath(`/postings/${postingId}/career`);
  revalidatePath(`/postings/${postingId}`);
}

// 끝난 경력기술서의 화면을 다시 그린다. 경력기술서가 없어졌으면 그릴 곳을 알 수 없으므로 아무것도 하지 않는다
async function refreshOf(userId: string, careerId: string) {
  const career = await getCareer(db, userId, careerId);
  if (!career) return;
  if (career.postingId) refreshPosting(career.postingId);
  else revalidatePath(`/tracks/${career.trackId}/career`);
}

// 트랙의 공통본을 처음 만든다(AI 1번)
export async function startCommonCareerAction(trackId: string): Promise<Result> {
  const user = await requireUser();
  if (typeof trackId !== "string") return fail("not_found");
  const result = await startCommonCareer(db, ai, user.id, trackId);
  if (!result.ok) return fail(result.reason);
  revalidatePath(`/tracks/${trackId}/career`);
  return { ok: true };
}

// 고른 항목을 다시 쓰거나 빠진 항목을 넣고, 경력 id는 그 회사 머리를 새로 고친다. id는 서버가 지금 쓸 수 있는 것과 맞춰 본다
export async function rewriteCareerItemsAction(careerId: string, ids: string[], expectedVersion: number): Promise<Result> {
  const user = await requireUser();
  if (typeof careerId !== "string") return fail("not_found");
  if (!isVersion(expectedVersion)) return fail("changed");
  const result = await rewriteCareerItems(db, ai, user.id, careerId, idsOf(ids), expectedVersion);
  if (!result.ok) return fail(result.reason);
  await refreshOf(user.id, careerId);
  return { ok: true };
}

// 줄 고치기, 옮기기, 빼기(AI를 부르지 않는다). edit은 브라우저가 보낸 값이므로 모양부터 검사한다
export async function editCareerAction(careerId: string, edit: CareerEdit, expectedVersion: number): Promise<Result> {
  const user = await requireUser();
  if (typeof careerId !== "string") return fail("not_found");
  if (!isVersion(expectedVersion)) return fail("changed");
  const parsed = editSchema.safeParse(edit);
  if (!parsed.success) return fail("invalid_edit");
  const result = await editCareer(db, user.id, careerId, parsed.data, expectedVersion);
  if (!result.ok) return fail(result.reason);
  await refreshOf(user.id, careerId);
  return { ok: true };
}

// 공고에 맞춰 강조할 항목을 고른다(AI 1번)
export async function selectCareerEmphasisAction(postingId: string): Promise<Result> {
  const user = await requireUser();
  if (typeof postingId !== "string") return fail("not_found");
  const result = await selectCareerEmphasis(db, ai, user.id, postingId);
  if (!result.ok) return fail(result.reason);
  refreshPosting(postingId);
  return { ok: true };
}

// 체크한 항목을 강조해 공통본에서 맞춤본을 만든다. 아무것도 고르지 않으면 공통본을 그대로 복사한다(AI 없음)
export async function buildTailoredCareerAction(postingId: string, itemIds: string[], expectedVersion: number | null): Promise<Result> {
  const user = await requireUser();
  if (typeof postingId !== "string") return fail("not_found");
  if (expectedVersion !== null && !isVersion(expectedVersion)) return fail("changed");
  const result = await buildTailoredCareer(db, ai, user.id, postingId, idsOf(itemIds), expectedVersion);
  if (!result.ok) return fail(result.reason);
  refreshPosting(postingId);
  return { ok: true };
}
