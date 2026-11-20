import type { Db } from "@/db/types";
import type { AiClient } from "@/modules/ai/client";
import { OVER_LIMIT_MESSAGE, runNextMove } from "./move";
import { type MoveProgress, moveProgress, planMoves, retryMove } from "./move-repo";
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
    return { ok: false, message: OVER_LIMIT_MESSAGE };
  }
  return { ok: true, progress };
}

export async function retryMoveCommand(db: Db, userId: string, id: string): Promise<SimpleResult> {
  if (!newRecordsOn()) return { ok: false, message: OFF };
  const result = await retryMove(db, userId, id);
  return result.ok ? { ok: true } : { ok: false, message: NOT_FOUND };
}
