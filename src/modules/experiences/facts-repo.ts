import { randomUUID } from "node:crypto";
import { and, count, desc, eq, isNull, sql } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import type { Db } from "@/db/types";
import { ownsTrack } from "../tracks/repo";
import { subjectOfJob, subjectOfProject } from "./claims";
import type { Scope } from "./options";
import { type ClaimOwner, hasOpenRecordClaims, syncRecordClaimsAfterEdit } from "./record-claims-repo";
import { FACT_CONTENT_FIELDS, type FactInputs, type JobInput, type ProjectInput } from "./record-input";
import { FACT_KINDS, type FactKind, HEAD_KINDS, type HeadKind, type ProjectParent, type RecordSource } from "./record-options";
import { scenePeriodStatus } from "./scene-rules";
import { activities, courses, credentials, education, gaps, jobs, projects, scenes } from "./schema";

// 이력 사실(학력·교육·경력·공백·자격·프로젝트·활동)의 저장. 메뉴마다 표가 따로 있고 공통 동작은 이 파일 하나로 한다.
// 표는 FACT_TABLES 하나로 고르고, 표마다 다른 drizzle 타입은 FactTable로 합쳐 다룬다(칸 이름이 입력 키와 같다).

export type Fact<K extends FactKind = FactKind> = {
  kind: K;
  id: string;
  value: FactInputs[K];
  isConfirmed: boolean;
  contentVersion: number;
  source: RecordSource;
  trackScopes: Record<string, Scope>; // 저장된 그대로. 없는 키는 "사용"
  movedFrom: string | null;
  createdAt: Date;
  updatedAt: Date;
};
export type FactsByKind = { [K in FactKind]: Fact<K>[] };

type NotFound = { ok: false; reason: "not_found" };
type Ok = { ok: true };

const FACT_TABLES = {
  education,
  course: courses,
  job: jobs,
  gap: gaps,
  credential: credentials,
  project: projects,
  activity: activities,
} satisfies Record<FactKind, unknown>;

// 모든 메뉴 표가 가진 칸만 쓰는 공통 모양. 칸별 값은 키 이름으로 꺼낸다
type FactTable = typeof jobs;
type Row = Record<string, unknown> & {
  id: string;
  confirmedAt: Date | null;
  contentVersion: number;
  source: RecordSource;
  trackScopes: Record<string, Scope>;
  movedFrom: string | null;
  createdAt: Date;
  updatedAt: Date;
};

const tableOf = (kind: FactKind) => FACT_TABLES[kind] as unknown as FactTable;
const col = (table: FactTable, key: string) => (table as unknown as Record<string, PgColumn>)[key];

// 입력 키 = 표의 칸 이름. 프로젝트의 parent는 칸 세 개(jobId·educationId·courseId)로 나뉜다
const INPUT_KEYS: { [K in FactKind]: readonly (keyof FactInputs[K])[] } = {
  education: FACT_CONTENT_FIELDS.education,
  course: FACT_CONTENT_FIELDS.course,
  job: [...FACT_CONTENT_FIELDS.job, "bannedPhrases"],
  gap: FACT_CONTENT_FIELDS.gap,
  credential: FACT_CONTENT_FIELDS.credential,
  project: [...FACT_CONTENT_FIELDS.project, "bannedPhrases"], // parent는 따로 다룬다
  activity: FACT_CONTENT_FIELDS.activity,
};

const PARENT_KIND_TABLE = { job: jobs, education, course: courses } as const;

const mine = (kind: FactKind, userId: string, id: string) => {
  const t = tableOf(kind);
  return and(eq(t.id, id), eq(t.userId, userId));
};

function toValues(kind: FactKind, input: FactInputs[FactKind]): Record<string, unknown> {
  const raw = input as unknown as Record<string, unknown>;
  const values: Record<string, unknown> = {};
  for (const key of INPUT_KEYS[kind] as readonly string[]) values[key] = raw[key];
  if (kind === "project") {
    const parent = (input as ProjectInput).parent;
    values.jobId = parent?.kind === "job" ? parent.id : null;
    values.educationId = parent?.kind === "education" ? parent.id : null;
    values.courseId = parent?.kind === "course" ? parent.id : null;
  }
  return values;
}

