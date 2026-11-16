import { randomUUID } from "node:crypto";
import { and, count, desc, eq, sql } from "drizzle-orm";
import type { Db } from "@/db/types";
import { listTrackIds, ownsTrack } from "@/modules/tracks/repo";
import { CONTENT_FIELDS, type ExperienceInput } from "./input";
import { DEFAULT_SCOPE, type Kind, RUBRIC_ITEMS, type RubricItem, type Scope } from "./options";
import { experiences, type StoredRubric, trackScopes } from "./schema";
import {
  canClose,
  initialRubric,
  judgePeriod,
  type Rubric,
  rubricAfterContentEdit,
  type VerificationState,
  verificationState,
} from "./verification";

export type Experience = ExperienceInput & {
  id: string;
  rubric: StoredRubric;
  isConfirmed: boolean;
  state: VerificationState;
  createdAt: Date;
  updatedAt: Date;
};

export type ExperienceSummary = Pick<
  Experience,
  "id" | "name" | "kind" | "organization" | "role" | "startMonth" | "endMonth" | "isOngoing" | "state"
>;

type NotFound = { ok: false; reason: "not_found" };
type Ok = { ok: true };

const statuses = (rubric: StoredRubric): Rubric =>
  Object.fromEntries(RUBRIC_ITEMS.map((item) => [item, rubric[item].status])) as Rubric;

// 상태만 바꾸고, 상태가 그대로인 항목의 보완 방안(note)은 유지한다
function withStatuses(next: Rubric, previous?: StoredRubric): StoredRubric {
  return Object.fromEntries(
    RUBRIC_ITEMS.map((item) => [
      item,
      { status: next[item], note: previous && previous[item].status === next[item] ? previous[item].note : null },
    ]),
  ) as StoredRubric;
}

const periodOf = (input: ExperienceInput) =>
  judgePeriod(input.kind, input.startMonth, input.endMonth, input.isOngoing);

const stateOf = (row: { kind: Kind; rubric: StoredRubric; confirmedAt: Date | null }) =>
  verificationState(row.kind, statuses(row.rubric), row.confirmedAt !== null);

const mine = (userId: string, id: string) => and(eq(experiences.id, id), eq(experiences.userId, userId));

export async function createExperience(db: Db, userId: string, input: ExperienceInput): Promise<string> {
  const id = randomUUID();
  await db.insert(experiences).values({
    id,
    userId,
    ...input,
    rubric: withStatuses(initialRubric(input.kind, periodOf(input))),
  });
  return id;
}

export async function getExperience(db: Db, userId: string, id: string): Promise<Experience | null> {
  const [row] = await db.select().from(experiences).where(mine(userId, id)).limit(1);
  if (!row) return null;
  const { userId: owner, confirmedAt, ...rest } = row;
  void owner; // 소유자 id는 돌려주지 않는다
  return { ...rest, isConfirmed: confirmedAt !== null, state: stateOf(row) };
}

export async function listExperiences(db: Db, userId: string): Promise<ExperienceSummary[]> {
  const rows = await db
    .select()
    .from(experiences)
    .where(eq(experiences.userId, userId))
    // 시작 월이 최근인 순, 시작 월이 없는 것은 맨 아래
    .orderBy(sql`${experiences.startMonth} desc nulls last`, desc(experiences.createdAt));
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    kind: row.kind,
    organization: row.organization,
    role: row.role,
    startMonth: row.startMonth,
    endMonth: row.endMonth,
    isOngoing: row.isOngoing,
    state: stateOf(row),
  }));
}

export async function countExperiences(db: Db, userId: string): Promise<number> {
  const [row] = await db.select({ value: count() }).from(experiences).where(eq(experiences.userId, userId));
  return row.value;
}

