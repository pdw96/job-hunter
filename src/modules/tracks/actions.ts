"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { requireUser } from "@/lib/session";
import { createTrack, updateTrack } from "./repo";
import { type SurveyErrors, validateSurvey } from "./survey";

type ActionResult = { ok: false; errors: SurveyErrors; message?: string };

const REFERENCE_ERRORS: Record<string, ActionResult> = {
  invalid_job: { ok: false, errors: { jobs: "목록에 없는 직무가 있습니다. 직무를 다시 골라 주세요" } },
  invalid_major: { ok: false, errors: { majorCode: "분야를 다시 골라 주세요" } },
  not_found: { ok: false, errors: {}, message: "트랙을 찾을 수 없습니다" },
};

// 성공하면 홈으로 이동하므로 돌아오는 값은 실패뿐이다
export async function createTrackAction(input: unknown): Promise<ActionResult> {
  const user = await requireUser(); // userId는 여기서만 얻는다
  const parsed = validateSurvey(input);
  if (!parsed.ok) return parsed;
  const result = await createTrack(db, user.id, parsed.value);
  if (!result.ok) return REFERENCE_ERRORS[result.reason];
  // 브라우저가 기억해 둔 예전 화면(트랙이 없어 설문으로 보내던 홈 등)을 버리게 한다
  revalidatePath("/", "layout");
  redirect("/");
}

export async function updateTrackAction(trackId: string, input: unknown): Promise<ActionResult> {
  const user = await requireUser();
  if (typeof trackId !== "string") return REFERENCE_ERRORS.not_found;
  const parsed = validateSurvey(input);
  if (!parsed.ok) return parsed;
  const result = await updateTrack(db, user.id, trackId, parsed.value);
  if (!result.ok) return REFERENCE_ERRORS[result.reason];
  // 브라우저가 기억해 둔 예전 화면(트랙이 없어 설문으로 보내던 홈 등)을 버리게 한다
  revalidatePath("/", "layout");
  redirect("/");
}
