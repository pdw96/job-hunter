import type { Db } from "@/db/types";
import type { AiClient } from "@/modules/ai/client";
import type { ClaimAnswer } from "./claims-repo";
import { confirmFact, createFact, deleteFact, getFact, setFactTrackScope, unconfirmFact, updateFact } from "./facts-repo";
import { finishInterview } from "./interview";
import { RUBRIC_ITEMS, type RubricItem, SCOPES, type Scope } from "./options";
import { answerRecordClaim } from "./record-claims-repo";
import { validateFact, validateScene } from "./record-input";
import { FACT_KINDS, type FactKind } from "./record-options";
import { approveScenePhrase, dismissScenePhrase, judgeScene } from "./scene-judge";
import {
  closeSceneRubricItem,
  confirmScene,
  createScene,
  deleteScene,
  getScene,
  reopenSceneRubricItem,
  setSceneTrackScope,
  unconfirmScene,
  updateScene,
} from "./scenes-repo";
import { newRecordsOn } from "./switch";

// 이력 사실 화면의 서버 액션이 하는 일. 스위치 확인, 검사, 저장, 사용자에게 보일 문구를 여기서 정한다.
// record-actions.ts는 로그인 확인과 화면 갱신만 덧붙인다.

export type SimpleResult = { ok: true } | { ok: false; message: string };
export type SaveFactResult = { ok: true; id: string } | { ok: false; errors: Record<string, string>; message?: string };

const OFF = "아직 열리지 않은 기능입니다";
const NOT_FOUND = "기록을 찾을 수 없습니다";
const CLAIM_ANSWERS: readonly ClaimAnswer[] = ["confirm", "unknown", "exaggerated", "wrong"];

const isKind = (kind: unknown): kind is FactKind => (FACT_KINDS as readonly unknown[]).includes(kind);
const isScopes = (value: unknown): value is Record<string, Scope> =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  Object.values(value).every((scope) => (SCOPES as readonly unknown[]).includes(scope));

export async function saveFact(
  db: Db,
  userId: string,
  kind: FactKind,
  id: string | null,
  input: unknown,
  scopes: unknown,
): Promise<SaveFactResult> {
  if (!newRecordsOn()) return { ok: false, errors: {}, message: OFF };
  if (!isKind(kind)) return { ok: false, errors: {}, message: NOT_FOUND };
  const parsed = validateFact(kind, input);
  if (!parsed.ok) return { ok: false, errors: parsed.errors };
  if (!isScopes(scopes)) return { ok: false, errors: {}, message: "트랙별 사용 범위를 다시 골라 주세요" };

  const notFound = kind === "project" ? "소속을 찾을 수 없습니다" : NOT_FOUND;
  let savedId: string;
  if (typeof id === "string") {
    const result = await updateFact(db, userId, kind, id, parsed.value as never);
    // 프로젝트는 소속이 없는 경우와 기록이 없는 경우를 같은 결과로 돌려받는다. 기록이 있는지 다시 확인한다
    if (!result.ok) return { ok: false, errors: {}, message: kind === "project" && (await exists(db, userId, kind, id)) ? notFound : NOT_FOUND };
    savedId = id;
  } else {
    const created = await createFact(db, userId, kind, parsed.value as never);
    if (!created.ok) return { ok: false, errors: {}, message: notFound };
    savedId = created.id;
  }
  // 남의 트랙 id가 섞여 있으면 그 줄은 저장되지 않는다(setFactTrackScope가 거부한다)
  for (const [trackId, scope] of Object.entries(scopes)) {
    await setFactTrackScope(db, userId, kind, savedId, trackId, scope);
  }
  return { ok: true, id: savedId };
}

async function exists(db: Db, userId: string, kind: FactKind, id: string): Promise<boolean> {
  return (await getFact(db, userId, kind, id)) !== null;
}