export async function updateExperience(
  db: Db,
  userId: string,
  id: string,
  input: ExperienceInput,
): Promise<Ok | NotFound> {
  const [current] = await db.select().from(experiences).where(mine(userId, id)).limit(1);
  if (!current) return { ok: false, reason: "not_found" };

  // 내용이 바뀌었으면 본인 확인을 풀고 다시 판정하게 한다
  const contentChanged = CONTENT_FIELDS.some(
    (field) => JSON.stringify(current[field]) !== JSON.stringify(input[field]),
  );
  await db
    .update(experiences)
    .set({
      ...input,
      updatedAt: new Date(),
      ...(contentChanged
        ? {
            confirmedAt: null,
            rubric: withStatuses(
              rubricAfterContentEdit(input.kind, statuses(current.rubric), periodOf(input)),
              current.rubric,
            ),
          }
        : {}),
    })
    .where(mine(userId, id));
  return { ok: true };
}

export async function deleteExperience(db: Db, userId: string, id: string): Promise<Ok | NotFound> {
  const deleted = await db.delete(experiences).where(mine(userId, id)).returning({ id: experiences.id });
  return deleted.length > 0 ? { ok: true } : { ok: false, reason: "not_found" };
}

async function setConfirmed(db: Db, userId: string, id: string, confirmedAt: Date | null): Promise<Ok | NotFound> {
  const updated = await db
    .update(experiences)
    .set({ confirmedAt })
    .where(mine(userId, id))
    .returning({ id: experiences.id });
  return updated.length > 0 ? { ok: true } : { ok: false, reason: "not_found" };
}

// 사용자의 "내용이 맞습니다". AI는 구체적인지만 판정하고, 사실인지는 사용자가 확인한다
export const confirmExperience = (db: Db, userId: string, id: string) => setConfirmed(db, userId, id, new Date());
export const unconfirmExperience = (db: Db, userId: string, id: string) => setConfirmed(db, userId, id, null);

async function setClosed(
  db: Db,
  userId: string,
  id: string,
  item: RubricItem,
  closed: boolean,
): Promise<Ok | NotFound | { ok: false; reason: "not_allowed" }> {
  const [current] = await db.select().from(experiences).where(mine(userId, id)).limit(1);
  if (!current) return { ok: false, reason: "not_found" };
  if (!canClose(current.kind, item)) return { ok: false, reason: "not_allowed" };
  if (!closed && current.rubric[item].status !== "closed") return { ok: true };

  const rubric: StoredRubric = { ...current.rubric, [item]: { status: closed ? "closed" : "unjudged", note: null } };
  await db.update(experiences).set({ rubric }).where(mine(userId, id));
  return { ok: true };
}

// "해당 없음"으로 닫기. 수치와 증빙만 닫을 수 있다
export const closeRubricItem = (db: Db, userId: string, id: string, item: RubricItem) =>
  setClosed(db, userId, id, item, true);
export const reopenRubricItem = (db: Db, userId: string, id: string, item: RubricItem) =>
  setClosed(db, userId, id, item, false);

export async function setTrackScope(
  db: Db,
  userId: string,
  experienceId: string,
  trackId: string,
  scope: Scope,
): Promise<Ok | NotFound> {
  // 기록과 트랙이 모두 본인 것이어야 한다
  const [owned] = await db.select({ id: experiences.id }).from(experiences).where(mine(userId, experienceId)).limit(1);
  if (!owned || !(await ownsTrack(db, userId, trackId))) return { ok: false, reason: "not_found" };

  await db
    .insert(trackScopes)
    .values({ experienceId, trackId, scope })
    .onConflictDoUpdate({ target: [trackScopes.experienceId, trackScopes.trackId], set: { scope } });
  return { ok: true };
}

// 본인의 모든 트랙에 대한 범위. 정하지 않은 트랙은 "사용"
export async function getTrackScopes(db: Db, userId: string, experienceId: string): Promise<Record<string, Scope>> {
  const [owned] = await db.select({ id: experiences.id }).from(experiences).where(mine(userId, experienceId)).limit(1);
  if (!owned) return {};
  const rows = await db.select().from(trackScopes).where(eq(trackScopes.experienceId, experienceId));
  const saved = new Map(rows.map((row) => [row.trackId, row.scope]));
  return Object.fromEntries(
    (await listTrackIds(db, userId)).map((trackId) => [trackId, saved.get(trackId) ?? DEFAULT_SCOPE]),
  );
}
