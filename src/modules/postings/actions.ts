"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { requireUser } from "@/lib/session";
import { ai } from "@/modules/ai/provider";
import { type ExtractedPosting, extractPosting } from "./extract";
import { type PostingErrors, validatePosting } from "./input";
import { POSTING_LIMITS } from "./options";
import { createPosting, deletePosting, findSimilar, setExcludeOverride, setStatus, updatePosting } from "./repo";
import { todayInKorea } from "./today";

// 모든 액션은 requireUser()로 얻은 userId만 쓴다. 저장 뒤에는 브라우저가 기억한 예전 화면을 버리게 한다.

type SimpleResult = { ok: true } | { ok: false; message: string };

const NOT_FOUND = "공고를 찾을 수 없습니다";
const AI_MESSAGES: Record<string, string> = {
  over_limit: "이번 달 AI 사용 한도에 닿았습니다. 값을 직접 채워 저장할 수 있습니다",
  refused: "AI가 이 공고를 읽지 못했습니다. 값을 직접 채워 주세요",
  truncated: "AI의 답이 중간에 끊겼습니다. 다시 시도해 주세요",
  invalid: "AI의 답을 읽지 못했습니다. 다시 시도해 주세요",
  unavailable: "AI 서비스에 연결하지 못했습니다. 잠시 뒤 다시 시도하거나 값을 직접 채워 주세요",
};

function refresh(id?: string) {
  revalidatePath("/postings");
  if (id) revalidatePath(`/postings/${id}`);
}

// 공고 원문에서 값을 뽑는다. 저장하지 않는다
export async function readPostingAction(
  rawText: string,
): Promise<{ ok: true; value: ExtractedPosting } | { ok: false; message: string }> {
  const user = await requireUser();
  const text = typeof rawText === "string" ? rawText.trim() : "";
  if (text === "") return { ok: false, message: "공고 원문을 붙여 넣어 주세요" };
  if (text.length > POSTING_LIMITS.rawText) {
    return { ok: false, message: `공고 원문은 ${POSTING_LIMITS.rawText.toLocaleString()}자까지 넣을 수 있습니다` };
  }
  const result = await extractPosting(db, ai, user.id, text, todayInKorea());
  if (!result.ok) return { ok: false, message: AI_MESSAGES[result.reason] ?? AI_MESSAGES.unavailable };
  return result;
}

export type SavePostingResult =
  | { ok: true; id: string }
  | { ok: false; errors?: PostingErrors; message?: string; similar?: { id: string; company: string; title: string }[] };

// 공고를 저장한다. id가 있으면 고친다. 같은 회사·직무의 공고가 있으면 먼저 알리고, force로 다시 부르면 저장한다
export async function savePostingAction(
  trackId: string,
  input: unknown,
  options: { id?: string; force?: boolean } = {},
): Promise<SavePostingResult> {
  const user = await requireUser();
  const checked = validatePosting(input);
  if (!checked.ok) return { ok: false, errors: checked.errors };
  const id = typeof options.id === "string" ? options.id : undefined;

  if (id) {
    const updated = await updatePosting(db, user.id, id, checked.value);
    if (!updated.ok) return { ok: false, message: NOT_FOUND };
    refresh(id);
    return { ok: true, id };
  }

  if (typeof trackId !== "string") return { ok: false, message: "트랙을 골라 주세요" };
  if (options.force !== true) {
    const similar = await findSimilar(db, user.id, trackId, checked.value.company, checked.value.title);
    if (similar.length > 0) return { ok: false, similar };
  }
  const created = await createPosting(db, user.id, trackId, checked.value);
  if (!created.ok) {
    return {
      ok: false,
      message:
        created.reason === "too_many"
          ? `공고는 ${POSTING_LIMITS.perUser}건까지 넣을 수 있습니다. 지난 공고를 지워 주세요`
          : "트랙을 찾을 수 없습니다",
    };
  }
  refresh();
  return { ok: true, id: created.id };
}

export async function setPostingStatusAction(id: string, status: "interest" | "hold" | "excluded"): Promise<SimpleResult> {
  const user = await requireUser();
  if (typeof id !== "string" || !["interest", "hold", "excluded"].includes(status)) return { ok: false, message: NOT_FOUND };
  const result = await setStatus(db, user.id, id, status);
  if (!result.ok) return { ok: false, message: NOT_FOUND };
  refresh(id);
  return { ok: true };
}

export async function setExcludeOverrideAction(id: string, value: boolean): Promise<SimpleResult> {
  const user = await requireUser();
  if (typeof id !== "string") return { ok: false, message: NOT_FOUND };
  const result = await setExcludeOverride(db, user.id, id, value === true);
  if (!result.ok) return { ok: false, message: NOT_FOUND };
  refresh(id);
  return { ok: true };
}

export async function deletePostingAction(id: string): Promise<SimpleResult> {
  const user = await requireUser();
  if (typeof id !== "string") return { ok: false, message: NOT_FOUND };
  const result = await deletePosting(db, user.id, id);
  if (!result.ok) return { ok: false, message: NOT_FOUND };
  refresh(id);
  redirect("/postings");
}