function toValue(kind: FactKind, row: Row): FactInputs[FactKind] {
  const value: Record<string, unknown> = {};
  for (const key of INPUT_KEYS[kind] as readonly string[]) value[key] = row[key];
  if (kind === "project") {
    value.parent = row.jobId
      ? { kind: "job", id: row.jobId }
      : row.educationId
        ? { kind: "education", id: row.educationId }
        : row.courseId
          ? { kind: "course", id: row.courseId }
          : null;
  }
  return value as unknown as FactInputs[FactKind];
}

function toFact<K extends FactKind>(kind: K, row: Row): Fact<K> {
  return {
    kind,
    id: row.id,
    value: toValue(kind, row) as FactInputs[K],
    isConfirmed: row.confirmedAt !== null,
    contentVersion: row.contentVersion,
    source: row.source,
    trackScopes: row.trackScopes,
    movedFrom: row.movedFrom,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// 프로젝트가 딸린 조직이 본인 것인지
async function ownsParent(db: Db, userId: string, parent: ProjectParent): Promise<boolean> {
  if (parent === null) return true;
  const t = PARENT_KIND_TABLE[parent.kind];
  const rows = await db
    .select({ id: t.id })
    .from(t)
    .where(and(eq(t.id, parent.id), eq(t.userId, userId)))
    .limit(1);
  return rows.length > 0;
}

// 주장이 딸리는 이력 사실(경력·프로젝트)이면 그 주인
const claimOwnerOf = (kind: FactKind, id: string): ClaimOwner | null => (kind === "job" || kind === "project" ? { kind, id } : null);

const isHeadKind = (kind: FactKind): kind is HeadKind => (HEAD_KINDS as readonly string[]).includes(kind);
// 장면 표에서 그 머리를 가리키는 칸
const sceneHeadColumn = (kind: HeadKind) => ({ job: scenes.jobId, project: scenes.projectId, activity: scenes.activityId })[kind];

const parentOf = (kind: FactKind, input: FactInputs[FactKind]): ProjectParent =>
  kind === "project" ? (input as ProjectInput).parent : null;

export async function createFact<K extends FactKind>(
  db: Db,
  userId: string,
  kind: K,
  input: FactInputs[K],
  // confirmedAt: 확인된 때를 정해서 넣는다(옮기기가 옛 기록의 확인 시각을 넘길 때). confirmed보다 앞선다
  options: { source?: RecordSource; movedFrom?: string; confirmed?: boolean; confirmedAt?: Date; trackScopes?: Record<string, Scope> } = {},
): Promise<{ ok: true; id: string } | NotFound> {
  if (!(await ownsParent(db, userId, parentOf(kind, input)))) return { ok: false, reason: "not_found" };
  const id = randomUUID();
  await db.insert(tableOf(kind)).values({
    id,
    userId,
    ...toValues(kind, input),
    source: options.source ?? "manual",
    movedFrom: options.movedFrom ?? null,
    confirmedAt: options.confirmedAt ?? (options.confirmed ? new Date() : null),
    trackScopes: options.trackScopes ?? {},
  } as never);
  return { ok: true, id };
}

export async function getFact<K extends FactKind>(db: Db, userId: string, kind: K, id: string): Promise<Fact<K> | null> {
  const [row] = await db.select().from(tableOf(kind)).where(mine(kind, userId, id)).limit(1);
  return row ? toFact(kind, row as unknown as Row) : null;
}

// 메뉴마다 시작 월 최근 순, 시작 월이 없는 것은 아래(자격은 취득 월)
export async function listFacts(db: Db, userId: string): Promise<FactsByKind> {
  const entries = await Promise.all(
    FACT_KINDS.map(async (kind) => {
      const t = tableOf(kind);
      const monthColumn = col(t, kind === "credential" ? "month" : "startMonth");
      const rows = await db
        .select()
        .from(t)
        .where(eq(t.userId, userId))
        .orderBy(sql`${monthColumn} desc nulls last`, desc(t.createdAt));
      return [kind, rows.map((row) => toFact(kind, row as unknown as Row))] as const;
    }),
  );
  return Object.fromEntries(entries) as unknown as FactsByKind;
}

const sameValue = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export async function updateFact<K extends FactKind>(
  db: Db,
  userId: string,
  kind: K,
  id: string,
  input: FactInputs[K],
): Promise<Ok | NotFound> {
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(tableOf(kind)).where(mine(kind, userId, id)).limit(1);
    if (!row) return { ok: false as const, reason: "not_found" as const };
    if (!(await ownsParent(tx as unknown as Db, userId, parentOf(kind, input)))) return { ok: false as const, reason: "not_found" as const };

    // 내용 칸이 바뀐 때만 본인 확인을 풀고 내용 버전을 올린다
    const before = row as unknown as Row;
    const after = input as unknown as Record<string, unknown>;
    const changed = (FACT_CONTENT_FIELDS[kind] as readonly string[]).some((key) => !sameValue(before[key], after[key]));

    await tx
      .update(tableOf(kind))
      .set({
        ...toValues(kind, input),
        ...(changed ? { confirmedAt: null, contentVersion: sql`${tableOf(kind).contentVersion} + 1` } : {}),
        updatedAt: new Date(),
      } as never)
      .where(mine(kind, userId, id));

    // 가져온 경력·프로젝트는 고친 내용에 맞춰 주장을 맞추고, 열린 주장이 남으면 확인을 풀어 둔다
    const owner = claimOwnerOf(kind, id);
    if (owner && (before.source === "import" || before.source === "migrate")) {
      await syncRecordClaimsAfterEdit(tx, owner, owner.kind === "job" ? subjectOfJob(input as JobInput) : subjectOfProject(input as ProjectInput));
      if (await hasOpenRecordClaims(tx, owner)) {
        await tx.update(tableOf(kind)).set({ confirmedAt: null } as never).where(mine(kind, userId, id));
      }
    }

    // 머리의 기간이 바뀌었으면, 기간이 비어 머리의 기간을 따르는 장면의 기간 판정을 다시 한다
    if (
      isHeadKind(kind) &&
      (["startMonth", "endMonth", "isOngoing"] as const).some((key) => !sameValue(before[key], after[key]))
    ) {
      const headPeriod = { startMonth: after.startMonth as string | null, endMonth: after.endMonth as string | null, isOngoing: after.isOngoing === true };
      const status = scenePeriodStatus({ startMonth: null, endMonth: null, isOngoing: false }, headPeriod);
      const entry = JSON.stringify({ status, note: null });
      await tx
        .update(scenes)
        .set({ rubric: sql`jsonb_set(${scenes.rubric}, '{period}'::text[], ${entry}::jsonb)` })
        .where(and(eq(sceneHeadColumn(kind), id), eq(scenes.userId, userId), isNull(scenes.startMonth)));
    }
    return { ok: true as const };
  });
}

