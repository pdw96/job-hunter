import type { Db } from "@/db/types";
import type { AiClient, AiFailure } from "@/modules/ai/client";
import type { DocumentKind } from "@/modules/postings/options";
import { getPosting, saveFound, setChosenDocuments } from "@/modules/postings/repo";
import { readFound } from "@/modules/postings/reread";
import { addQuestions } from "./repo";
import { editBlock, isLocked, latestSubmission, withEditLock, withPostingLock } from "./submission-repo";

// 공고에서 찾은 문항을 지원 공고의 문항으로 넣고, 낼 서류를 고른다

// 지원 공고이고 찾은 문항이 있고 문항이 하나도 없을 때만 넣는다. 아니면 added 0
// (문항이 없는지는 addQuestions가 공고 잠금 안에서 본다. 두 탭에서 동시에 눌러도 한 번만 들어간다)
export async function seedQuestionsFromPosting(
  db: Db,
  userId: string,
  postingId: string,
): Promise<{ ok: true; added: number } | { ok: false; reason: "not_found" | "submitted" | "too_many" }> {
  const posting = await getPosting(db, userId, postingId);
  if (!posting) return { ok: false, reason: "not_found" };
  if (posting.status !== "apply" || !posting.foundQuestions || posting.foundQuestions.length === 0) return { ok: true, added: 0 };
  const added = await addQuestions(db, userId, postingId, posting.foundQuestions, { onlyIfEmpty: true });
  if (added.ok) return { ok: true, added: added.ids.length };
  // 그사이 지원이 아니게 됐으면 넣을 것이 없다
  return added.reason === "not_apply" ? { ok: true, added: 0 } : { ok: false, reason: added.reason };
}

// 낼 서류를 정한다. 지원 공고에서, 제출로 잠기지 않았을 때만. 확인과 저장을 공고 잠금 안에서 한다
export async function chooseDocuments(
  db: Db,
  userId: string,
  postingId: string,
  kinds: DocumentKind[],
): Promise<{ ok: true } | { ok: false; reason: "not_found" | "not_apply" | "submitted" }> {
  const posting = await getPosting(db, userId, postingId);
  if (!posting) return { ok: false, reason: "not_found" };
  const block = await editBlock(db, userId, posting);
  if (block) return { ok: false, reason: block };
  return withEditLock(db, userId, postingId, (tx) => setChosenDocuments(tx, userId, postingId, kinds));
}

// 공고를 다시 읽는다. 제출로 잠긴 공고는(어떤 판단이든) AI를 부르기 전에 막고, AI가 읽는 사이 제출했으면 저장하지 않는다.
// 저장은 공고 잠금 안에서 잠김을 다시 확인한 뒤 postings의 saveFound로 한다. 지원 공고면 이어서 문항을 채운다
export async function rereadAndSeed(
  db: Db,
  ai: AiClient,
  userId: string,
  id: string,
  today: string,
  now: Date = new Date(),
): Promise<{ ok: true } | { ok: false; reason: "not_found" | "submitted" | "changed" | "over_limit" | "too_many" | AiFailure }> {
  const posting = await getPosting(db, userId, id);
  if (!posting) return { ok: false, reason: "not_found" };
  if (isLocked(await latestSubmission(db, userId, id))) return { ok: false, reason: "submitted" };

  const read = await readFound(db, ai, userId, id, today, now);
  if (!read.ok) return read;
  const saved = await withPostingLock(db, id, async (tx) => {
    if (isLocked(await latestSubmission(tx, userId, id))) return { ok: false as const, reason: "submitted" as const };
    return saveFound(tx, userId, id, read.found, read.readAs);
  });
  if (!saved.ok) return saved;

  // 문항을 못 넣어도(한도 등) 다시 읽기는 성공이다. 지원이 아닌 공고에는 seed가 아무것도 넣지 않는다
  await seedQuestionsFromPosting(db, userId, id);
  return { ok: true };
}
