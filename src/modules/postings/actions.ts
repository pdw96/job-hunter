"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { requireUser } from "@/lib/session";
import type { AiFailure, AiImage } from "@/modules/ai/client";
import { ai } from "@/modules/ai/provider";
import { analyzePosting } from "./analyze";
import { applyWithCurrentScore } from "./apply";
import { type ExtractedPosting, extractPosting } from "./extract";
// 로컬 미리보기에서는 next.config.ts가 이 파일을 src/dev/local-fetch-page.ts로 바꿔 끼운다
import { fetchPosting } from "@/modules/postings/fetch-page";
import { seedQuestionsFromPosting } from "@/modules/applications/documents";
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
// forceImages: 읽힌 글이 사이트 안내뿐이었을 때, 본문의 그림을 가져오려고 다시 부른다
export async function fetchPostingAction(
  url: string,
  forceImages = false,
): Promise<{ ok: true; text: string; images: AiImage[] } | { ok: false; message: string }> {
  await requireUser();
  if (typeof url !== "string" || url.length > POSTING_LIMITS.url) return { ok: false, message: FETCH_MESSAGES.bad_url };
  const result = await fetchPosting(url, undefined, { forceImages: forceImages === true });
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
  options: { id?: string; force?: boolean; found?: unknown } = {},
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
  // 값 뽑기 때 찾은 서류와 문항(브라우저가 보낸 값). createPosting이 저장할 원문으로 다시 검사한다
  const created = await createPosting(db, user.id, trackId, checked.value, options.found ?? undefined);
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

// 점수 보기용. 값 뽑기와 달리 직접 채울 값이 없으므로 다시 시도하라고만 한다
const SCORE_MESSAGES: Record<"over_limit" | AiFailure, string> = {
  over_limit: "이번 달 AI 사용 한도에 닿았습니다. 다음 달에 다시 볼 수 있습니다",
  refused: "AI가 이 공고를 읽지 못했습니다. 다시 시도해 주세요",
  truncated: "AI의 답이 중간에 끊겼습니다. 다시 시도해 주세요",
  invalid: "AI의 답을 읽지 못했습니다. 다시 시도해 주세요",
  unavailable: "AI 서비스에 연결하지 못했습니다. 잠시 뒤 다시 시도해 주세요",
};

// 공고의 요구 사항을 뽑고 경험과 맞댄다(AI 호출 1번). 점수는 화면이 그릴 때 계산한다
export async function analyzePostingAction(id: string): Promise<SimpleResult> {
  const user = await requireUser();
  if (typeof id !== "string") return { ok: false, message: NOT_FOUND };
  const result = await analyzePosting(db, ai, user.id, id);
  if (!result.ok) {
    if (result.reason === "not_found") return { ok: false, message: NOT_FOUND };
    if (result.reason === "changed") return { ok: false, message: "점수를 보는 사이 공고가 바뀌었습니다. 다시 눌러 주세요" };
    return { ok: false, message: SCORE_MESSAGES[result.reason] };
  }
  refresh(id);
  return { ok: true };
}

// 지원으로 정한다. 점수는 브라우저에서 받지 않고 서버가 지금 다시 계산해 남긴다
export async function applyToPostingAction(id: string): Promise<SimpleResult> {
  const user = await requireUser();
  if (typeof id !== "string") return { ok: false, message: NOT_FOUND };
  const result = await applyWithCurrentScore(db, user.id, id);
  if (!result.ok) {
    if (result.reason === "no_analysis") return { ok: false, message: "먼저 점수를 봐 주세요" };
    if (result.reason === "changed") return { ok: false, message: "공고가 바뀌었습니다. 점수를 다시 확인한 뒤 지원해 주세요" };
    return { ok: false, message: NOT_FOUND };
  }
  // 문항 채우기가 안 돼도 지원은 성공이다(공고 화면에서 다시 읽기로 채울 수 있다)
  await seedQuestionsFromPosting(db, user.id, id).catch(() => undefined);
  refresh(id);
  return { ok: true };
}

// 관심·보류·제외로 바꾼다. 지원에서 관심으로 되돌릴 때도 쓴다(지원할 때의 점수는 남겨 둔다)
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
