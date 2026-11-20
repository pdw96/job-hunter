"use server";

import { db } from "@/db";
import { requireAdmin, requireUser } from "@/lib/session";
import { ai } from "@/modules/ai/provider";
import { runApplicationCheck } from "@/modules/applications/prompt-check";
import { runResumeCheck } from "@/modules/applications/resume-prompt-check";
import { runPostingCheck } from "@/modules/postings/prompt-check";
import type { ExperienceErrors, ExperienceInput } from "./input";
import type { DraftWarnings } from "./interview";
import type { CheckRow } from "./prompt-check";
import { runRecordCheck } from "./record-prompt-check";

// 옛 경험 기록(experiences_experiences)의 쓰기 액션. 5-4에서 새 구조로 바꾼 뒤로는 아무것도 쓰지 않고 안내만 돌려준다.
// 옛 화면은 /records로 보내지만, 어디서 불려도 옛 표가 바뀌지 않게 이름은 남겨 둔다(받는 값은 보지 않는다).
// 옛 표는 옮기기(move.ts)가 읽으므로 지우지 않는다.

const CLOSED = "경험 기록이 새 구조로 바뀌었습니다";

type SaveResult = { ok: true; id: string; value: ExperienceInput } | { ok: false; errors: ExperienceErrors; message?: string };
type SimpleResult = { ok: true } | { ok: false; message: string };
type AiTurnResult = { ok: true; message: string; suggestFinish: boolean } | { ok: false; message: string };
type DraftResult = { ok: true; draft: ExperienceInput; warnings: DraftWarnings } | { ok: false; message: string };
export type ImportActionResult =
  | { ok: true; created: { id: string; name: string; claimCount: number; trimmed: boolean }[]; skipped: number; more: boolean }
  | { ok: false; message: string; stop?: boolean; empty?: boolean };

// 로그인은 그대로 확인하고(남이 부르지 못하게), 받은 값은 보지 않는다
async function refuse(): Promise<{ ok: false; message: string }> {
  await requireUser();
  return { ok: false, message: CLOSED };
}

export async function saveExperienceAction(): Promise<SaveResult> {
  return { ...(await refuse()), errors: {} };
}
export async function deleteExperienceAction(): Promise<SimpleResult> {
  return refuse();
}
export async function setConfirmedAction(): Promise<SimpleResult> {
  return refuse();
}
export async function setRubricClosedAction(): Promise<SimpleResult> {
  return refuse();
}
export async function judgeAction(): Promise<SimpleResult> {
  return refuse();
}
export async function decidePhraseAction(): Promise<SimpleResult> {
  return refuse();
}
export async function startInterviewAction(): Promise<SimpleResult> {
  return refuse();
}
export async function startExperienceInterviewAction(): Promise<SimpleResult> {
  return refuse();
}
export async function answerInterviewAction(): Promise<AiTurnResult> {
  return refuse();
}
export async function draftInterviewAction(): Promise<DraftResult> {
  return refuse();
}
export async function importAction(): Promise<ImportActionResult> {
  return refuse();
}
export async function answerClaimAction(): Promise<SimpleResult> {
  return refuse();
}

// 관리자 전용. 준비한 예시를 실제 AI에 돌려 프롬프트가 기대대로 동작하는지 본다(호출 13번, 비용 발생)
export async function runPromptCheckAction(): Promise<
  { ok: true; rows: CheckRow[] } | { ok: false; message: string }
> {
  const admin = await requireAdmin();
  // 새 기록 구조(사례 정리·가져오기·옮기기), 공고에서 값을 뽑는 프롬프트, 자소서 고르기·쓰기, 이력서 쓰기·강조 고르기를 점검한다
  const [recordRows, postingRows, applicationRows, resumeRows] = await Promise.all([
    runRecordCheck(db, ai, admin.id),
    runPostingCheck(db, ai, admin.id),
    runApplicationCheck(db, ai, admin.id),
    runResumeCheck(db, ai, admin.id),
  ]);
  return { ok: true, rows: [...recordRows, ...postingRows, ...applicationRows, ...resumeRows] };
}
