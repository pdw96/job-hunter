import type { Db } from "@/db/types";
import type { DocumentKind } from "@/modules/postings/options";
import { getPosting, setChosenDocuments } from "@/modules/postings/repo";
import { addQuestions } from "./repo";
import { editBlock, withEditLock } from "./submission-repo";

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
