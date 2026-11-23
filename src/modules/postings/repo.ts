import { randomUUID } from "node:crypto";
import { and, count, eq, ne, sql } from "drizzle-orm";
import type { Db } from "@/db/types";
import { ownsTrack } from "@/modules/tracks/repo";
import type { AppliedScore, PostingAnalysis, PostingScore } from "./analysis";
import { DOCUMENT_KINDS, type DocumentKind, POSTING_LIMITS, type PostingStatus } from "./options";
import type { Found, FoundDocument, FoundQuestion } from "./documents";
import type { PostingInput } from "./input";
import { postings } from "./schema";

// 공고의 저장과 조회. 모든 함수가 userId로 소유자를 확인한다.

export type Posting = PostingInput & {
  id: string;
  trackId: string;
  status: PostingStatus;
  excludeOverride: boolean;
  foundDocuments: FoundDocument[] | null;
  foundQuestions: FoundQuestion[] | null;
  chosenDocuments: DocumentKind[] | null;
  analysis: PostingAnalysis | null;
  appliedScore: AppliedScore | null;
  createdAt: Date;
  updatedAt: Date;
};

type NotFound = { ok: false; reason: "not_found" };

const mine = (userId: string, id: string) => and(eq(postings.id, id), eq(postings.userId, userId));

function toPosting(row: typeof postings.$inferSelect): Posting {
  const { userId: owner, ...rest } = row;
  void owner;
  return rest;
}

export async function createPosting(
  db: Db,
  userId: string,
  trackId: string,
  input: PostingInput,
  found?: Found,
): Promise<{ ok: true; id: string } | { ok: false; reason: "invalid_track" | "too_many" }> {
  // 남의 트랙이나 없는 트랙에는 넣을 수 없다
  if (!(await ownsTrack(db, userId, trackId))) return { ok: false, reason: "invalid_track" };
  const [{ value }] = await db.select({ value: count() }).from(postings).where(eq(postings.userId, userId));
  if (value >= POSTING_LIMITS.perUser) return { ok: false, reason: "too_many" };

  const id = randomUUID();
  await db.insert(postings).values({ id, userId, trackId, ...input, foundDocuments: found?.documents ?? null, foundQuestions: found?.questions ?? null });
  return { ok: true, id };
}

export async function updatePosting(
  db: Db,
  userId: string,
  id: string,
  input: PostingInput,
): Promise<{ ok: true } | NotFound> {
  const updated = await db
    .update(postings)
    // 내용을 고치면 "그래도 진행"은 다시 정하게 한다(사유가 달라졌을 수 있다)
    .set({
      ...input,
      excludeOverride: false,
      // 분석은 원문과 인재상 글을 읽은 결과라서, 둘 중 하나가 바뀔 때만 지운다(appliedScore는 그대로)
      analysis: sql`case when ${postings.rawText} = ${input.rawText} and ${postings.companyNote} is not distinct from ${input.companyNote} then ${postings.analysis} else null end`,
      updatedAt: new Date(),
    })
    .where(mine(userId, id))
    .returning({ id: postings.id });
  return updated.length > 0 ? { ok: true } : { ok: false, reason: "not_found" };
}

// 다시 읽기 결과를 저장한다. 읽은 원문이 지금 저장된 원문 그대로일 때만 쓴다(아니면 "changed")
export async function saveFound(
  db: Db,
  userId: string,
  id: string,
  found: Found,
  readAs: { rawText: string },
): Promise<{ ok: true } | { ok: false; reason: "not_found" | "changed" }> {
  const updated = await db
    .update(postings)
    .set({ foundDocuments: found.documents, foundQuestions: found.questions, updatedAt: new Date() })
    .where(and(mine(userId, id), eq(postings.rawText, readAs.rawText)))
    .returning({ id: postings.id });
  if (updated.length > 0) return { ok: true };
  const [exists] = await db.select({ id: postings.id }).from(postings).where(mine(userId, id)).limit(1);
  return { ok: false, reason: exists ? "changed" : "not_found" };
}