// 소속이 아직 없는 프로젝트에만 소속 칸 하나를 쓴다(옮기기의 소속 잇기). 다른 칸·확인·내용 버전은 건드리지 않아,
// AI에게 묻는 사이 다른 탭에서 고친 내용이나 사용자가 직접 고른 소속을 덮어쓰지 않는다
export async function setProjectParentIfUnset(
  db: Db,
  userId: string,
  projectId: string,
  parent: NonNullable<ProjectParent>,
): Promise<{ ok: true; changed: boolean } | NotFound> {
  if (!(await ownsParent(db, userId, parent))) return { ok: false, reason: "not_found" };
  const column = { job: "jobId", education: "educationId", course: "courseId" }[parent.kind];
  const updated = await db
    .update(projects)
    .set({ [column]: parent.id, updatedAt: new Date() })
    .where(
      and(
        eq(projects.id, projectId),
        eq(projects.userId, userId),
        isNull(projects.jobId),
        isNull(projects.educationId),
        isNull(projects.courseId),
      ),
    )
    .returning({ id: projects.id });
  if (updated.length > 0) return { ok: true, changed: true };
  const [owned] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
    .limit(1);
  return owned ? { ok: true, changed: false } : { ok: false, reason: "not_found" };
}

export async function deleteFact(
  db: Db,
  userId: string,
  kind: FactKind,
  id: string,
): Promise<Ok | NotFound | { ok: false; reason: "has_scenes"; count: number }> {
  // 장면이 달린 경력·프로젝트·활동은 지우지 않는다
  if (isHeadKind(kind)) {
    const [row] = await db
      .select({ n: count() })
      .from(scenes)
      .where(and(eq(sceneHeadColumn(kind), id), eq(scenes.userId, userId)));
    if (row && row.n > 0) return { ok: false, reason: "has_scenes", count: row.n };
  }
  const deleted = await db.delete(tableOf(kind)).where(mine(kind, userId, id)).returning({ id: tableOf(kind).id });
  return deleted.length > 0 ? { ok: true } : { ok: false, reason: "not_found" };
}

