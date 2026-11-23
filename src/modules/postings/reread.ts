import type { Db } from "@/db/types";
import type { AiClient, AiFailure } from "@/modules/ai/client";
import type { Found } from "./documents";
import { extractPosting } from "./extract";
import { getPosting, saveFound } from "./repo";

// 저장된 원문을 AI로 다시 읽어 제출 서류와 자소서 문항만 새로 저장한다. 회사·마감 같은 다른 값은 건드리지 않는다.
// 읽은 원문이 저장될 때도 그대로일 때만 쓴다(그사이 고쳤으면 changed)
export async function rereadPosting(
  db: Db,
  ai: AiClient,
  userId: string,
  id: string,
  today: string, // YYYY-MM-DD
  now: Date = new Date(),
): Promise<{ ok: true; found: Found } | { ok: false; reason: "not_found" | "changed" | "over_limit" | AiFailure }> {
  const posting = await getPosting(db, userId, id);
  if (!posting) return { ok: false, reason: "not_found" };
  const extracted = await extractPosting(db, ai, userId, posting.rawText, today, now);
  if (!extracted.ok) return extracted;
  const found: Found = { documents: extracted.value.documents, questions: extracted.value.questions };
  const saved = await saveFound(db, userId, id, found, { rawText: posting.rawText });
  return saved.ok ? { ok: true, found } : saved;
}
