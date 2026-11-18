import { randomUUID } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "@/db/types";
import { ownsTrack } from "@/modules/tracks/repo";
import { resumes } from "./schema";
import type { ResumeContent, ResumeSelection } from "./types";

// 이력서 공통본(트랙마다 1행)과 맞춤본(공고마다 1행)의 저장과 조회. 모든 함수가 userId로 소유자를 확인한다.
// 공고가 내 것인지, 지원인지는 부르는 쪽이 본다. 여기서는 행의 소유자와 version만 지킨다.

export type Resume = {
  id: string;
  trackId: string;
  postingId: string | null;
  version: number;
  selection: ResumeSelection | null;
  content: ResumeContent | null;
  createdAt: Date;
  updatedAt: Date;
};

type Saved = { ok: true; version: number } | { ok: false; reason: "not_found" | "changed" };

const mine = (userId: string, id: string) => and(eq(resumes.id, id), eq(resumes.userId, userId));
const tailoredOf = (userId: string, postingId: string) =>
  and(eq(resumes.userId, userId), eq(resumes.postingId, postingId));

function toResume(row: typeof resumes.$inferSelect): Resume {
  const { userId: owner, ...rest } = row;
  void owner;
  return rest;
}

// 조건이 어긋나 못 고쳤을 때, 행이 없는 것인지 조건이 바뀐 것인지 가른다
async function whyNot(db: Db, where: ReturnType<typeof mine>): Promise<{ ok: false; reason: "not_found" | "changed" }> {
  const [exists] = await db.select({ id: resumes.id }).from(resumes).where(where).limit(1);
  return { ok: false, reason: exists ? "changed" : "not_found" };
}

export async function getResume(db: Db, userId: string, id: string): Promise<Resume | null> {
  const [row] = await db.select().from(resumes).where(mine(userId, id)).limit(1);
  return row ? toResume(row) : null;
}

export async function getCommonResume(db: Db, userId: string, trackId: string): Promise<Resume | null> {
  const [row] = await db
    .select()
    .from(resumes)
    .where(and(eq(resumes.userId, userId), eq(resumes.trackId, trackId), isNull(resumes.postingId)))
    .limit(1);
  return row ? toResume(row) : null;
}

export async function getTailoredResume(db: Db, userId: string, postingId: string): Promise<Resume | null> {
  const [row] = await db.select().from(resumes).where(tailoredOf(userId, postingId)).limit(1);
  return row ? toResume(row) : null;
}

// 트랙마다 공통본은 하나다. 이미 있으면(동시에 만든 경우 포함) exists
export async function insertCommonResume(
  db: Db,
  userId: string,
  trackId: string,
  content: ResumeContent,
): Promise<{ ok: true; id: string } | { ok: false; reason: "not_found" | "exists" }> {
  if (!(await ownsTrack(db, userId, trackId))) return { ok: false, reason: "not_found" };
  const id = randomUUID();
  const inserted = await db
    .insert(resumes)
    .values({ id, userId, trackId, postingId: null, content })
    .onConflictDoNothing()
    .returning({ id: resumes.id });
  return inserted.length > 0 ? { ok: true, id } : { ok: false, reason: "exists" };
}

// 강조할 경험 고르기 결과를 저장한다. 없으면 맞춤본 행을 만들고(내용 없음), 있으면 selection만 바꾼다
export async function saveTailoredSelection(
  db: Db,
  userId: string,
  postingId: string,
  trackId: string,
  selection: ResumeSelection,
): Promise<{ ok: true; id: string }> {
  const [row] = await db
    .insert(resumes)
    .values({ id: randomUUID(), userId, trackId, postingId, version: 1, selection })
    .onConflictDoUpdate({
      target: resumes.postingId,
      targetWhere: sql`${resumes.postingId} is not null`,
      set: { selection, version: sql`${resumes.version} + 1`, updatedAt: new Date() },
      setWhere: eq(resumes.userId, userId),
    })
    .returning({ id: resumes.id });
  // 남의 공고에 이미 행이 있는 경우뿐이다. 공고 소유 확인은 부르는 쪽 몫이므로 여기서는 쓰지 않고 멈춘다
  if (!row) throw new Error("다른 사용자의 이력서에는 쓸 수 없습니다");
  return { ok: true, id: row.id };
}

// 맞춤본 내용을 저장한다. expectedVersion이 null이면 행이 없거나 내용이 비어 있을 때만, 숫자이면 version이 같을 때만
export async function saveTailoredContent(
  db: Db,
  userId: string,
  postingId: string,
  trackId: string,
  content: ResumeContent,
  expectedVersion: number | null,
): Promise<Saved> {
  if (expectedVersion === null) {
    const [row] = await db
      .insert(resumes)
      .values({ id: randomUUID(), userId, trackId, postingId, version: 1, content })
      .onConflictDoUpdate({
        target: resumes.postingId,
        targetWhere: sql`${resumes.postingId} is not null`,
        set: { content, version: sql`${resumes.version} + 1`, updatedAt: new Date() },
        setWhere: and(eq(resumes.userId, userId), isNull(resumes.content)),
      })
      .returning({ version: resumes.version });
    return row ? { ok: true, version: row.version } : whyNot(db, tailoredOf(userId, postingId));
  }
  const [row] = await db
    .update(resumes)
    .set({ content, version: sql`${resumes.version} + 1`, updatedAt: new Date() })
    .where(and(tailoredOf(userId, postingId), eq(resumes.version, expectedVersion)))
    .returning({ version: resumes.version });
  return row ? { ok: true, version: row.version } : whyNot(db, tailoredOf(userId, postingId));
}

// 읽은 때의 version 그대로일 때만 내용을 바꾼다(공통본·맞춤본 공통)
export async function saveResumeContent(
  db: Db,
  userId: string,
  id: string,
  content: ResumeContent,
  expectedVersion: number,
): Promise<Saved> {
  const [row] = await db
    .update(resumes)
    .set({ content, version: sql`${resumes.version} + 1`, updatedAt: new Date() })
    .where(and(mine(userId, id), eq(resumes.version, expectedVersion)))
    .returning({ version: resumes.version });
  return row ? { ok: true, version: row.version } : whyNot(db, mine(userId, id));
}
