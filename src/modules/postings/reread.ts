import type { Db } from "@/db/types";
import type { AiClient, AiFailure } from "@/modules/ai/client";
import type { Found } from "./documents";
import { extractPosting } from "./extract";
import { getPosting, saveFound } from "./repo";

type Failure = { ok: false; reason: "not_found" | "changed" | "over_limit" | AiFailure };

// 저장된 원문을 AI로 읽어 서류와 문항을 돌려준다. 저장하지 않는다. readAs는 읽은 원문
export async function readFound(
  db: Db,
  ai: AiClient,
  userId: string,
  id: string,
  today: string, // YYYY-MM-DD
  now: Date = new Date(),
): Promise<{ ok: true; found: Found; readAs: { rawText: string } } | Failure> {
  const posting = await getPosting(db, userId, id);
  if (!posting) return { ok: false, reason: "not_found" };
  const extracted = await extractPosting(db, ai, userId, posting.rawText, today, now);
  if (!extracted.ok) return extracted;
  const found: Found = { documents: extracted.value.documents, questions: extracted.value.questions };
  return { ok: true, found, readAs: { rawText: posting.rawText } };
}

// 저장된 원문을 AI로 다시 읽어 제출 서류와 자소서 문항만 새로 저장한다. 회사·마감 같은 다른 값은 건드리지 않는다.
// 읽은 원문이 저장될 때도 그대로일 때만 쓴다(그사이 고쳤으면 changed)
export async function rereadPosting(
  db: Db,
  ai: AiClient,
  userId: string,
  id: string,
  today: string,
  now: Date = new Date(),
): Promise<{ ok: true; found: Found } | Failure> {
  const read = await readFound(db, ai, userId, id, today, now);
  if (!read.ok) return read;
  const saved = await saveFound(db, userId, id, read.found, read.readAs);
  return saved.ok ? { ok: true, found: read.found } : saved;
}
