import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@/db/types";
import { type Claim, type ClaimStatus, type ClaimSubject, claimsAfterEdit, type FoundClaim } from "./claims";
import type { ClaimAnswer } from "./claims-repo";
import { LIMITS } from "./options";
import { jobs, projects, recordClaims, scenes } from "./schema";

// 새 기록(장면·경력·프로젝트)의 주장 저장과 답 처리. claims-repo.ts와 같은 일을 experiences_record_claims에 한다.
// 사용자 id를 받는 함수는 모두 주인 기록이 그 사용자 것인지 확인한다.

type Tx = Pick<Db, "select" | "insert" | "update" | "delete">;

export type ClaimOwner = { kind: "scene" | "job" | "project"; id: string };

const OWNER_TABLES = { scene: scenes, job: jobs, project: projects } as const;
const OWNER_COLUMNS = { scene: recordClaims.sceneId, job: recordClaims.jobId, project: recordClaims.projectId } as const;
const OPEN: ClaimStatus[] = ["pending", "needs_fix"];

const toClaim = (row: typeof recordClaims.$inferSelect): Claim => ({
  id: row.id,
  kind: row.kind,
  quote: row.quote,
  phrase: row.phrase,
  origin: row.origin,
  status: row.status,
});

const ownerValues = (owner: ClaimOwner) => ({
  sceneId: owner.kind === "scene" ? owner.id : null,
  jobId: owner.kind === "job" ? owner.id : null,
  projectId: owner.kind === "project" ? owner.id : null,
});

async function owns(db: Tx, userId: string, owner: ClaimOwner): Promise<boolean> {
  const table = OWNER_TABLES[owner.kind];
  const rows = await db
    .select({ id: table.id })
    .from(table)
    .where(and(eq(table.id, owner.id), eq(table.userId, userId)))
    .limit(1);
  return rows.length > 0;
}

export async function listRecordClaims(db: Tx, userId: string, owner: ClaimOwner): Promise<Claim[]> {
  if (!(await owns(db, userId, owner))) return [];
  const rows = await db
    .select()
    .from(recordClaims)
    .where(and(eq(OWNER_COLUMNS[owner.kind], owner.id), eq(recordClaims.userId, userId)))
    .orderBy(asc(recordClaims.position), asc(recordClaims.createdAt));
  return rows.map(toClaim);
}

// 기록을 만들 때 주장을 넣는다. 처음부터 고쳐야 하는 것(원본에 없던 숫자)은 needs_fix로 시작한다
// 주인 기록이 사용자 것인지는 부르는 쪽이 만든 직후라 확인하지 않는다(user_id는 함께 적는다)
export async function insertRecordClaims(
  db: Tx,
  userId: string,
  owner: ClaimOwner,
  found: (FoundClaim & { status?: ClaimStatus })[],
  startPosition = 0,
): Promise<void> {
  if (found.length === 0) return;
  await db.insert(recordClaims).values(
    found.map((claim, index) => ({
      id: randomUUID(),
      userId,
      ...ownerValues(owner),
      kind: claim.kind,
      quote: claim.quote,
      phrase: claim.phrase,
      origin: claim.origin,
      status: claim.status ?? ("pending" as const),
      position: startPosition + index,
    })),
  );
}

// 기록의 내용을 고친 뒤 주장을 맞춘다. 가져온 기록에만 쓴다. 소유자는 부르는 쪽(updateFact)이 확인했다
export async function syncRecordClaimsAfterEdit(db: Tx, owner: ClaimOwner, subject: ClaimSubject): Promise<void> {
  const rows = await db.select().from(recordClaims).where(eq(OWNER_COLUMNS[owner.kind], owner.id));
  const { updates, deletes, adds } = claimsAfterEdit(rows.map(toClaim), subject);
  for (const { id, status } of updates) {
    await db.update(recordClaims).set({ status, updatedAt: new Date() }).where(eq(recordClaims.id, id));
  }
  if (deletes.length > 0) await db.delete(recordClaims).where(inArray(recordClaims.id, deletes));
  if (adds.length === 0) return;
  const userId = await ownerUserId(db, owner);
  if (userId) await insertRecordClaims(db, userId, owner, adds, rows.length);
}

