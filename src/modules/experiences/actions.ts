"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { requireAdmin, requireUser } from "@/lib/session";
import { ai } from "@/modules/ai/provider";
import { answerClaim, type ClaimAnswer } from "./claims-repo";
import { importExperiences } from "./import";
import { extractText, prepareSource } from "./import-text";
import { type ExperienceErrors, type ExperienceInput, validateExperience } from "./input";
import {
  answerInterview,
  type DraftWarnings,
  draftFromInterview,
  finishInterview,
  startInterview,
} from "./interview";
import { approvePhrase, dismissPhrase, judgeExperience } from "./judge";
import { RUBRIC_ITEMS, type RubricItem, SCOPES, type Scope } from "./options";
import { type CheckRow, runPromptCheck } from "./prompt-check";
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
// interviewId가 있으면 인터뷰로 만든 초안을 저장하는 것이다. 인터뷰를 끝내고 AI 판정을 한 번 돌린다
export async function saveExperienceAction(
  id: string | null,
  input: unknown,
  scopes: unknown,
  interviewId?: string,
): Promise<SaveResult> {
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
  if (typeof interviewId === "string") {
    await finishInterview(db, user.id, interviewId);
    // 판정이 실패해도(한도, 일시 오류) 저장은 된 것이다. 사용자가 나중에 다시 누를 수 있다
    await judgeExperience(db, ai, user.id, savedId);
  }
  refresh(savedId);
  return { ok: true, id: savedId, value: parsed.value };
}

// stay가 false가 아니면 지운 뒤 목록으로 이동한다(가져오기 결과 화면에서는 그 자리에 머문다)
export async function deleteExperienceAction(id: string, goToList = true): Promise<SimpleResult> {
  const user = await requireUser();
  const result = typeof id === "string" ? await deleteExperience(db, user.id, id) : { ok: false as const };
  if (!result.ok) return { ok: false, message: NOT_FOUND };
  refresh(id);
  if (goToList !== false) redirect("/experiences");
  return { ok: true };
}

