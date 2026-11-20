"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { requireUser } from "@/lib/session";
import type { ClaimAnswer } from "./claims-repo";
import {
  answerClaimCommand,
  deleteFactCommand,
  type SaveFactResult,
  type SimpleResult,
  saveFact,
  setFactConfirmed,
} from "./record-commands";
import type { FactKind } from "./record-options";

// 로그인한 사용자 id만 쓴다. 일은 record-commands.ts가 하고, 여기서는 성공하면 화면을 새로 읽게 한다.

function refresh<T extends { ok: boolean }>(result: T): T {
  if (result.ok) {
    revalidatePath("/records");
    revalidatePath("/records/scenes");
  }
  return result;
}

export async function saveFactAction(kind: FactKind, id: string | null, input: unknown, scopes: unknown): Promise<SaveFactResult> {
  const user = await requireUser();
  return refresh(await saveFact(db, user.id, kind, id, input, scopes));
}

export async function deleteFactAction(kind: FactKind, id: string): Promise<SimpleResult> {
  const user = await requireUser();
  return refresh(await deleteFactCommand(db, user.id, kind, id));
}

export async function setFactConfirmedAction(kind: FactKind, id: string, confirmed: boolean): Promise<SimpleResult> {
  const user = await requireUser();
  return refresh(await setFactConfirmed(db, user.id, kind, id, confirmed));
}

export async function answerRecordClaimAction(claimId: string, answer: ClaimAnswer): Promise<SimpleResult> {
  const user = await requireUser();
  return refresh(await answerClaimCommand(db, user.id, claimId, answer));
}
