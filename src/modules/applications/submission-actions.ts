"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { requireUser } from "@/lib/session";
import { reopenPosting, submitPosting } from "./submit";

// 모든 액션은 requireUser()로 얻은 userId만 쓴다. expectedNumber는 화면이 본 마지막 번호로, 서버가 읽은 값과 비교하는 데만 쓴다.

type Result = { ok: true } | { ok: false; message: string };

const MESSAGES = {
  not_found: "공고를 찾을 수 없습니다",
  not_apply: "지원으로 고른 공고에서만 제출할 수 있습니다",
  changed: "그사이 제출 상태가 바뀌었습니다. 화면을 새로 고쳐 주세요",
} as const;

const fail = (reason: keyof typeof MESSAGES): Result => ({ ok: false, message: MESSAGES[reason] });

function refresh(postingId: string) {
  revalidatePath(`/postings/${postingId}`);
  revalidatePath(`/postings/${postingId}/application`);
  revalidatePath(`/postings/${postingId}/resume`);
  revalidatePath(`/postings/${postingId}/career`);
  // 제출본 화면은 번호마다 하나라 패턴으로 다시 그리게 한다
  revalidatePath("/postings/[id]/submissions/[number]", "page");
}

const valid = (postingId: unknown, expectedNumber: unknown) =>
  typeof postingId === "string" && typeof expectedNumber === "number" && Number.isInteger(expectedNumber) && expectedNumber >= 0;

export async function submitAction(postingId: string, expectedNumber: number): Promise<Result> {
  const user = await requireUser();
  if (!valid(postingId, expectedNumber)) return fail("not_found");
  const result = await submitPosting(db, user.id, postingId, expectedNumber);
  if (!result.ok) return fail(result.reason);
  refresh(postingId);
  return { ok: true };
}

export async function reopenAction(postingId: string, expectedNumber: number): Promise<Result> {
  const user = await requireUser();
  if (!valid(postingId, expectedNumber)) return fail("not_found");
  const result = await reopenPosting(db, user.id, postingId, expectedNumber);
  if (!result.ok) return fail(result.reason);
  refresh(postingId);
  return { ok: true };
}
