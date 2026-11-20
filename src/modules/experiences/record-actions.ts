"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { requireUser } from "@/lib/session";
import { ai } from "@/modules/ai/provider";
import type { ClaimAnswer } from "./claims-repo";
import type { RubricItem } from "./options";
import type { SceneInput } from "./record-input";
import type { SceneDraftWarnings } from "./scene-interview";
import {
  answerClaimCommand,
  answerSceneInterviewCommand,
  draftSceneCommand,
  type ImportRecordsResult,
  importRecordsCommand,
  startSceneInterviewCommand,
  confirmSceneCommand,
  decideScenePhrase,
  deleteFactCommand,
  deleteSceneCommand,
  judgeSceneCommand,
  type SaveFactResult,
  type SaveSceneResult,
  type SimpleResult,
  saveFact,
  saveScene,
  setFactConfirmed,
  setSceneRubricClosed,
  unconfirmSceneCommand,
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

export async function saveSceneAction(id: string | null, input: unknown, scopes: unknown, interviewId?: string): Promise<SaveSceneResult> {
  const user = await requireUser();
  return refresh(await saveScene(db, ai, user.id, id, input, scopes, interviewId));
}

export async function deleteSceneAction(id: string): Promise<SimpleResult> {
  const user = await requireUser();
  return refresh(await deleteSceneCommand(db, user.id, id));
}

export async function confirmSceneAction(id: string, withHead: boolean): Promise<SimpleResult> {
  const user = await requireUser();
  return refresh(await confirmSceneCommand(db, user.id, id, withHead));
}

export async function setSceneConfirmedAction(id: string, confirmed: boolean): Promise<SimpleResult> {
  return confirmed ? confirmSceneAction(id, false) : unconfirmSceneAction(id);
}

export async function unconfirmSceneAction(id: string): Promise<SimpleResult> {
  const user = await requireUser();
  return refresh(await unconfirmSceneCommand(db, user.id, id));
}

// 판정은 실패해도 화면을 새로 읽게 한다(한도나 변경 같은 이유로 일부 상태가 달라질 수 있다)
export async function judgeSceneAction(id: string): Promise<SimpleResult> {
  const user = await requireUser();
  const result = await judgeSceneCommand(db, ai, user.id, id);
  revalidatePath("/records/scenes");
  return result;
}

export async function setSceneRubricClosedAction(id: string, item: RubricItem, closed: boolean): Promise<SimpleResult> {
  const user = await requireUser();
  return refresh(await setSceneRubricClosed(db, user.id, id, item, closed));
}

export async function decideScenePhraseAction(id: string, phrase: string, approve: boolean): Promise<SimpleResult> {
  const user = await requireUser();
  return refresh(await decideScenePhrase(db, user.id, id, phrase, approve));
}

// 장면 주장 패널용. 주장은 사용자 것인지만 보고 답한다(장면 id는 패널 모양을 맞추려고 받는다)
export async function answerSceneClaimAction(_sceneId: string, claimId: string, answer: ClaimAnswer): Promise<SimpleResult> {
  return answerRecordClaimAction(claimId, answer);
}

// ---- 사례 인터뷰 ----

// 성공하면 인터뷰 화면으로 이동한다. head는 `job:<id>` 모양
export async function startSceneInterviewAction(options: { head?: string; sceneId?: string; trackId?: string }): Promise<SimpleResult> {
  const user = await requireUser();
  const result = await startSceneInterviewCommand(db, ai, user.id, options ?? {});
  if (!result.ok) return result;
  redirect(`/records/interview/${result.id}`);
}

// 사례 화면의 패널이 id만 넘겨 부르는 모양(보완 인터뷰)
export async function startSceneSupplementAction(sceneId: string): Promise<SimpleResult> {
  return startSceneInterviewAction({ sceneId });
}

export async function answerSceneInterviewAction(
  interviewId: string,
  text: string,
): Promise<{ ok: true; message: string; suggestFinish: boolean } | { ok: false; message: string }> {
  const user = await requireUser();
  return answerSceneInterviewCommand(db, ai, user.id, interviewId, text);
}

export async function draftSceneAction(
  interviewId: string,
): Promise<{ ok: true; draft: SceneInput; warnings: SceneDraftWarnings; sceneId: string | null } | { ok: false; message: string }> {
  const user = await requireUser();
  return draftSceneCommand(db, ai, user.id, interviewId);
}

// ---- 새 구조로 가져오기 ----

export async function importRecordsAction(formData: FormData): Promise<ImportRecordsResult> {
  const user = await requireUser();
  const file = formData.get("file");
  const text = formData.get("text");
  const upload = file instanceof File && file.size > 0 ? { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) } : null;
  return refresh(await importRecordsCommand(db, ai, user.id, { text: typeof text === "string" ? text : "", file: upload }));
}