export async function deleteFactCommand(db: Db, userId: string, kind: FactKind, id: string): Promise<SimpleResult> {
  if (!newRecordsOn()) return { ok: false, message: OFF };
  if (!isKind(kind) || typeof id !== "string") return { ok: false, message: NOT_FOUND };
  const result = await deleteFact(db, userId, kind, id);
  if (result.ok) return { ok: true };
  if (result.reason === "has_scenes") {
    return { ok: false, message: `장면 ${result.count}개가 있습니다. 장면을 먼저 지우거나 다른 곳으로 옮겨 주세요` };
  }
  return { ok: false, message: NOT_FOUND };
}

export async function setFactConfirmed(db: Db, userId: string, kind: FactKind, id: string, confirmed: boolean): Promise<SimpleResult> {
  if (!newRecordsOn()) return { ok: false, message: OFF };
  if (!isKind(kind) || typeof id !== "string") return { ok: false, message: NOT_FOUND };
  const result = confirmed ? await confirmFact(db, userId, kind, id) : await unconfirmFact(db, userId, kind, id);
  if (result.ok) return { ok: true };
  return { ok: false, message: result.reason === "claims_pending" ? "줄 확인이 남아 있습니다" : NOT_FOUND };
}

export async function answerClaimCommand(db: Db, userId: string, claimId: string, answer: ClaimAnswer): Promise<SimpleResult> {
  if (!newRecordsOn()) return { ok: false, message: OFF };
  if (typeof claimId !== "string" || !CLAIM_ANSWERS.includes(answer)) return { ok: false, message: NOT_FOUND };
  const result = await answerRecordClaim(db, userId, claimId, answer);
  if (result.ok) return { ok: true };
  if (result.reason === "not_found") return { ok: false, message: NOT_FOUND };
  return {
    ok: false,
    message:
      result.reason === "banned_full"
        ? "쓰면 안 되는 표현이 가득 찼습니다. 고치기에서 하나를 지우고 저장한 뒤 다시 눌러 주세요"
        : "이 줄에는 그 답을 할 수 없습니다",
  };
}

// ---- 경험 사례(장면) ----

export type SaveSceneResult = { ok: true; id: string } | { ok: false; errors: Record<string, string>; message?: string };

const HEAD_NOT_FOUND = "회사·프로젝트·활동을 찾을 수 없습니다";
const AI_MESSAGES: Record<string, string> = {
  not_found: NOT_FOUND,
  over_limit: "이번 달 AI 사용 한도에 닿았습니다. 다음 달에 다시 쓸 수 있습니다",
  refused: "AI가 이 요청을 처리하지 못했습니다. 내용을 조금 바꿔 다시 시도해 주세요",
  truncated: "AI의 답이 중간에 끊겼습니다. 다시 시도해 주세요",
  invalid: "AI의 답을 읽지 못했습니다. 다시 시도해 주세요",
  unavailable: "AI 서비스에 연결하지 못했습니다. 잠시 뒤 다시 시도해 주세요",
  changed: "판정하는 사이 내용이 바뀌었습니다. 다시 판정받아 주세요",
};

// 인터뷰로 만든 초안이면 인터뷰를 끝내고 판정을 한 번 돌린다. 판정이 실패해도 저장은 그대로 둔다
export async function saveScene(
  db: Db,
  ai: AiClient,
  userId: string,
  id: string | null,
  input: unknown,
  scopes: unknown,
  interviewId?: string,
): Promise<SaveSceneResult> {
  if (!newRecordsOn()) return { ok: false, errors: {}, message: OFF };
  const parsed = validateScene(input);
  if (!parsed.ok) return { ok: false, errors: parsed.errors as Record<string, string> };
  if (!isScopes(scopes)) return { ok: false, errors: {}, message: "트랙별 사용 범위를 다시 골라 주세요" };

  let savedId: string;
  if (typeof id === "string") {
    const result = await updateScene(db, userId, id, parsed.value);
    if (!result.ok) return { ok: false, errors: {}, message: (await getScene(db, userId, id)) ? HEAD_NOT_FOUND : NOT_FOUND };
    savedId = id;
  } else {
    const created = await createScene(db, userId, parsed.value, interviewId ? { source: "interview" } : {});
    if (!created.ok) return { ok: false, errors: {}, message: HEAD_NOT_FOUND };
    savedId = created.id;
  }
  for (const [trackId, scope] of Object.entries(scopes)) {
    await setSceneTrackScope(db, userId, savedId, trackId, scope);
  }
  if (typeof interviewId === "string") {
    await finishInterview(db, userId, interviewId);
    await judgeScene(db, ai, userId, savedId).catch(() => undefined);
  }
  return { ok: true, id: savedId };
}