// 제출할 서류를 정한다. 목록 밖 값은 버리고 중복 없이 DOCUMENT_KINDS 순서로 둔다
export async function setChosenDocuments(db: Db, userId: string, id: string, kinds: DocumentKind[]): Promise<{ ok: true } | NotFound> {
  const chosen = DOCUMENT_KINDS.filter((kind) => kinds.includes(kind));
  const updated = await db
    .update(postings)
    .set({ chosenDocuments: chosen, updatedAt: new Date() })
    .where(mine(userId, id))
    .returning({ id: postings.id });
  return updated.length > 0 ? { ok: true } : { ok: false, reason: "not_found" };
}

export async function getPosting(db: Db, userId: string, id: string): Promise<Posting | null> {
  const [row] = await db.select().from(postings).where(mine(userId, id)).limit(1);
  return row ? toPosting(row) : null;
}

// 마감이 가까운 순. 마감일이 없는 것(상시 채용 등)은 그 뒤, 마감이 지난 것은 맨 뒤
export function sortByDeadline<T extends { deadline: string | null; createdAt: Date }>(list: T[], today: string): T[] {
  const group = (item: T) => (item.deadline === null ? 1 : item.deadline < today ? 2 : 0);
  return [...list].sort(
    (a, b) =>
      group(a) - group(b) ||
      (a.deadline ?? "").localeCompare(b.deadline ?? "") * (group(a) === 2 ? -1 : 1) ||
      b.createdAt.getTime() - a.createdAt.getTime(),
  );
}

// 점수가 높은 순. 점수가 없는(또는 알 수 없는) 공고는 뒤로, 점수가 같으면 마감순
export function sortByScore<T extends { id: string; deadline: string | null; createdAt: Date }>(
  list: T[],
  key: "desire" | "fit",
  scores: ReadonlyMap<string, PostingScore>,
  today: string,
): T[] {
  const value = (item: T) => scores.get(item.id)?.[key] ?? null;
  // sort는 안정 정렬이므로 마감순으로 먼저 늘어놓으면 같은 점수끼리는 마감순이 남는다
  return sortByDeadline(list, today).sort((a, b) => {
    const x = value(a);
    const y = value(b);
    if (x === null || y === null) return (x === null ? 1 : 0) - (y === null ? 1 : 0);
    return y - x;
  });
}

export async function listPostings(db: Db, userId: string, trackId: string, today: string): Promise<Posting[]> {
  const rows = await db
    .select()
    .from(postings)
    .where(and(eq(postings.userId, userId), eq(postings.trackId, trackId)));
  return sortByDeadline(rows.map(toPosting), today);
}

// 트랙별 공고 수 (트랙 탭에 보여 준다)
export async function countPostings(db: Db, userId: string): Promise<Record<string, number>> {
  const rows = await db
    .select({ trackId: postings.trackId, value: count() })
    .from(postings)
    .where(eq(postings.userId, userId))
    .groupBy(postings.trackId);
  return Object.fromEntries(rows.map((row) => [row.trackId, row.value]));
}

// 같은 트랙에 회사와 직무가 같은 공고가 이미 있는지 (띄어쓰기와 대소문자는 무시)
export async function findSimilar(
  db: Db,
  userId: string,
  trackId: string,
  company: string,
  title: string,
  exceptId?: string,
): Promise<{ id: string; company: string; title: string }[]> {
  const key = (value: string) => value.replace(/\s+/g, "").toLowerCase();
  const rows = await db
    .select({ id: postings.id, company: postings.company, title: postings.title })
    .from(postings)
    .where(and(eq(postings.userId, userId), eq(postings.trackId, trackId)));
  return rows.filter((row) => row.id !== exceptId && key(row.company) === key(company) && key(row.title) === key(title));
}

export async function deletePosting(db: Db, userId: string, id: string): Promise<{ ok: true } | NotFound> {
  const deleted = await db.delete(postings).where(mine(userId, id)).returning({ id: postings.id });
  return deleted.length > 0 ? { ok: true } : { ok: false, reason: "not_found" };
}

