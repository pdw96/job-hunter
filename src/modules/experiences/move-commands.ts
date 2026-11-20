import type { Db } from "@/db/types";
import type { AiClient } from "@/modules/ai/client";
import { OVER_LIMIT_MESSAGE, runNextMove } from "./move";
import { failPendingMoves, type MoveProgress, moveProgress, planMoves, resetMoves, retryMove } from "./move-repo";
import type { SimpleResult } from "./record-commands";
import { newRecordsOn } from "./switch";

// 옮기기 화면의 서버 액션이 하는 일. 스위치 확인과 사용자에게 보일 문구를 여기서 정한다.

export type MoveNextResult = { ok: true; progress: MoveProgress } | { ok: false; message: string };

const OFF = "아직 열리지 않은 기능입니다";
const NOT_FOUND = "다시 시도할 기록을 찾을 수 없습니다";

// 한 번에 하나만 옮긴다. 한도에 닿으면 그 행은 failed로 남기고 문구를 돌려줘 화면이 멈추게 한다
export async function moveNext(db: Db, ai: AiClient, userId: string, now: Date = new Date()): Promise<MoveNextResult> {
  if (!newRecordsOn()) return { ok: false, message: OFF };
  await planMoves(db, userId);
  const before = new Set((await moveProgress(db, userId)).failed.map((item) => item.id));
  const progress = await runNextMove(db, ai, userId, now);
  // 이번 호출에서 새로 실패한 행이 한도 때문이면 알린다(이전에 실패해 둔 행은 다시 알리지 않는다)
  if (progress.failed.some((item) => !before.has(item.id) && item.error === OVER_LIMIT_MESSAGE)) {
    // 남은 것도 같은 까닭으로 실패 처리해, 사용자가 앱에 들어와 나중에 다시 시도할 수 있게 한다
    await failPendingMoves(db, userId, OVER_LIMIT_MESSAGE, now);
    return { ok: false, message: OVER_LIMIT_MESSAGE };
  }
  return { ok: true, progress };
}

export async function retryMoveCommand(db: Db, userId: string, id: string): Promise<SimpleResult> {
  if (!newRecordsOn()) return { ok: false, message: OFF };
  const result = await retryMove(db, userId, id);
  return result.ok ? { ok: true } : { ok: false, message: NOT_FOUND };
}

const IN_USE = "직접 넣은 사례가 옮긴 기록에 딸려 있어 다시 옮길 수 없습니다";
const EDITED = "옮긴 뒤 고치거나 확인한 기록이 있어 다시 옮길 수 없습니다";

// 옮겨서 만든 기록을 지우고 옮기기를 처음부터 다시 하게 한다(다시 옮기기는 /moving이 한다)
export async function resetMovesCommand(db: Db, userId: string): Promise<SimpleResult> {
  if (!newRecordsOn()) return { ok: false, message: OFF };
  const result = await resetMoves(db, userId);
  return result.ok ? { ok: true } : { ok: false, message: result.reason === "edited" ? EDITED : IN_USE };
}
