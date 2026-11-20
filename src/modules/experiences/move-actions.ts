"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { requireUser } from "@/lib/session";
import { ai } from "@/modules/ai/provider";
import { type MoveNextResult, moveNext, resetMovesCommand, retryMoveCommand } from "./move-commands";
import type { SimpleResult } from "./record-commands";

// 로그인한 사용자 id만 쓴다. 일은 move-commands.ts가 한다.

export async function moveNextAction(): Promise<MoveNextResult> {
  const user = await requireUser();
  const result = await moveNext(db, ai, user.id);
  // 새 구조 화면은 옮긴 뒤 다시 읽는다
  if (result.ok && result.progress.pending === 0) {
    revalidatePath("/records");
    revalidatePath("/records/scenes");
  }
  return result;
}

export async function retryMoveAction(id: string): Promise<SimpleResult> {
  const user = await requireUser();
  const result = await retryMoveCommand(db, user.id, id);
  if (result.ok) revalidatePath("/moving");
  return result;
}

// 성공하면 화면이 /moving으로 전체를 새로 불러 들어간다
export async function resetMovesAction(): Promise<SimpleResult> {
  const user = await requireUser();
  const result = await resetMovesCommand(db, user.id);
  if (result.ok) {
    revalidatePath("/records");
    revalidatePath("/records/scenes");
  }
  return result;
}
