import type { Db } from "@/db/types";
import type { ClaimAnswer } from "./claims-repo";
import { confirmFact, createFact, deleteFact, getFact, setFactTrackScope, unconfirmFact, updateFact } from "./facts-repo";
import { SCOPES, type Scope } from "./options";
import { answerRecordClaim } from "./record-claims-repo";
import { validateFact } from "./record-input";
import { FACT_KINDS, type FactKind } from "./record-options";
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