export async function confirmFact(
  db: Db,
  userId: string,
  kind: FactKind,
  id: string,
): Promise<Ok | { ok: false; reason: "not_found" | "claims_pending" }> {
  // 열린 주장(대기, 고쳐야 함)이 남은 경력·프로젝트는 맞음으로 확인하지 않는다
  const owner = claimOwnerOf(kind, id);
  if (owner && (await hasOpenRecordClaims(db, owner))) {
    const [owned] = await db.select({ id: tableOf(kind).id }).from(tableOf(kind)).where(mine(kind, userId, id)).limit(1);
    return owned ? { ok: false, reason: "claims_pending" } : { ok: false, reason: "not_found" };
  }
  const updated = await db
    .update(tableOf(kind))
    .set({ confirmedAt: new Date(), updatedAt: new Date() })
    .where(mine(kind, userId, id))
    .returning({ id: tableOf(kind).id });
  return updated.length > 0 ? { ok: true } : { ok: false, reason: "not_found" };
}

export async function unconfirmFact(db: Db, userId: string, kind: FactKind, id: string): Promise<Ok | NotFound> {
  const updated = await db
    .update(tableOf(kind))
    .set({ confirmedAt: null, updatedAt: new Date() })
    .where(mine(kind, userId, id))
    .returning({ id: tableOf(kind).id });
  return updated.length > 0 ? { ok: true } : { ok: false, reason: "not_found" };
}

export async function setFactTrackScope(
  db: Db,
  userId: string,
  kind: FactKind,
  id: string,
  trackId: string,
  scope: Scope,
): Promise<Ok | NotFound> {
  // 기록과 트랙이 모두 본인 것이어야 한다
  const t = tableOf(kind);
  const [owned] = await db.select({ id: t.id }).from(t).where(mine(kind, userId, id)).limit(1);
  if (!owned || !(await ownsTrack(db, userId, trackId))) return { ok: false, reason: "not_found" };

  await db
    .update(t)
    .set({ trackScopes: sql`jsonb_set(${t.trackScopes}, ARRAY[${trackId}]::text[], to_jsonb(${scope}::text))` })
    .where(mine(kind, userId, id));
  return { ok: true };
}

// 이력 사실과 장면의 수(홈 화면용)
export async function countRecords(db: Db, userId: string): Promise<number> {
  const counts = await Promise.all(
    [...FACT_KINDS.map(tableOf), scenes as unknown as FactTable].map(async (t) => {
      const [row] = await db.select({ n: count() }).from(t).where(eq(t.userId, userId));
      return row?.n ?? 0;
    }),
  );
  return counts.reduce((a, b) => a + b, 0);
}
