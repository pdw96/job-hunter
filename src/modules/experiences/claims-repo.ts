import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@/db/types";
import { type Claim, claimsAfterEdit, type ClaimStatus, type FoundClaim, proseContains, quotePieces } from "./claims";
import type { ExperienceInput } from "./input";
import { LIMITS } from "./options";
import { contentResetFields } from "./rubric-store";
import { claims, experiences } from "./schema";
import { judgePeriod } from "./verification";

// 주장의 저장과 답 처리. 모든 함수가 기록의 소유자를 확인한다.

type Tx = Pick<Db, "select" | "insert" | "update" | "delete">;

const toClaim = (row: typeof claims.$inferSelect): Claim => ({
  id: row.id,
  kind: row.kind,
  quote: row.quote,
  phrase: row.phrase,
  origin: row.origin,
  status: row.status,
});

async function owns(db: Tx, userId: string, experienceId: string): Promise<boolean> {
  const rows = await db
    .select({ id: experiences.id })
    .from(experiences)
    .where(and(eq(experiences.id, experienceId), eq(experiences.userId, userId)))
    .limit(1);
  return rows.length > 0;
}

export async function listClaims(db: Tx, userId: string, experienceId: string): Promise<Claim[]> {
  if (!(await owns(db, userId, experienceId))) return [];
  const rows = await db
    .select()
    .from(claims)
    .where(eq(claims.experienceId, experienceId))
    .orderBy(asc(claims.position), asc(claims.createdAt));
  return rows.map(toClaim);
}

// 기록을 만들 때 주장을 넣는다. 처음부터 고쳐야 하는 것(원본에 없던 숫자)은 needs_fix로 시작한다
export async function insertClaims(
  db: Tx,
  experienceId: string,
  found: (FoundClaim & { status?: ClaimStatus })[],
  startPosition = 0,
): Promise<void> {
  if (found.length === 0) return;
  await db.insert(claims).values(
    found.map((claim, index) => ({
      id: randomUUID(),
      experienceId,
      kind: claim.kind,
      quote: claim.quote,
      phrase: claim.phrase,
      origin: claim.origin,
      status: claim.status ?? ("pending" as const),
      position: startPosition + index,
    })),
  );
}

// 기록의 내용을 고친 뒤 주장을 맞춘다. 가져온 기록에만 쓴다. 소유자는 부르는 쪽(updateExperience)이 확인했다
export async function syncClaimsAfterEdit(db: Tx, experienceId: string, input: ExperienceInput): Promise<void> {
  const rows = await db.select().from(claims).where(eq(claims.experienceId, experienceId));
  const { updates, deletes, adds } = claimsAfterEdit(rows.map(toClaim), input);
  for (const { id, status } of updates) {
    await db.update(claims).set({ status, updatedAt: new Date() }).where(eq(claims.id, id));
  }
  if (deletes.length > 0) await db.delete(claims).where(inArray(claims.id, deletes));
  await insertClaims(db, experienceId, adds, rows.length);
}

// 열린 주장(대기, 고쳐야 함)이 있는가
export async function hasOpenClaims(db: Tx, experienceId: string): Promise<boolean> {
  const rows = await db
    .select({ id: claims.id })
    .from(claims)
    .where(and(eq(claims.experienceId, experienceId), inArray(claims.status, ["pending", "needs_fix"])))
    .limit(1);
  return rows.length > 0;
}

// 기록별 열린 주장 수(목록에 보여 준다)
export async function countOpenClaims(db: Tx, userId: string): Promise<Record<string, number>> {
  const rows = await db
    .select({ experienceId: claims.experienceId, value: sql<number>`count(*)::int` })
    .from(claims)
    .innerJoin(experiences, eq(experiences.id, claims.experienceId))
    .where(and(eq(experiences.userId, userId), inArray(claims.status, ["pending", "needs_fix"])))
    .groupBy(claims.experienceId);
  return Object.fromEntries(rows.map((row) => [row.experienceId, row.value]));
}

export type ClaimAnswer = "confirm" | "unknown" | "exaggerated" | "wrong";

// 주장에 답한다
// confirm 맞음 / unknown 숫자 모름 / exaggerated 과장임 / wrong 틀림·고칠게요
export async function answerClaim(
  db: Db,
  userId: string,
  claimId: string,
  answer: ClaimAnswer,
): Promise<{ ok: true; status: ClaimStatus } | { ok: false; reason: "not_found" | "not_allowed" | "banned_full" }> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ claim: claims, experience: experiences })
      .from(claims)
      .innerJoin(experiences, eq(experiences.id, claims.experienceId))
      .where(and(eq(claims.id, claimId), eq(experiences.userId, userId)))
      .limit(1);
    if (!row) return { ok: false as const, reason: "not_found" as const };
    const { claim, experience } = row;
    // 답할 수 있는 것은 열린 주장뿐이고, 종류에 맞는 답만 받는다
    if (claim.status !== "pending" && claim.status !== "needs_fix") return { ok: false as const, reason: "not_allowed" as const };
    if (answer === "unknown" && claim.kind !== "metric") return { ok: false as const, reason: "not_allowed" as const };
    if (answer === "exaggerated" && claim.kind !== "role") return { ok: false as const, reason: "not_allowed" as const };
    // 금지 표현이 가득 차 새 표현을 넣을 수 없으면, 넣은 척하지 않고 알린다
    if (
      answer === "exaggerated" &&
      claim.phrase &&
      !experience.bannedPhrases.includes(claim.phrase) &&
      experience.bannedPhrases.length >= LIMITS.bannedPhrases
    ) {
      return { ok: false as const, reason: "banned_full" as const };
    }

    let status: ClaimStatus = answer === "confirm" ? "confirmed" : "needs_fix";
    let removedMetric: typeof experience.metrics | null = null;

    if (answer === "unknown") {
      // 수치 칸의 줄이면 그 줄을 지운다. 같은 구절이 본문에도 남아 있으면 닫지 않고 고쳐야 할 것으로 둔다
      const remaining = experience.metrics.filter((metric) => !quotePieces(metric.text).includes(claim.quote));
      if (remaining.length !== experience.metrics.length) {
        await tx
          .update(experiences)
          .set({
            metrics: remaining,
            updatedAt: new Date(),
            // 내용이 바뀌었으므로 예전 판정과 후보도 지운다(기록을 고쳤을 때와 같다)
            ...contentResetFields(
              experience.kind,
              experience.rubric,
              judgePeriod(experience.kind, experience.startMonth, experience.endMonth, experience.isOngoing),
            ),
          })
          .where(eq(experiences.id, experience.id));
        removedMetric = remaining;
        if (!proseContains({ ...experience, metrics: remaining }, claim.quote)) status = "removed";
      }
    }
    if (answer === "exaggerated" && claim.phrase) {
      // 사용자가 직접 과장이라고 했으므로 후보를 거치지 않고 바로 금지 표현에 넣는다
      await tx
        .update(experiences)
        .set({ bannedPhrases: [...new Set([...experience.bannedPhrases, claim.phrase])] })
        .where(eq(experiences.id, experience.id));
    }

    await tx.update(claims).set({ status, updatedAt: new Date() }).where(eq(claims.id, claim.id));
    // 수치 줄을 지웠으면 그 줄에서 나온 다른 주장도 남은 내용에 맞춘다(본문에 남은 구절은 그대로 둔다)
    if (removedMetric) await syncClaimsAfterEdit(tx, experience.id, { ...experience, metrics: removedMetric });
    return { ok: true as const, status };
  });
}
