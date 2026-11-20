import { randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import type { Db } from "@/db/types";
import { ownsTrack } from "../tracks/repo";
import { subjectOfScene } from "./claims";
import { confirmFact } from "./facts-repo";
import type { RubricItem, Scope } from "./options";
import { hasOpenRecordClaims, syncRecordClaimsAfterEdit } from "./record-claims-repo";
import { SCENE_CONTENT_FIELDS, type SceneInput } from "./record-input";
import type { HeadRef, RecordSource } from "./record-options";
import { sceneContentResetFields, statuses, withStatuses } from "./rubric-store";
import { headOfRow, loadHead, sceneInputOf } from "./scene-head";
import { scenePeriodStatus, sceneState } from "./scene-rules";
import { scenes, type StoredRubric } from "./schema";
import { canClose, initialRubric, type VerificationState } from "./verification";

// 장면(경력·프로젝트·활동에 딸린 서술형 기록)의 저장과 확인. repo.ts와 같은 규칙을 experiences_scenes에 한다.
// 장면은 옛 "project" 구분의 검증 규칙(기간·본인 역할·수준 필수, 수치·증빙은 닫을 수 있음)을 쓴다.

export { sceneContentResetFields } from "./rubric-store";

export type Scene = SceneInput & {
  id: string;
  rubric: StoredRubric;
  isConfirmed: boolean;
  state: VerificationState;
  contentVersion: number;
  phraseCandidates: string[];
  dismissedPhrases: string[];
  judgedAt: Date | null;
  source: RecordSource;
  trackScopes: Record<string, Scope>;
  movedFrom: string | null;
  createdAt: Date;
  updatedAt: Date;
};
export type SceneSummary = Pick<Scene, "id" | "head" | "title" | "startMonth" | "endMonth" | "isOngoing" | "state" | "source">;

type NotFound = { ok: false; reason: "not_found" };
type Ok = { ok: true };
type Row = typeof scenes.$inferSelect;

const mine = (userId: string, id: string) => and(eq(scenes.id, id), eq(scenes.userId, userId));
const stateOf = (row: Row) => sceneState(statuses(row.rubric), row.confirmedAt !== null);
const headColumns = (head: HeadRef) => ({
  jobId: head.kind === "job" ? head.id : null,
  projectId: head.kind === "project" ? head.id : null,
  activityId: head.kind === "activity" ? head.id : null,
});
const sameValue = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

function toScene(row: Row): Scene {
  return {
    ...sceneInputOf(row),
    id: row.id,
    rubric: row.rubric,
    isConfirmed: row.confirmedAt !== null,
    state: stateOf(row),
    contentVersion: row.contentVersion,
    phraseCandidates: row.phraseCandidates,
    dismissedPhrases: row.dismissedPhrases,
    judgedAt: row.judgedAt,
    source: row.source,
    trackScopes: row.trackScopes,
    movedFrom: row.movedFrom,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function createScene(
  db: Db,
  userId: string,
  input: SceneInput,
  options: {
    source?: RecordSource;
    movedFrom?: string;
    carry?: { rubric: StoredRubric; confirmedAt: Date | null };
    trackScopes?: Record<string, Scope>;
  } = {},
): Promise<{ ok: true; id: string } | NotFound> {
  const head = await loadHead(db, userId, input.head);
  if (!head) return { ok: false, reason: "not_found" };
  const id = randomUUID();
  await db.insert(scenes).values({
    id,
    userId,
    ...headColumns(input.head),
    title: input.title,
    startMonth: input.startMonth,
    endMonth: input.endMonth,
    isOngoing: input.isOngoing,
    situation: input.situation,
    judgment: input.judgment,
    actions: input.actions,
    result: input.result,
    lessons: input.lessons,
    metrics: input.metrics,
    notDone: input.notDone,
    bannedPhrases: input.bannedPhrases,
    evidenceNote: input.evidenceNote,
    tags: input.tags,
    rubric: options.carry?.rubric ?? withStatuses(initialRubric("project", scenePeriodStatus(input, head.period))),
    confirmedAt: options.carry?.confirmedAt ?? null,
    source: options.source ?? "manual",
    movedFrom: options.movedFrom ?? null,
    trackScopes: options.trackScopes ?? {},
  });
  return { ok: true, id };
}

export async function getScene(db: Db, userId: string, id: string): Promise<Scene | null> {
  const [row] = await db.select().from(scenes).where(mine(userId, id)).limit(1);
  return row ? toScene(row) : null;
}

// 시작 월 최근 순, 시작 월이 없는 것은 아래
export async function listScenes(db: Db, userId: string): Promise<SceneSummary[]> {
  const rows = await db
    .select()
    .from(scenes)
    .where(eq(scenes.userId, userId))
    .orderBy(sql`${scenes.startMonth} desc nulls last`, desc(scenes.createdAt));
  return rows.map((row) => ({
    id: row.id,
    head: headOfRow(row),
    title: row.title,
    startMonth: row.startMonth,
    endMonth: row.endMonth,
    isOngoing: row.isOngoing,
    state: stateOf(row),
    source: row.source,
  }));
}

export async function updateScene(db: Db, userId: string, id: string, input: SceneInput): Promise<Ok | NotFound> {
  return db.transaction(async (tx) => {
    const [current] = await tx.select().from(scenes).where(mine(userId, id)).limit(1);
    if (!current) return { ok: false as const, reason: "not_found" as const };
    const head = await loadHead(tx, userId, input.head);
    if (!head) return { ok: false as const, reason: "not_found" as const };

    // 내용 칸(머리 포함)이 바뀌었으면 본인 확인을 풀고 다시 판정하게 한다
    const before = sceneInputOf(current) as unknown as Record<string, unknown>;
    const after = input as unknown as Record<string, unknown>;
    const evidenceNoteChanged = !sameValue(current.evidenceNote, input.evidenceNote);
    const changed = SCENE_CONTENT_FIELDS.some((key) => !sameValue(before[key], after[key]));

    await tx
      .update(scenes)
      .set({
        ...headColumns(input.head),
        title: input.title,
        startMonth: input.startMonth,
        endMonth: input.endMonth,
        isOngoing: input.isOngoing,
        situation: input.situation,
        judgment: input.judgment,
        actions: input.actions,
        result: input.result,
        lessons: input.lessons,
        metrics: input.metrics,
        notDone: input.notDone,
        bannedPhrases: input.bannedPhrases,
        evidenceNote: input.evidenceNote,
        tags: input.tags,
        updatedAt: new Date(),
        ...(changed
          ? sceneContentResetFields(current.rubric, scenePeriodStatus(input, head.period))
          : evidenceNoteChanged
            ? {
                // 증빙 메모만 바뀌었으면 확인과 내용 버전은 두고, 증빙 판정만 처음으로 돌린다(닫은 것은 그대로)
                judgedAt: null,
                rubric: sql`jsonb_set(${scenes.rubric}, '{evidence}'::text[],
                  case when ${scenes.rubric} -> 'evidence' ->> 'status' = 'closed'
                    then ${scenes.rubric} -> 'evidence'
                    else '{"status":"unjudged","note":null}'::jsonb end)`,
              }
            : {}),
      })
      .where(mine(userId, id));

    // 가져오거나 옮겨 온 장면은 고친 내용에 맞춰 주장을 맞추고, 열린 주장이 남으면 확인을 풀어 둔다
    if (current.source === "import" || current.source === "migrate") {
      const owner = { kind: "scene" as const, id };
      await syncRecordClaimsAfterEdit(tx, owner, subjectOfScene(input));
      if (await hasOpenRecordClaims(tx, owner)) await tx.update(scenes).set({ confirmedAt: null }).where(mine(userId, id));
    }
    return { ok: true as const };
  });
}

export async function deleteScene(db: Db, userId: string, id: string): Promise<Ok | NotFound> {
  const deleted = await db.delete(scenes).where(mine(userId, id)).returning({ id: scenes.id });
  return deleted.length > 0 ? { ok: true } : { ok: false, reason: "not_found" };
}

// 사용자의 "내용이 맞습니다". withHead면 한 트랜잭션에서 머리도 맞음으로 확인한다
export async function confirmScene(
  db: Db,
  userId: string,
  id: string,
  options: { withHead?: boolean } = {},
): Promise<Ok | { ok: false; reason: "not_found" | "claims_pending" | "head_claims_pending" }> {
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(scenes).where(mine(userId, id)).limit(1);
    if (!row) return { ok: false as const, reason: "not_found" as const };
    if (await hasOpenRecordClaims(tx, { kind: "scene", id })) return { ok: false as const, reason: "claims_pending" as const };
    if (options.withHead) {
      const head = headOfRow(row);
      const loaded = await loadHead(tx, userId, head);
      if (!loaded) return { ok: false as const, reason: "not_found" as const };
      if (!loaded.isConfirmed) {
        const confirmed = await confirmFact(tx as unknown as Db, userId, head.kind, head.id);
        if (!confirmed.ok) {
          return { ok: false as const, reason: confirmed.reason === "claims_pending" ? ("head_claims_pending" as const) : ("not_found" as const) };
        }
      }
    }
    await tx.update(scenes).set({ confirmedAt: new Date(), updatedAt: new Date() }).where(mine(userId, id));
    return { ok: true as const };
  });
}

export async function unconfirmScene(db: Db, userId: string, id: string): Promise<Ok | NotFound> {
  const updated = await db
    .update(scenes)
    .set({ confirmedAt: null, updatedAt: new Date() })
    .where(mine(userId, id))
    .returning({ id: scenes.id });
  return updated.length > 0 ? { ok: true } : { ok: false, reason: "not_found" };
}

async function setClosed(
  db: Db,
  userId: string,
  id: string,
  item: RubricItem,
  closed: boolean,
): Promise<Ok | NotFound | { ok: false; reason: "not_allowed" }> {
  const [current] = await db.select({ id: scenes.id }).from(scenes).where(mine(userId, id)).limit(1);
  if (!current) return { ok: false, reason: "not_found" };
  if (!canClose("project", item)) return { ok: false, reason: "not_allowed" };

  // 그 항목 하나만 DB 안에서 바꾼다. 읽은 루브릭을 통째로 다시 쓰면 그 사이 다시 계산된 판정을 덮어쓸 수 있다
  const entry = JSON.stringify({ status: closed ? "closed" : "unjudged", note: null });
  await db
    .update(scenes)
    .set({ rubric: sql`jsonb_set(${scenes.rubric}, ${`{${item}}`}::text[], ${entry}::jsonb)` })
    .where(
      closed
        ? mine(userId, id)
        : // 다시 열기는 닫혀 있을 때만. 이미 열려 있으면 판정을 건드리지 않는다
          and(mine(userId, id), sql`${scenes.rubric} -> ${item} ->> 'status' = 'closed'`),
    );
  return { ok: true };
}

export const closeSceneRubricItem = (db: Db, userId: string, id: string, item: RubricItem) => setClosed(db, userId, id, item, true);
export const reopenSceneRubricItem = (db: Db, userId: string, id: string, item: RubricItem) => setClosed(db, userId, id, item, false);

export async function setSceneTrackScope(db: Db, userId: string, id: string, trackId: string, scope: Scope): Promise<Ok | NotFound> {
  const [owned] = await db.select({ id: scenes.id }).from(scenes).where(mine(userId, id)).limit(1);
  if (!owned || !(await ownsTrack(db, userId, trackId))) return { ok: false, reason: "not_found" };
  await db
    .update(scenes)
    .set({ trackScopes: sql`jsonb_set(${scenes.trackScopes}, ARRAY[${trackId}]::text[], to_jsonb(${scope}::text))` })
    .where(mine(userId, id));
  return { ok: true };
}
