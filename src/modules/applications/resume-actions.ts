"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { requireUser } from "@/lib/session";
import type { AiFailure } from "@/modules/ai/client";
import { ai } from "@/modules/ai/provider";
import { editResume, type ResumeEdit } from "./resume-edit";
import { getResume } from "./resume-repo";
import { buildTailored, selectEmphasis } from "./resume-tailor";
import { rewriteEntries, startCommonResume } from "./resume-write";

// 이력서 공통본·맞춤본 액션. 모두 requireUser()로 얻은 userId만 쓰고, 끝나면 그 화면을 다시 그리게 한다.
// 화면에서 받은 값(경험 id, expectedVersion, 고친 줄)은 검사하거나 서버가 읽은 값과 비교하는 데만 쓴다.

type Result = { ok: true } | { ok: false; message: string };

const MESSAGES = {
  not_found: "이력서를 찾을 수 없습니다",
  exists: "이미 공통본이 있습니다. 화면을 새로 고쳐 주세요",
  no_sources: "이 트랙에 쓸 수 있는 확인된 기록이 없습니다",
  no_common: "트랙의 이력서 공통본을 먼저 만들어 주세요",
  not_apply: "지원으로 고른 공고에서만 쓸 수 있습니다",
  changed: "그사이 내용이 바뀌었습니다. 화면을 새로 고친 뒤 다시 해 주세요",
  none_selected: "다시 쓸 수 있는 경험이 없습니다. 경험이 확인됐는지, 트랙에서 제외되지 않았는지 보세요",
  too_many_selected: "강조할 경험은 5개까지 골라 주세요",
  too_many_lines: "줄은 8개까지 쓸 수 있습니다",
  too_long: "한 줄은 150자까지 쓸 수 있습니다",
  invalid_edit: "고친 내용을 읽지 못했습니다. 줄은 8개, 한 줄은 150자까지 쓸 수 있습니다",
} as const;

// 이 기능용 AI 실패 문구
const AI_MESSAGES: Record<"over_limit" | AiFailure, string> = {
  over_limit: "이번 달 AI 사용 한도에 닿았습니다. 줄은 직접 고칠 수 있습니다",
  refused: "AI가 이력서를 쓰지 못했습니다. 다시 시도해 주세요",
  truncated: "AI의 답이 중간에 끊겼습니다. 다시 시도해 주세요",
  invalid: "AI의 답을 읽지 못했습니다. 다시 시도해 주세요",
  unavailable: "AI 서비스에 연결하지 못했습니다. 잠시 뒤 다시 시도해 주세요",
};

const messageOf = (reason: string) =>
  (MESSAGES as Record<string, string>)[reason] ?? (AI_MESSAGES as Record<string, string>)[reason] ?? AI_MESSAGES.unavailable;

const fail = (reason: string): Result => ({ ok: false, message: messageOf(reason) });

const MAX_IDS = 100;
const text = z.string().max(2000);
const editSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("lines"), experienceId: text, text }),
  z.object({ type: z.literal("move"), experienceId: text, direction: z.enum(["up", "down"]) }),
  z.object({ type: z.literal("remove"), experienceId: text }),
]);

const idsOf = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((id): id is string => typeof id === "string" && id.length <= 2000).slice(0, MAX_IDS) : [];
const isVersion = (value: unknown): value is number => Number.isInteger(value);

function refreshPosting(postingId: string) {
  revalidatePath(`/postings/${postingId}/resume`);
  revalidatePath(`/postings/${postingId}`);
}

// 끝난 이력서의 화면을 다시 그린다. 이력서가 없어졌으면 그릴 곳을 알 수 없으므로 아무것도 하지 않는다
async function refreshOf(userId: string, resumeId: string) {
  const resume = await getResume(db, userId, resumeId);
  if (!resume) return;
  if (resume.postingId) refreshPosting(resume.postingId);
  else revalidatePath(`/tracks/${resume.trackId}/resume`);
}

// 트랙의 공통본을 처음 만든다(AI 1번)
export async function startCommonResumeAction(trackId: string): Promise<Result> {
  const user = await requireUser();
  if (typeof trackId !== "string") return fail("not_found");
  const result = await startCommonResume(db, ai, user.id, trackId);
  if (!result.ok) return fail(result.reason);
  revalidatePath(`/tracks/${trackId}/resume`);
  return { ok: true };
}

// 고른 항목을 다시 쓰거나 아직 없는 경험을 넣는다. 경험 id는 서버가 지금의 쓸 수 있는 경험과 맞춰 본다
export async function rewriteEntriesAction(resumeId: string, experienceIds: string[], expectedVersion: number): Promise<Result> {
  const user = await requireUser();
  if (typeof resumeId !== "string") return fail("not_found");
  if (!isVersion(expectedVersion)) return fail("changed");
  const result = await rewriteEntries(db, ai, user.id, resumeId, idsOf(experienceIds), expectedVersion);
  if (!result.ok) return fail(result.reason);
  await refreshOf(user.id, resumeId);
  return { ok: true };
}

// 줄 고치기, 옮기기, 빼기(AI를 부르지 않는다). edit은 브라우저가 보낸 값이므로 모양부터 검사한다
export async function editResumeAction(resumeId: string, edit: ResumeEdit, expectedVersion: number): Promise<Result> {
  const user = await requireUser();
  if (typeof resumeId !== "string") return fail("not_found");
  if (!isVersion(expectedVersion)) return fail("changed");
  const parsed = editSchema.safeParse(edit);
  if (!parsed.success) return fail("invalid_edit");
  const result = await editResume(db, user.id, resumeId, parsed.data, expectedVersion);
  if (!result.ok) return fail(result.reason);
  await refreshOf(user.id, resumeId);
  return { ok: true };
}

// 공고에 맞춰 강조할 경험을 고른다(AI 1번)
export async function selectEmphasisAction(postingId: string): Promise<Result> {
  const user = await requireUser();
  if (typeof postingId !== "string") return fail("not_found");
  const result = await selectEmphasis(db, ai, user.id, postingId);
  if (!result.ok) return fail(result.reason);
  refreshPosting(postingId);
  return { ok: true };
}

// 체크한 경험을 강조해 공통본에서 맞춤본을 만든다. 아무것도 고르지 않으면 공통본을 그대로 복사한다(AI 없음)
export async function buildTailoredAction(postingId: string, experienceIds: string[], expectedVersion: number | null): Promise<Result> {
  const user = await requireUser();
  if (typeof postingId !== "string") return fail("not_found");
  if (expectedVersion !== null && !isVersion(expectedVersion)) return fail("changed");
  const result = await buildTailored(db, ai, user.id, postingId, idsOf(experienceIds), expectedVersion);
  if (!result.ok) return fail(result.reason);
  refreshPosting(postingId);
  return { ok: true };
}