export async function setConfirmedAction(id: string, confirmed: boolean): Promise<SimpleResult> {
  const user = await requireUser();
  if (typeof id !== "string") return { ok: false, message: NOT_FOUND };
  const result = confirmed ? await confirmExperience(db, user.id, id) : await unconfirmExperience(db, user.id, id);
  if (!result.ok) {
    return {
      ok: false,
      message: result.reason === "claims_pending" ? "확인할 주장이 남아 있습니다. 먼저 주장을 확인해 주세요" : NOT_FOUND,
    };
  }
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

// AI 기능의 실패 사유를 화면에 보여 줄 글로 바꾼다
const AI_MESSAGES: Record<string, string> = {
  not_found: NOT_FOUND,
  over_limit: "이번 달 AI 사용 한도에 닿았습니다. 다음 달에 다시 쓸 수 있습니다",
  refused: "AI가 이 요청을 처리하지 못했습니다. 내용을 조금 바꿔 다시 시도해 주세요",
  truncated: "AI의 답이 중간에 끊겼습니다. 다시 시도해 주세요",
  invalid: "AI의 답을 읽지 못했습니다. 다시 시도해 주세요",
  unavailable: "AI 서비스에 연결하지 못했습니다. 잠시 뒤 다시 시도해 주세요",
  changed: "판정하는 사이 내용이 바뀌었습니다. 다시 판정받아 주세요",
  finished: "이미 끝난 인터뷰입니다",
  too_long: "인터뷰가 너무 길어졌습니다. 지금까지의 내용으로 정리해 주세요",
  invalid_text: "답을 입력해 주세요 (4,000자까지)",
  busy: "앞의 답을 처리하는 중입니다. 잠시 뒤 다시 보내 주세요",
  empty: "아직 답한 내용이 없습니다",
  nothing_found: "경험으로 나눌 만한 내용을 찾지 못했습니다",
};
const aiMessage = (reason: string) => AI_MESSAGES[reason] ?? "문제가 생겼습니다. 다시 시도해 주세요";

export async function judgeAction(id: string): Promise<SimpleResult> {
  const user = await requireUser();
  if (typeof id !== "string") return { ok: false, message: NOT_FOUND };
  const result = await judgeExperience(db, ai, user.id, id);
  refresh(id);
  return result.ok ? { ok: true } : { ok: false, message: aiMessage(result.reason) };
}

export async function decidePhraseAction(id: string, phrase: string, approve: boolean): Promise<SimpleResult> {
  const user = await requireUser();
  if (typeof id !== "string" || typeof phrase !== "string") return { ok: false, message: NOT_FOUND };
  const result = approve ? await approvePhrase(db, user.id, id, phrase) : await dismissPhrase(db, user.id, id, phrase);
  refresh(id);
  return result.ok ? { ok: true } : { ok: false, message: "후보를 찾을 수 없습니다" };
}

// 성공하면 인터뷰 화면으로 이동한다
export async function startInterviewAction(options: {
  experienceId?: string;
  trackId?: string;
}): Promise<SimpleResult> {
  const user = await requireUser();
  const experienceId = typeof options?.experienceId === "string" ? options.experienceId : undefined;
  const trackId = typeof options?.trackId === "string" && options.trackId !== "" ? options.trackId : undefined;
  const result = await startInterview(db, ai, user.id, { experienceId, trackId });
  if (!result.ok) return { ok: false, message: aiMessage(result.reason) };
  redirect(`/experiences/interview/${result.id}`);
}

export async function answerInterviewAction(
  interviewId: string,
  text: string,
): Promise<{ ok: true; message: string; suggestFinish: boolean } | { ok: false; message: string }> {
  const user = await requireUser();
  if (typeof interviewId !== "string" || typeof text !== "string") return { ok: false, message: NOT_FOUND };
  const result = await answerInterview(db, ai, user.id, interviewId, text);
  return result.ok ? result : { ok: false, message: aiMessage(result.reason) };
}

export async function draftInterviewAction(
  interviewId: string,
): Promise<{ ok: true; draft: ExperienceInput; warnings: DraftWarnings } | { ok: false; message: string }> {
  const user = await requireUser();
  if (typeof interviewId !== "string") return { ok: false, message: NOT_FOUND };
  const result = await draftFromInterview(db, ai, user.id, interviewId);
  return result.ok
    ? { ok: true, draft: result.draft, warnings: result.warnings }
    : { ok: false, message: aiMessage(result.reason) };
}

// 관리자 전용. 준비한 예시를 실제 AI에 돌려 프롬프트가 기대대로 동작하는지 본다(호출 8번, 비용 발생)
export async function runPromptCheckAction(): Promise<
  { ok: true; rows: CheckRow[] } | { ok: false; message: string }
> {
  const admin = await requireAdmin();
  const rows = await runPromptCheck(db, ai, admin.id);
  return { ok: true, rows };
}

const IMPORT_MESSAGES: Record<string, string> = {
  unsupported: "지원하지 않는 파일입니다. PDF, 워드(.docx), 글 파일(.md, .txt, .csv)만 올릴 수 있습니다",
  too_large: "파일이 너무 큽니다. 4MB까지 올릴 수 있습니다",
  no_text: "글자를 읽을 수 없는 파일입니다. 스캔한 PDF는 지원하지 않습니다. 글을 복사해 붙여 넣어 주세요",
  unreadable: "파일을 열 수 없습니다. 파일이 깨졌거나 확장자가 내용과 다릅니다",
  empty: "가져올 글을 붙여 넣거나 파일을 골라 주세요",
  too_long: "글이 너무 깁니다. 4만 자까지 한 번에 가져올 수 있습니다. 나눠서 올려 주세요",
};

export type ImportActionResult =
  | { ok: true; created: { id: string; name: string; claimCount: number }[]; skipped: number; more: boolean }
  | { ok: false; message: string };

// 글(붙여 넣기 또는 파일)을 경험 기록으로 가져온다. 파일은 글자만 뽑고 저장하지 않는다
export async function importAction(formData: FormData): Promise<ImportActionResult> {
  const user = await requireUser();
  const file = formData.get("file");
  let raw = typeof formData.get("text") === "string" ? (formData.get("text") as string) : "";

  if (file instanceof File && file.size > 0) {
    const extracted = await extractText({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
    if (!extracted.ok) return { ok: false, message: IMPORT_MESSAGES[extracted.reason] };
    raw = extracted.text;
  }
  const source = prepareSource(raw);
  if (!source.ok) return { ok: false, message: IMPORT_MESSAGES[source.reason] };

  const result = await importExperiences(db, ai, user.id, source.text);
  if (!result.ok) return { ok: false, message: aiMessage(result.reason) };
  refresh();
  return result;
}

const CLAIM_ANSWERS: ClaimAnswer[] = ["confirm", "unknown", "exaggerated", "wrong"];

export async function answerClaimAction(experienceId: string, claimId: string, answer: ClaimAnswer): Promise<SimpleResult> {
  const user = await requireUser();
  if (typeof claimId !== "string" || !CLAIM_ANSWERS.includes(answer)) return { ok: false, message: NOT_FOUND };
  const result = await answerClaim(db, user.id, claimId, answer);
  if (!result.ok) {
    const message =
      result.reason === "banned_full"
        ? "금지 표현이 가득 찼습니다. 아래 입력 칸에서 하나를 지우고 저장한 뒤 다시 눌러 주세요"
        : "이 주장에는 그 답을 할 수 없습니다";
    return { ok: false, message };
  }
  if (typeof experienceId === "string") refresh(experienceId);
  return { ok: true };
}
