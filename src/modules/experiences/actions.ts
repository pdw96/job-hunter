"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { requireUser } from "@/lib/session";
import { type ExperienceErrors, type ExperienceInput, validateExperience } from "./input";
import { RUBRIC_ITEMS, type RubricItem, SCOPES, type Scope } from "./options";
import {
  closeRubricItem,
  confirmExperience,
  createExperience,
  deleteExperience,
  reopenRubricItem,
  setTrackScope,
  unconfirmExperience,
  updateExperience,
} from "./repo";

// 모든 액션은 requireUser()로 얻은 userId만 쓴다. 저장 뒤에는 브라우저가 기억한 예전 화면을 버리게 한다.

type SaveResult = { ok: true; id: string; value: ExperienceInput } | { ok: false; errors: ExperienceErrors; message?: string };
type SimpleResult = { ok: true } | { ok: false; message: string };

const NOT_FOUND = "기록을 찾을 수 없습니다";

function refresh(id?: string) {
  revalidatePath("/experiences");
  revalidatePath("/");
  if (id) revalidatePath(`/experiences/${id}`);
}

const isScopes = (value: unknown): value is Record<string, Scope> =>
  typeof value === "object" &&
  value !== null &&
  Object.values(value).every((scope) => (SCOPES as readonly unknown[]).includes(scope));

// 새 기록(id 없음) 또는 고치기. 트랙별 사용 범위도 함께 저장한다
export async function saveExperienceAction(id: string | null, input: unknown, scopes: unknown): Promise<SaveResult> {
  const user = await requireUser();
  const parsed = validateExperience(input);
  if (!parsed.ok) return parsed;
  if (!isScopes(scopes)) return { ok: false, errors: {}, message: "트랙별 사용 범위를 다시 골라 주세요" };

  let savedId = id;
  if (typeof savedId === "string") {
    const result = await updateExperience(db, user.id, savedId, parsed.value);
    if (!result.ok) return { ok: false, errors: {}, message: NOT_FOUND };
  } else {
    savedId = await createExperience(db, user.id, parsed.value);
  }
  // 남의 트랙 id가 섞여 있으면 그 줄은 저장되지 않는다(setTrackScope가 거부한다)
  for (const [trackId, scope] of Object.entries(scopes)) {
    await setTrackScope(db, user.id, savedId, trackId, scope);
  }
  refresh(savedId);
  return { ok: true, id: savedId, value: parsed.value };
}

export async function deleteExperienceAction(id: string): Promise<SimpleResult> {
  const user = await requireUser();
  const result = typeof id === "string" ? await deleteExperience(db, user.id, id) : { ok: false as const };
  if (!result.ok) return { ok: false, message: NOT_FOUND };
  refresh(id);
  redirect("/experiences");
}

export async function setConfirmedAction(id: string, confirmed: boolean): Promise<SimpleResult> {
  const user = await requireUser();
  if (typeof id !== "string") return { ok: false, message: NOT_FOUND };
  const result = confirmed ? await confirmExperience(db, user.id, id) : await unconfirmExperience(db, user.id, id);
  if (!result.ok) return { ok: false, message: NOT_FOUND };
  refresh(id);
  return { ok: true };
}

export async function setRubricClosedAction(id: string, item: RubricItem, closed: boolean): Promise<SimpleResult> {
  const user = await requireUser();
  if (typeof id !== "string" || !RUBRIC_ITEMS.includes(item)) return { ok: false, message: NOT_FOUND };
  const result = closed
    ? await closeRubricItem(db, user.id, id, item)
    : await reopenRubricItem(db, user.id, id, item);
  if (!result.ok) {
    return { ok: false, message: result.reason === "not_allowed" ? "이 항목은 닫을 수 없습니다" : NOT_FOUND };
  }
  refresh(id);
  return { ok: true };
}