export async function deleteSceneCommand(db: Db, userId: string, id: string): Promise<SimpleResult> {
  if (!newRecordsOn()) return { ok: false, message: OFF };
  if (typeof id !== "string") return { ok: false, message: NOT_FOUND };
  return (await deleteScene(db, userId, id)).ok ? { ok: true } : { ok: false, message: NOT_FOUND };
}

export async function confirmSceneCommand(db: Db, userId: string, id: string, withHead: boolean): Promise<SimpleResult> {
  if (!newRecordsOn()) return { ok: false, message: OFF };
  if (typeof id !== "string") return { ok: false, message: NOT_FOUND };
  const result = await confirmScene(db, userId, id, { withHead: withHead === true });
  if (result.ok) return { ok: true };
  if (result.reason === "head_claims_pending") return { ok: false, message: "회사 정보에 줄 확인이 남아 있습니다" };
  if (result.reason === "claims_pending") return { ok: false, message: "확인할 주장이 남아 있습니다. 먼저 주장을 확인해 주세요" };
  return { ok: false, message: NOT_FOUND };
}

export async function unconfirmSceneCommand(db: Db, userId: string, id: string): Promise<SimpleResult> {
  if (!newRecordsOn()) return { ok: false, message: OFF };
  if (typeof id !== "string") return { ok: false, message: NOT_FOUND };
  return (await unconfirmScene(db, userId, id)).ok ? { ok: true } : { ok: false, message: NOT_FOUND };
}

export async function judgeSceneCommand(db: Db, ai: AiClient, userId: string, id: string): Promise<SimpleResult> {
  if (!newRecordsOn()) return { ok: false, message: OFF };
  if (typeof id !== "string") return { ok: false, message: NOT_FOUND };
  const result = await judgeScene(db, ai, userId, id);
  return result.ok ? { ok: true } : { ok: false, message: AI_MESSAGES[result.reason] ?? "문제가 생겼습니다. 다시 시도해 주세요" };
}

export async function setSceneRubricClosed(db: Db, userId: string, id: string, item: RubricItem, closed: boolean): Promise<SimpleResult> {
  if (!newRecordsOn()) return { ok: false, message: OFF };
  if (typeof id !== "string" || !RUBRIC_ITEMS.includes(item)) return { ok: false, message: NOT_FOUND };
  const result = closed ? await closeSceneRubricItem(db, userId, id, item) : await reopenSceneRubricItem(db, userId, id, item);
  if (result.ok) return { ok: true };
  return { ok: false, message: result.reason === "not_allowed" ? "이 항목은 닫을 수 없습니다" : NOT_FOUND };
}

export async function decideScenePhrase(db: Db, userId: string, id: string, phrase: string, approve: boolean): Promise<SimpleResult> {
  if (!newRecordsOn()) return { ok: false, message: OFF };
  if (typeof id !== "string" || typeof phrase !== "string") return { ok: false, message: NOT_FOUND };
  const result = approve ? await approveScenePhrase(db, userId, id, phrase) : await dismissScenePhrase(db, userId, id, phrase);
  return result.ok ? { ok: true } : { ok: false, message: "후보를 찾을 수 없습니다" };
}
