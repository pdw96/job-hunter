"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { requireUser } from "@/lib/session";
import type { AiImage } from "@/modules/ai/client";
import { ai } from "@/modules/ai/provider";
import { type ExtractedPosting, extractPosting } from "./extract";
// 로컬 미리보기에서는 next.config.ts가 이 파일을 src/dev/local-fetch-page.ts로 바꿔 끼운다
import { fetchPosting } from "@/modules/postings/fetch-page";
import { type PostingErrors, validatePosting } from "./input";
import { POSTING_LIMITS } from "./options";
import { transcribePosting, validateTiles } from "./read-image";
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

const FETCH_MESSAGES: Record<string, string> = {
  bad_url: "주소를 확인해 주세요. http:// 또는 https://로 시작하는 공고 주소여야 합니다",
  blocked: "이 사이트는 자동으로 읽을 수 없습니다. 공고 글을 복사해 붙여 넣거나, 공고 화면을 그림으로 올려 주세요",
  empty:
    "공고 글을 찾지 못했습니다. 로그인이 필요하거나 내용을 나중에 불러오는 페이지일 수 있습니다. 공고 글을 복사해 붙여 넣거나, 공고 화면을 그림으로 올려 주세요",
};

// 공고 주소를 열어 글을 뽑는다. 본문이 그림이면 그림을 돌려준다(브라우저가 잘라서 다시 보낸다)
export async function fetchPostingAction(
  url: string,
): Promise<{ ok: true; text: string; images: AiImage[] } | { ok: false; message: string }> {
  await requireUser();
  if (typeof url !== "string" || url.length > POSTING_LIMITS.url) return { ok: false, message: FETCH_MESSAGES.bad_url };
  const result = await fetchPosting(url);
  if (!result.ok) return { ok: false, message: FETCH_MESSAGES[result.reason] };
  return { ok: true, text: result.text.slice(0, POSTING_LIMITS.rawText), images: result.images };
}

const IMAGE_MESSAGES: Record<string, string> = {
  ...AI_MESSAGES,
  over_limit: "이번 달 AI 사용 한도에 닿았습니다. 공고 글을 복사해 붙여 넣어 주세요",
  refused: "AI가 이 그림을 읽지 못했습니다. 공고 글을 복사해 붙여 넣어 주세요",
  invalid_tiles: "그림을 읽을 수 없습니다. JPG, PNG, WEBP 그림을 올려 주세요",
  too_many: "그림이 너무 깁니다. 나눠서 올려 주세요",
  too_large: "그림이 너무 큽니다. 나눠서 올려 주세요",
  no_text: "그림에서 공고 글을 찾지 못했습니다. 공고 글이 보이는 그림인지 확인해 주세요",
};

// 그림으로 된 공고(브라우저가 읽기 좋은 크기로 자른 조각)를 글로 옮긴다
export async function readPostingImagesAction(tiles: unknown): Promise<{ ok: true; text: string } | { ok: false; message: string }> {
  const user = await requireUser();
  const checked = validateTiles(tiles);
  if (!checked.ok) return { ok: false, message: IMAGE_MESSAGES[checked.reason === "invalid" ? "invalid_tiles" : checked.reason] };
  const result = await transcribePosting(db, ai, user.id, checked.value);
  if (!result.ok) return { ok: false, message: IMAGE_MESSAGES[result.reason] ?? IMAGE_MESSAGES.unavailable };
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