async function ownerUserId(db: Tx, owner: ClaimOwner): Promise<string | null> {
  const table = OWNER_TABLES[owner.kind];
  const [row] = await db.select({ userId: table.userId }).from(table).where(eq(table.id, owner.id)).limit(1);
  return row?.userId ?? null;
}

// 열린 주장(대기, 고쳐야 함)이 있는가
export async function hasOpenRecordClaims(db: Tx, owner: ClaimOwner): Promise<boolean> {
  const rows = await db
    .select({ id: recordClaims.id })
    .from(recordClaims)
    .where(and(eq(OWNER_COLUMNS[owner.kind], owner.id), inArray(recordClaims.status, OPEN)))
    .limit(1);
  return rows.length > 0;
}

// 기록별 열린 주장 수(주인 id → 수)
export async function countOpenRecordClaims(db: Tx, userId: string): Promise<Record<string, number>> {
  const rows = await db
    .select({
      sceneId: recordClaims.sceneId,
      jobId: recordClaims.jobId,
      projectId: recordClaims.projectId,
      value: sql<number>`count(*)::int`,
    })
    .from(recordClaims)
    .where(and(eq(recordClaims.userId, userId), inArray(recordClaims.status, OPEN)))
    .groupBy(recordClaims.sceneId, recordClaims.jobId, recordClaims.projectId);
  return Object.fromEntries(rows.map((row) => [(row.sceneId ?? row.jobId ?? row.projectId) as string, row.value]));
}

// 주장에 답한다. 규칙은 answerClaim과 같다. 경력·프로젝트에는 수치 줄이 없어 unknown은 needs_fix가 된다
export async function answerRecordClaim(
  db: Db,
  userId: string,
  claimId: string,
  answer: ClaimAnswer,
): Promise<{ ok: true; status: ClaimStatus } | { ok: false; reason: "not_found" | "not_allowed" | "banned_full" }> {
  return db.transaction(async (tx) => {
    const [claim] = await tx
      .select()
      .from(recordClaims)
      .where(and(eq(recordClaims.id, claimId), eq(recordClaims.userId, userId)))
      .limit(1);
    if (!claim) return { ok: false as const, reason: "not_found" as const };
    // 장면에 딸린 주장은 Task 4에서 더한다(수치 줄 지우기, 장면 내용 되돌리기)
    if (claim.sceneId) return { ok: false as const, reason: "not_allowed" as const };
    const owner = claim.jobId
      ? { table: jobs, id: claim.jobId }
      : claim.projectId
        ? { table: projects, id: claim.projectId }
        : null;
    if (!owner) return { ok: false as const, reason: "not_found" as const };
    const [head] = await tx
      .select({ id: owner.table.id, bannedPhrases: owner.table.bannedPhrases })
      .from(owner.table)
      .where(and(eq(owner.table.id, owner.id), eq(owner.table.userId, userId)))
      .limit(1);
    if (!head) return { ok: false as const, reason: "not_found" as const };

    if (claim.status !== "pending" && claim.status !== "needs_fix") return { ok: false as const, reason: "not_allowed" as const };
    if (answer === "unknown" && claim.kind !== "metric") return { ok: false as const, reason: "not_allowed" as const };
    if (answer === "exaggerated" && claim.kind !== "role" && !claim.phrase) {
      return { ok: false as const, reason: "not_allowed" as const };
    }
    if (
      answer === "exaggerated" &&
      claim.phrase &&
      !head.bannedPhrases.includes(claim.phrase) &&
      head.bannedPhrases.length >= LIMITS.bannedPhrases
    ) {
      return { ok: false as const, reason: "banned_full" as const };
    }

    const status: ClaimStatus = answer === "confirm" ? "confirmed" : "needs_fix";
    if (answer === "exaggerated" && claim.phrase) {
      await tx
        .update(owner.table)
        .set({ bannedPhrases: [...new Set([...head.bannedPhrases, claim.phrase])] })
        .where(and(eq(owner.table.id, owner.id), eq(owner.table.userId, userId)));
    }
    await tx.update(recordClaims).set({ status, updatedAt: new Date() }).where(eq(recordClaims.id, claim.id));
    return { ok: true as const, status };
  });
}