// 지원 판단을 바꾼다. 지원(apply)은 점수를 본 뒤에 고르는 것이라 여기서는 받지 않는다(4-2)
export async function setStatus(
  db: Db,
  userId: string,
  id: string,
  status: Exclude<PostingStatus, "apply">,
): Promise<{ ok: true } | NotFound> {
  const updated = await db
    .update(postings)
    .set({ status, updatedAt: new Date() })
    .where(mine(userId, id))
    .returning({ id: postings.id });
  return updated.length > 0 ? { ok: true } : { ok: false, reason: "not_found" };
}

// 제외 사유가 있어도 진행하기로 한다(또는 되돌린다)
export async function setExcludeOverride(
  db: Db,
  userId: string,
  id: string,
  value: boolean,
): Promise<{ ok: true } | NotFound> {
  const updated = await db
    .update(postings)
    .set({ excludeOverride: value, updatedAt: new Date() })
    .where(mine(userId, id))
    .returning({ id: postings.id });
  return updated.length > 0 ? { ok: true } : { ok: false, reason: "not_found" };
}

// 분석을 저장한다. AI가 읽은 원문과 인재상 글이 지금 저장된 것과 같을 때만 쓴다(읽는 동안 고쳤다면 "changed")
export async function saveAnalysis(
  db: Db,
  userId: string,
  id: string,
  analysis: PostingAnalysis,
  readAs: { rawText: string; companyNote: string | null },
): Promise<{ ok: true } | { ok: false; reason: "not_found" | "changed" }> {
  const updated = await db
    .update(postings)
    .set({ analysis, updatedAt: new Date() })
    .where(
      and(
        mine(userId, id),
        eq(postings.rawText, readAs.rawText),
        sql`${postings.companyNote} is not distinct from ${readAs.companyNote}`,
      ),
    )
    .returning({ id: postings.id });
  if (updated.length > 0) return { ok: true };
  const [exists] = await db.select({ id: postings.id }).from(postings).where(mine(userId, id)).limit(1);
  return { ok: false, reason: exists ? "changed" : "not_found" };
}

// 지원 점수를 계산할 때 읽은 공고 값. 점수에 쓰는 칸만 담는다
export type ScoredAs = Pick<Posting, "rawText" | "companyNote" | "regions" | "careerType" | "minYears"> & {
  analysis: PostingAnalysis;
};

// 지원으로 정한다. 그때의 점수를 함께 남긴다(이후 기준이 바뀌어도 이 점수는 그대로).
// 점수를 계산하려고 읽은 공고 값이 지금도 그대로일 때만 쓴다(그사이 다른 탭에서 고쳤으면 "changed").
// 이미 지원한 공고는 고치지 않고 ok를 돌려준다(남긴 점수를 덮어쓰지 않는다)
export async function applyToPosting(
  db: Db,
  userId: string,
  id: string,
  score: AppliedScore,
  readAs: ScoredAs,
): Promise<{ ok: true } | { ok: false; reason: "not_found" | "changed" }> {
  const updated = await db
    .update(postings)
    .set({ status: "apply", appliedScore: score, updatedAt: new Date() })
    .where(
      and(
        mine(userId, id),
        ne(postings.status, "apply"),
        eq(postings.rawText, readAs.rawText),
        sql`${postings.companyNote} is not distinct from ${readAs.companyNote}`,
        sql`${postings.regions} = ${JSON.stringify(readAs.regions)}::jsonb`,
        eq(postings.careerType, readAs.careerType),
        sql`${postings.minYears} is not distinct from ${readAs.minYears}`,
        sql`${postings.analysis} = ${JSON.stringify(readAs.analysis)}::jsonb`,
      ),
    )
    .returning({ id: postings.id });
  if (updated.length > 0) return { ok: true };
  const [current] = await db.select({ status: postings.status }).from(postings).where(mine(userId, id)).limit(1);
  if (!current) return { ok: false, reason: "not_found" };
  return current.status === "apply" ? { ok: true } : { ok: false, reason: "changed" };
}
