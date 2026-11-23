"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { requireUser } from "@/lib/session";
import type { AiFailure } from "@/modules/ai/client";
import { ai } from "@/modules/ai/provider";
import { DOCUMENT_KINDS, type DocumentKind } from "@/modules/postings/options";
import { todayInKorea } from "@/modules/postings/today";
import { chooseDocuments, rereadAndSeed } from "./documents";

// 모든 액션은 requireUser()로 얻은 userId만 쓴다. 끝나면 공고 화면과 자소서 화면을 다시 그리게 한다.

type Result = { ok: true } | { ok: false; message: string };

const MESSAGES = {
  not_found: "공고를 찾을 수 없습니다",
  not_apply: "지원으로 고른 공고에서만 서류를 고를 수 있습니다",
  submitted: "제출한 뒤에는 고칠 수 없습니다. 공고 화면에서 새 버전 만들기를 누른 뒤 고쳐 주세요",
  changed: "다시 읽는 사이 공고가 바뀌었습니다. 다시 눌러 주세요",
  too_many: "문항은 공고마다 10개까지 넣을 수 있습니다",
  bad_kinds: "서류를 확인해 주세요",
} as const;

const AI_MESSAGES: Record<"over_limit" | AiFailure, string> = {
  over_limit: "이번 달 AI 사용 한도에 닿았습니다. 다음 달에 다시 읽을 수 있습니다",
  refused: "AI가 이 공고를 읽지 못했습니다. 다시 시도해 주세요",
  truncated: "AI의 답이 중간에 끊겼습니다. 다시 시도해 주세요",
  invalid: "AI의 답을 읽지 못했습니다. 다시 시도해 주세요",
  unavailable: "AI 서비스에 연결하지 못했습니다. 잠시 뒤 다시 시도해 주세요",
};

const messageOf = (reason: string) =>
  (MESSAGES as Record<string, string>)[reason] ?? (AI_MESSAGES as Record<string, string>)[reason] ?? AI_MESSAGES.unavailable;

function refresh(id: string) {
  revalidatePath(`/postings/${id}`);
  revalidatePath(`/postings/${id}/application`);
}

// 공고 원문을 AI로 다시 읽어 제출 서류와 문항을 새로 찾는다. 지원 공고에 문항이 하나도 없으면 찾은 문항을 넣는다
export async function rereadPostingAction(id: string): Promise<Result> {
  const user = await requireUser();
  if (typeof id !== "string") return { ok: false, message: MESSAGES.not_found };
  const result = await rereadAndSeed(db, ai, user.id, id, todayInKorea());
  if (!result.ok) return { ok: false, message: messageOf(result.reason) };
  refresh(id);
  return { ok: true };
}

// 낼 서류를 고른다. 목록 밖 값은 받지 않는다
export async function chooseDocumentsAction(id: string, kinds: unknown): Promise<Result> {
  const user = await requireUser();
  if (typeof id !== "string") return { ok: false, message: MESSAGES.not_found };
  if (!Array.isArray(kinds) || !kinds.every((kind) => DOCUMENT_KINDS.includes(kind as DocumentKind))) {
    return { ok: false, message: MESSAGES.bad_kinds };
  }
  const result = await chooseDocuments(db, user.id, id, kinds as DocumentKind[]);
  if (!result.ok) return { ok: false, message: messageOf(result.reason) };
  refresh(id);
  return { ok: true };
}
