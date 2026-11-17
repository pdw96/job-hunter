import { randomUUID } from "node:crypto";
import { and, count, eq } from "drizzle-orm";
import type { Db } from "@/db/types";
import { ownsTrack } from "@/modules/tracks/repo";
import type { PostingInput } from "./input";
import { POSTING_LIMITS, type PostingStatus } from "./options";
import { postings } from "./schema";

// 공고의 저장과 조회. 모든 함수가 userId로 소유자를 확인한다.

export type Posting = PostingInput & {
  id: string;
  trackId: string;
  status: PostingStatus;
  excludeOverride: boolean;
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
): Promise<{ ok: true; id: string } | { ok: false; reason: "invalid_track" | "too_many" }> {
  // 남의 트랙이나 없는 트랙에는 넣을 수 없다
  if (!(await ownsTrack(db, userId, trackId))) return { ok: false, reason: "invalid_track" };
  const [{ value }] = await db.select({ value: count() }).from(postings).where(eq(postings.userId, userId));
  if (value >= POSTING_LIMITS.perUser) return { ok: false, reason: "too_many" };

  const id = randomUUID();
  await db.insert(postings).values({ id, userId, trackId, ...input });
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
    .set({ ...input, excludeOverride: false, updatedAt: new Date() })
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
