import { randomUUID } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "@/db/types";
import { ownsTrack } from "@/modules/tracks/repo";
import { hasPgCode } from "./db-errors";
import { careers } from "./schema";
import type { CareerContent, CareerSelection } from "./types";

// 경력기술서 공통본(트랙마다 1행)과 맞춤본(공고마다 1행)의 저장과 조회. 모든 함수가 userId로 소유자를 확인한다.
// 공고가 내 것인지, 지원인지는 부르는 쪽이 본다. 여기서는 행의 소유자와 version만 지킨다.

export type Career = {
  id: string;
  trackId: string;
  postingId: string | null;
  version: number;
  selection: CareerSelection | null;
  content: CareerContent | null;
  createdAt: Date;
  updatedAt: Date;
};

type Saved = { ok: true; version: number } | { ok: false; reason: "not_found" | "changed" };

const mine = (userId: string, id: string) => and(eq(careers.id, id), eq(careers.userId, userId));
const tailoredOf = (userId: string, postingId: string) =>
  and(eq(careers.userId, userId), eq(careers.postingId, postingId));

function toCareer(row: typeof careers.$inferSelect): Career {
  const { userId: owner, ...rest } = row;
  void owner;
  return rest;
}

// 조건이 어긋나 못 고쳤을 때, 행이 없는 것인지 조건이 바뀐 것인지 가른다
async function whyNot(db: Db, where: ReturnType<typeof mine>): Promise<{ ok: false; reason: "not_found" | "changed" }> {
  const [exists] = await db.select({ id: careers.id }).from(careers).where(where).limit(1);
  return { ok: false, reason: exists ? "changed" : "not_found" };
}

export async function getCareer(db: Db, userId: string, id: string): Promise<Career | null> {
  const [row] = await db.select().from(careers).where(mine(userId, id)).limit(1);
  return row ? toCareer(row) : null;
}

export async function getCommonCareer(db: Db, userId: string, trackId: string): Promise<Career | null> {
  const [row] = await db
    .select()
    .from(careers)
    .where(and(eq(careers.userId, userId), eq(careers.trackId, trackId), isNull(careers.postingId)))
    .limit(1);
  return row ? toCareer(row) : null;
}

export async function getTailoredCareer(db: Db, userId: string, postingId: string): Promise<Career | null> {
  const [row] = await db.select().from(careers).where(tailoredOf(userId, postingId)).limit(1);
  return row ? toCareer(row) : null;
}

// 트랙마다 공통본은 하나다. 이미 있으면(동시에 만든 경우 포함) exists
export async function insertCommonCareer(
  db: Db,
  userId: string,
  trackId: string,
  content: CareerContent,
): Promise<{ ok: true; id: string } | { ok: false; reason: "not_found" | "exists" }> {
  if (!(await ownsTrack(db, userId, trackId))) return { ok: false, reason: "not_found" };
  const id = randomUUID();
  const inserted = await db
    .insert(careers)
    .values({ id, userId, trackId, postingId: null, content })
    .onConflictDoNothing()
    .returning({ id: careers.id });
  return inserted.length > 0 ? { ok: true, id } : { ok: false, reason: "exists" };
}

// 강조할 경험 고르기 결과를 저장한다. 없으면 맞춤본 행을 만들고(내용 없음), 있으면 selection만 바꾼다.
// 저장하는 사이 공고가 지워졌으면 not_found
export async function saveTailoredCareerSelection(
  db: Db,
  userId: string,
  postingId: string,
  trackId: string,
  selection: CareerSelection,
): Promise<{ ok: true; id: string } | { ok: false; reason: "not_found" }> {
  try {
    const [row] = await db
      .insert(careers)
      .values({ id: randomUUID(), userId, trackId, postingId, version: 1, selection })
      .onConflictDoUpdate({
        target: careers.postingId,
        targetWhere: sql`${careers.postingId} is not null`,
        set: { selection, version: sql`${careers.version} + 1`, updatedAt: new Date() },
        setWhere: eq(careers.userId, userId),
      })
      .returning({ id: careers.id });
    // 남의 공고에 이미 행이 있는 경우뿐이다. 공고 소유 확인은 부르는 쪽 몫이므로 여기서는 쓰지 않고 멈춘다
    if (!row) throw new Error("다른 사용자의 경력기술서에는 쓸 수 없습니다");
    return { ok: true, id: row.id };
  } catch (error) {
    if (hasPgCode(error, "23503")) return { ok: false, reason: "not_found" };
    throw error;
  }
}

// 맞춤본 내용을 저장한다. expectedVersion이 null이면 행이 없거나 내용이 비어 있을 때만, 숫자이면 version이 같을 때만.
// 저장하는 사이 공고가 지워졌으면 not_found
export async function saveTailoredCareerContent(
  db: Db,
  userId: string,
  postingId: string,
  trackId: string,
  content: CareerContent,
  expectedVersion: number | null,
): Promise<Saved> {
  if (expectedVersion === null) {
    let row: { version: number } | undefined;
    try {
      [row] = await db
        .insert(careers)
        .values({ id: randomUUID(), userId, trackId, postingId, version: 1, content })
        .onConflictDoUpdate({
          target: careers.postingId,
          targetWhere: sql`${careers.postingId} is not null`,
          set: { content, version: sql`${careers.version} + 1`, updatedAt: new Date() },
          setWhere: and(eq(careers.userId, userId), isNull(careers.content)),
        })
        .returning({ version: careers.version });
    } catch (error) {
      if (hasPgCode(error, "23503")) return { ok: false, reason: "not_found" };
      throw error;
    }
    return row ? { ok: true, version: row.version } : whyNot(db, tailoredOf(userId, postingId));
  }
  const [row] = await db
    .update(careers)
    .set({ content, version: sql`${careers.version} + 1`, updatedAt: new Date() })
    .where(and(tailoredOf(userId, postingId), eq(careers.version, expectedVersion)))
    .returning({ version: careers.version });
  return row ? { ok: true, version: row.version } : whyNot(db, tailoredOf(userId, postingId));
}

// 읽은 때의 version 그대로일 때만 내용을 바꾼다(공통본·맞춤본 공통)
export async function saveCareerContent(
  db: Db,
  userId: string,
  id: string,
  content: CareerContent,
  expectedVersion: number,
): Promise<Saved> {
  const [row] = await db
    .update(careers)
    .set({ content, version: sql`${careers.version} + 1`, updatedAt: new Date() })
    .where(and(mine(userId, id), eq(careers.version, expectedVersion)))
    .returning({ version: careers.version });
  return row ? { ok: true, version: row.version } : whyNot(db, mine(userId, id));
}
