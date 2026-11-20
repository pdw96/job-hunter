import { randomUUID } from "node:crypto";
import { and, asc, eq, gt, inArray, isNotNull, isNull, lt, ne, notExists, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Db } from "@/db/types";
import type { Kind } from "./options";
import { type ExperienceSummary, listExperiences } from "./repo";
import { activities, courses, credentials, education, experiences, gaps, interviews, jobs, moves, projects, recordClaims, scenes } from "./schema";

// 옛 기록을 새 표로 옮기는 일의 목록(experiences_moves). 옛 기록 하나가 record 행 하나이고,
// 그 앞에 옛 기록 전체를 보고 역할(같은 기록, 다른 머리의 사례)을 정하는 classify 행이,
// 모두 끝난 뒤 옮긴 프로젝트의 소속을 잇는 affiliate 행이 사용자마다 하나까지 있다. 옛 표는 읽기만 한다.

export type MoveRole = NonNullable<typeof moves.$inferSelect.role>;
export type MoveProgress = { total: number; done: number; failed: { id: string; name: string; error: string }[]; pending: number };
export type ClaimedMove = {
  id: string;
  step: "classify" | "record" | "affiliate";
  oldId: string | null;
  role: MoveRole | null;
  ref: string | null;
  attempts: number; // 이번 시도 전까지 끝낸 수
};

// running인 채로 이만큼 지나면 멈춘 것으로 보고 다시 잡는다(화면을 닫았거나 서버가 끊김)
const STALE_MS = 5 * 60_000;
const AFFILIATE_NAME = "프로젝트 소속 잇기";
const CLASSIFY_NAME = "같은 기록·사례 정리";
export const HEAD_FAILED = "소속 기록을 옮기지 못했습니다";
// 프로젝트가 딸릴 조직이 되는 옛 구분(재직·학력·교육)
const PARENT_KINDS: readonly Kind[] = ["job", "school", "training"];

// 옮긴 프로젝트와 조직이 될 기록이 모두 있어야 소속을 이을 일이 있다
const needsAffiliate = (old: ExperienceSummary[]) =>
  old.some((item) => item.kind === "project") && old.some((item) => PARENT_KINDS.includes(item.kind));

export async function planMoves(db: Db, userId: string): Promise<void> {
  const old = await listExperiences(db, userId);
  // 정리는 옛 기록이 둘 이상이고, 아직 어느 기록도 옮기기 시작하지 않았을 때만 둔다(정리가 생기기 전에 옮긴 사용자는 건너뛴다).
  // 기록 행보다 먼저 넣어, 그 사이 다른 탭이 기록 행을 먼저 잡지 않게 한다. 부분 고유 색인이 하나로 막는다
  if (old.length >= 2) {
    const [started] = await db
      .select({ id: moves.id })
      .from(moves)
      .where(and(eq(moves.userId, userId), eq(moves.step, "record"), ne(moves.status, "pending")))
      .limit(1);
    if (!started) await db.insert(moves).values({ id: randomUUID(), userId, step: "classify", oldId: null }).onConflictDoNothing();
  }
  // 이미 행이 있는 기록은 고유 색인(user_id, old_id)이 걸러 낸다
  if (old.length > 0) {
    await db
      .insert(moves)
      .values(old.map((item) => ({ id: randomUUID(), userId, step: "record" as const, oldId: item.id })))
      .onConflictDoNothing();
  }
  // affiliate 행은 부분 고유 색인(user_id where step = 'affiliate')이 하나로 막는다. 동시에 불러도 같다
  if (needsAffiliate(old)) {
    await db.insert(moves).values({ id: randomUUID(), userId, step: "affiliate", oldId: null }).onConflictDoNothing();
  }
}

// 앱 레이아웃이 요청마다 부르므로 한 문장으로 본다(다 옮긴 사용자는 이것 하나로 끝난다). 아래 중 하나면 true:
// 행이 없는 옛 기록이 있다 / 소속을 이을 일이 있는데(needsAffiliate) affiliate 행이 없다 / pending·running 행이 있다
export async function needsMove(db: Db, userId: string): Promise<boolean> {
  const parentKinds = sql.join(
    PARENT_KINDS.map((kind) => sql`${kind}`),
    sql`, `,
  );
  const [row] = await db
    .select({
      needed: sql<boolean>`(
        exists (
          select 1 from ${experiences} e
          where e.user_id = ${userId}
            and not exists (select 1 from ${moves} m where m.user_id = ${userId} and m.old_id = e.id)
        )
        or (
          exists (select 1 from ${experiences} e where e.user_id = ${userId} and e.kind = 'project')
          and exists (select 1 from ${experiences} e where e.user_id = ${userId} and e.kind in (${parentKinds}))
          and not exists (select 1 from ${moves} m where m.user_id = ${userId} and m.step = 'affiliate')
        )
        or exists (
          select 1 from ${moves} m
          where m.user_id = ${userId} and m.status in ('pending', 'running')
            -- 머리가 실패한 장면은 잡히지 않으므로 남은 일로 세지 않는다(moveProgress와 같음)
            and not (
              m.role = 'scene'
              and exists (select 1 from ${moves} h where h.user_id = ${userId} and h.step = 'record' and h.old_id = m.ref and h.status = 'failed')
            )
        )
      )`,
    })
    .from(sql`(select 1) as one`);
  return row?.needed === true;
}

// 할 일 하나를 running으로 잡는다. 순서는 classify → 이력 사실·머리 → 장면 → affiliate.
// 기록 행은 classify가 끝나야(없거나 done) 잡히고, 장면은 머리가 될 기록 행이 done이어야 잡힌다.
// 고르기와 바꾸기를 한 문장으로 해서, 동시에 불러도 같은 행을 둘이 잡지 않는다.
// 실제 Postgres(READ COMMITTED)에서 왜 안전한가: 두 호출이 같은 스냅숏으로 같은 행 A를 고르면, UPDATE가 A의 행 잠금을 먼저 잡은
// 쪽만 바꾸고 다른 쪽은 그 트랜잭션이 끝날 때까지 기다린다. 기다린 쪽은 A의 새 값(running, 방금 시작)으로 바깥 WHERE의
// claimable을 다시 평가하고(EvalPlanQual), 조건에 맞지 않아 0행을 바꾸고 null을 돌려준다. 그래서 같은 행을 둘이 잡지 않는다.
// PGlite 테스트는 연결이 하나라 이 경합을 재현하지 못하므로 이 설명으로 남긴다
export async function claimNextMove(db: Db, userId: string, now: Date): Promise<ClaimedMove | null> {
  const stale = new Date(now.getTime() - STALE_MS);
  const claimable = or(eq(moves.status, "pending"), and(eq(moves.status, "running"), lt(moves.startedAt, stale)));
  // affiliate는 record 행이 모두 끝났을(done·failed) 때만
  const unfinished = alias(moves, "unfinished");
  const recordsLeft = db
    .select({ id: unfinished.id })
    .from(unfinished)
    .where(and(eq(unfinished.userId, userId), eq(unfinished.step, "record"), inArray(unfinished.status, ["pending", "running"])));
  // 기록 행은 정리가 끝나지 않았으면(pending·running·failed) 기다린다
  const classifying = alias(moves, "classifying");
  const classifyLeft = db
    .select({ id: classifying.id })
    .from(classifying)
    .where(and(eq(classifying.userId, userId), eq(classifying.step, "classify"), ne(classifying.status, "done")));
  // 장면은 머리가 될 기록 행이 done일 때만. 머리가 실패하면 finishMove가 장면도 실패로 둔다
  const head = alias(moves, "head");
  const headLeft = db
    .select({ id: head.id })
    .from(head)
    .where(and(eq(head.userId, userId), eq(head.step, "record"), eq(head.oldId, moves.ref), ne(head.status, "done")));
  const recordReady = and(eq(moves.step, "record"), notExists(classifyLeft), or(sql`${moves.role} is distinct from 'scene'`, notExists(headLeft)));
  const next = db
    .select({ id: moves.id })
    .from(moves)
    .where(and(eq(moves.userId, userId), claimable, or(eq(moves.step, "classify"), recordReady, and(eq(moves.step, "affiliate"), notExists(recordsLeft)))))
    .orderBy(
      sql`case when ${moves.step} = 'classify' then 0 when ${moves.step} = 'affiliate' then 3 when ${moves.role} = 'scene' then 2 else 1 end`,
      asc(moves.updatedAt),
      asc(moves.id),
    )
    .limit(1);
  const [row] = await db
    .update(moves)
    .set({ status: "running", startedAt: now, updatedAt: now })
    // 동시에 같은 행을 고른 쪽은 앞 문장이 끝날 때까지 기다린 뒤 이 조건을 새 값으로 다시 보고(Postgres의 다시 읽기), 0행이 된다.
    // FOR UPDATE SKIP LOCKED는 PGlite에서 잡을 행을 건너뛰는 일이 있어 쓰지 않는다
    .where(and(eq(moves.userId, userId), inArray(moves.id, next), claimable))
    .returning({ id: moves.id, step: moves.step, oldId: moves.oldId, role: moves.role, ref: moves.ref, attempts: moves.attempts });
  return row ?? null;
}

// 정리가 정한 역할을 기록 행에 적는다. 이미 옮긴(done) 행은 그 때의 역할로 둔다
export async function setMoveRoles(db: Db, userId: string, roles: { oldId: string; role: MoveRole; ref: string | null }[]): Promise<void> {
  await db.transaction(async (tx) => {
    for (const { oldId, role, ref } of roles) {
      await tx
        .update(moves)
        .set({ role, ref })
        .where(and(eq(moves.userId, userId), eq(moves.step, "record"), eq(moves.oldId, oldId), ne(moves.status, "done")));
    }
  });
}

// 기다리는(pending) 장면의 머리 행이 실패해 있으면 그 머리를 pending으로 되돌린다(retryMove와 같은 뜻).
// 한도로 모두 실패한 뒤 기록 하나만 다시 시도했는데 정리가 그것을 실패한 머리의 장면으로 정한 경우에 잡을 수 없는 pending이 남지 않게 한다
export async function reviveFailedHeads(db: Db, userId: string, now: Date = new Date()): Promise<void> {
  const waiting = alias(moves, "waiting");
  const heads = db
    .select({ ref: waiting.ref })
    .from(waiting)
    .where(and(eq(waiting.userId, userId), eq(waiting.step, "record"), eq(waiting.role, "scene"), eq(waiting.status, "pending")));
  await db
    .update(moves)
    .set({ status: "pending", error: null, startedAt: null, updatedAt: now })
    .where(and(eq(moves.userId, userId), eq(moves.step, "record"), eq(moves.status, "failed"), inArray(moves.oldId, heads)));
}

// 머리가 실패한 채 기다리는 장면(잡히지 않는다). 진행·결과 줄은 이것을 실패로 센다
function stuckScenes(rows: (typeof moves.$inferSelect)[]): Set<string> {
  const failedHeads = new Set(rows.filter((row) => row.step === "record" && row.status === "failed" && row.oldId !== null).map((row) => row.oldId));
  return new Set(
    rows.filter((row) => row.role === "scene" && (row.status === "pending" || row.status === "running") && failedHeads.has(row.ref)).map((row) => row.id),
  );
}
// 진행·결과용으로 본 상태(머리가 실패한 장면은 실패)
const shownStatus = (row: typeof moves.$inferSelect, stuck: Set<string>) => (stuck.has(row.id) ? "failed" : row.status);
const shownError = (row: typeof moves.$inferSelect, stuck: Set<string>) => (stuck.has(row.id) ? HEAD_FAILED : (row.error ?? ""));

// 그 옛 기록을 머리로 삼는 장면 행이 있는가(재직이면 사례로 나누지 않고 머리만 만든다)
export async function hasSceneMoves(db: Db, userId: string, oldId: string): Promise<boolean> {
  const rows = await db
    .select({ id: moves.id })
    .from(moves)
    .where(and(eq(moves.userId, userId), eq(moves.step, "record"), eq(moves.role, "scene"), eq(moves.ref, oldId)))
    .limit(1);
  return rows.length > 0;
}

export async function finishMove(
  db: Db,
  userId: string,
  id: string,
  // ok여도 note가 있으면(일부를 옮기지 못함) error 칸에 남겨 화면이 보여 주게 한다
  result: { ok: true; note?: string } | { ok: false; error: string },
  now: Date = new Date(),
  // countAttempt: false면 시도 수를 늘리지 않는다(한도로 멈춰 AI를 부르지 않은 것)
  options: { countAttempt?: boolean } = {},
): Promise<void> {
  const [row] = await db
    .update(moves)
    .set({
      status: result.ok ? "done" : "failed",
      error: result.ok ? (result.note ?? null) : result.error,
      attempts: options.countAttempt === false ? moves.attempts : sql`${moves.attempts} + 1`,
      updatedAt: now,
    })
    .where(and(eq(moves.id, id), eq(moves.userId, userId)))
    .returning({ step: moves.step, oldId: moves.oldId });
  // 머리가 될 기록이 실패하면 그것을 기다리던 장면도 실패로 둔다(기다리기만 하며 남지 않게)
  if (!result.ok && row?.step === "record" && row.oldId !== null) {
    await db
      .update(moves)
      .set({ status: "failed", error: HEAD_FAILED, startedAt: null, updatedAt: now })
      .where(and(eq(moves.userId, userId), eq(moves.step, "record"), eq(moves.role, "scene"), eq(moves.ref, row.oldId), eq(moves.status, "pending")));
  }
}

// 실패한 것만 다시 pending으로 돌린다. 기록 행이면 함께 기다려야 하는 것도 되돌린다:
// 그것을 머리로 삼는 실패한 장면, 장면이면 실패한 그 머리, 그리고 실패한 정리(정리가 끝나야 기록이 잡힌다)
export async function retryMove(
  db: Db,
  userId: string,
  id: string,
  now: Date = new Date(),
): Promise<{ ok: true } | { ok: false; reason: "not_found" }> {
  const reset = { status: "pending" as const, error: null, startedAt: null, updatedAt: now };
  const failedRecord = and(eq(moves.userId, userId), eq(moves.status, "failed"));
  const [row] = await db
    .update(moves)
    .set(reset)
    .where(and(eq(moves.id, id), failedRecord))
    .returning({ step: moves.step, oldId: moves.oldId, role: moves.role, ref: moves.ref });
  if (!row) {
    // 머리가 실패해 기다리기만 하는 장면(화면에는 실패로 보인다)이면 그 머리를 되돌린다
    const [scene] = await db
      .select({ ref: moves.ref })
      .from(moves)
      .where(and(eq(moves.id, id), eq(moves.userId, userId), eq(moves.role, "scene"), eq(moves.status, "pending")));
    if (!scene?.ref) return { ok: false, reason: "not_found" };
    const revived = await db
      .update(moves)
      .set(reset)
      .where(and(failedRecord, eq(moves.step, "record"), eq(moves.oldId, scene.ref)))
      .returning({ id: moves.id });
    return revived.length > 0 ? { ok: true } : { ok: false, reason: "not_found" };
  }
  if (row.step === "record" && row.oldId !== null) {
    await db.update(moves).set(reset).where(and(failedRecord, eq(moves.step, "record"), eq(moves.role, "scene"), eq(moves.ref, row.oldId)));
    if (row.role === "scene" && row.ref !== null) {
      await db.update(moves).set(reset).where(and(failedRecord, eq(moves.step, "record"), eq(moves.oldId, row.ref)));
    }
    await db.update(moves).set(reset).where(and(failedRecord, eq(moves.step, "classify")));
  }
  return { ok: true };
}

// 한도처럼 모두에게 해당하는 까닭으로 멈출 때, 남은 pending 행(소속 잇기 포함)을 같은 문구로 실패 처리한다.
// 그러면 needsMove가 거짓이 되어 사용자가 앱에 들어올 수 있고, 다시 시도는 기록 화면의 띠에서 한다
export async function failPendingMoves(db: Db, userId: string, error: string, now: Date = new Date()): Promise<void> {
  await db
    .update(moves)
    .set({ status: "failed", error, startedAt: null, updatedAt: now })
    .where(and(eq(moves.userId, userId), eq(moves.status, "pending")));
}

// 소속 잇기가 끝난 뒤 프로젝트나 조직을 늦게 옮겼으면 소속 잇기를 다시 돌게 한다.
// affiliateProjects는 소속이 아직 없는 옮긴 프로젝트만 건드리므로 다시 돌아도 안전하다
export async function reopenAffiliate(db: Db, userId: string, now: Date = new Date()): Promise<void> {
  await db
    .update(moves)
    .set({ status: "pending", error: null, startedAt: null, updatedAt: now })
    .where(and(eq(moves.userId, userId), eq(moves.step, "affiliate"), eq(moves.status, "done")));
}

export async function moveProgress(db: Db, userId: string): Promise<MoveProgress> {
  const rows = await db.select().from(moves).where(eq(moves.userId, userId)).orderBy(asc(moves.updatedAt), asc(moves.id));
  const stuck = stuckScenes(rows);
  const failedRows = rows.filter((row) => shownStatus(row, stuck) === "failed");
  // 실패한 기록은 옛 이름으로 보여 준다(화면용. AI에는 보내지 않는다)
  const names = failedRows.some((row) => row.oldId !== null)
    ? new Map((await listExperiences(db, userId)).map((item) => [item.id, item.name]))
    : new Map<string, string>();
  const nameOf = (row: (typeof rows)[number]) =>
    row.step === "classify" ? CLASSIFY_NAME : row.oldId === null ? AFFILIATE_NAME : (names.get(row.oldId) ?? "지워진 기록");
  // 정리가 실패하면 남은 일은 모두 그것을 기다리므로(다시 시도 전에는 잡히지 않음) 기다림으로 세지 않는다. 화면의 반복이 멈춘다
  const blocked = rows.some((row) => row.step === "classify" && row.status === "failed");
  return {
    total: rows.length,
    done: rows.filter((row) => row.status === "done").length,
    failed: failedRows.map((row) => ({ id: row.id, name: nameOf(row), error: shownError(row, stuck) })),
    pending: blocked ? 0 : rows.filter((row) => !stuck.has(row.id) && (row.status === "pending" || row.status === "running")).length,
  };
}

// 옛 구분마다 옮긴 결과(화면의 결과 줄용). 옛 기록은 읽기만 한다.
export type KindMove = {
  kind: Kind;
  total: number;
  done: number;
  failed: { id: string; name: string; error: string }[];
  // 옮겼지만 일부를 옮기지 못했거나 비웠다는 글(done 행의 error 칸)
  notes: string[];
};
type StepLine = { id: string; status: "pending" | "running" | "done" | "failed"; error: string };
export type MoveSummary = {
  kinds: KindMove[];
  recordTotal: number;
  recordDone: number;
  recordFailed: number;
  affiliate: StepLine | null;
  classify: StepLine | null;
  // 같은 기록이라 아무것도 만들지 않고 끝낸 기록 수(duplicate 역할의 done 행)
  duplicateDone: number;
};

export async function moveSummary(db: Db, userId: string): Promise<MoveSummary> {
  const [rows, old] = await Promise.all([
    db.select().from(moves).where(eq(moves.userId, userId)).orderBy(asc(moves.updatedAt), asc(moves.id)),
    listExperiences(db, userId),
  ]);
  const byId = new Map(old.map((item) => [item.id, item]));
  const stuck = stuckScenes(rows);
  const kinds = new Map<Kind, KindMove>();
  let affiliate: MoveSummary["affiliate"] = null;
  let classify: MoveSummary["classify"] = null;
  for (const row of rows) {
    if (row.step === "classify") {
      classify = { id: row.id, status: row.status, error: row.error ?? "" };
      continue;
    }
    if (row.step === "affiliate" || row.oldId === null) {
      affiliate = { id: row.id, status: row.status, error: row.error ?? "" };
      continue;
    }
    const item = byId.get(row.oldId);
    if (!item) continue; // 옛 기록이 지워졌으면 줄에 넣지 않는다
    const entry = kinds.get(item.kind) ?? { kind: item.kind, total: 0, done: 0, failed: [], notes: [] };
    entry.total += 1;
    const status = shownStatus(row, stuck);
    if (status === "done") {
      entry.done += 1;
      if (row.error) entry.notes.push(row.error);
    } else if (status === "failed") {
      entry.failed.push({ id: row.id, name: item.name, error: shownError(row, stuck) });
    }
    kinds.set(item.kind, entry);
  }
  const lines = [...kinds.values()];
  const sum = (pick: (line: KindMove) => number) => lines.reduce((acc, line) => acc + pick(line), 0);
  return {
    kinds: lines,
    recordTotal: sum((l) => l.total),
    recordDone: sum((l) => l.done),
    recordFailed: sum((l) => l.failed.length),
    affiliate,
    classify,
    duplicateDone: rows.filter((row) => row.step === "record" && row.role === "duplicate" && row.status === "done").length,
  };
}

// /records 위의 띠 문구. 기록이 실패했으면 그 개수, 소속 제안만 실패했으면 그 안내, 아니면 없음
export function moveBanner(summary: MoveSummary): string | null {
  if (summary.recordFailed > 0) return `옮기지 못한 기록 ${summary.recordFailed}개 · 다시 시도`;
  if (summary.affiliate?.status === "failed") return "프로젝트 소속 제안을 하지 못했습니다 · 다시 시도";
  return null;
}

// ---- 옮기기 다시 하기 ----

// 옮겨서 만든 이력 사실·머리(옮기기로 만든 것은 moved_from이 있다)
const HEAD_TABLES = [projects, activities, jobs, education, courses, credentials, gaps] as const;

// 옮겨서 만든 새 기록의 수(이력 사실 + 머리 + 사례). 경험 기록 화면의 다시 하기 단추와 확인 창이 쓴다
export async function migratedCount(db: Db, userId: string): Promise<number> {
  const tables = [...HEAD_TABLES, scenes];
  const counts = await Promise.all(
    tables.map((table) => db.select({ n: sql<number>`count(*)::int` }).from(table).where(and(eq(table.userId, userId), isNotNull(table.movedFrom)))),
  );
  return counts.reduce((sum, [row]) => sum + row.n, 0);
}

type ResetBlock = "in_use" | "edited";

const MIGRATED_TABLES = [...HEAD_TABLES, scenes] as const;
const none = (ids: string[]) => (ids.length > 0 ? ids : [""]);

// 지금 다시 하기가 막히는 까닭(막히지 않으면 null). 읽기만 한다. resetMoves는 트랜잭션 안에서 같은 검사를 한다
// - in_use: 직접 넣은 사례·프로젝트가 옮긴 머리에 딸려 있거나, 옮긴 머리·사례의 인터뷰가 진행 중이다
// - edited: 옮긴 뒤 옮긴 행을 고쳤거나(content_version > 0) 확인했거나(이어받은 확인은 옛 기록의 이른 시각이라 걸리지 않는다),
//   옮긴 머리·사례의 주장에 옮긴 뒤 답했다
export async function resetBlock(db: Db, userId: string): Promise<ResetBlock | null> {
  const migratedIds = async (table: (typeof MIGRATED_TABLES)[number]) =>
    (await db.select({ id: table.id }).from(table).where(and(eq(table.userId, userId), isNotNull(table.movedFrom)))).map((row) => row.id);
  const [project, activity, job, school, course, sceneIds] = await Promise.all([
    migratedIds(projects),
    migratedIds(activities),
    migratedIds(jobs),
    migratedIds(education),
    migratedIds(courses),
    migratedIds(scenes),
  ]);
  // 직접 넣은 사례가 옮긴 머리에 딸려 있다 / 직접 만든 프로젝트의 소속이 옮긴 경력·학교·과정이다
  const [scene] = await db
    .select({ id: scenes.id })
    .from(scenes)
    .where(
      and(
        eq(scenes.userId, userId),
        isNull(scenes.movedFrom),
        or(inArray(scenes.projectId, none(project)), inArray(scenes.activityId, none(activity)), inArray(scenes.jobId, none(job))),
      ),
    )
    .limit(1);
  const [child] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(
      and(
        eq(projects.userId, userId),
        isNull(projects.movedFrom),
        or(inArray(projects.jobId, none(job)), inArray(projects.educationId, none(school)), inArray(projects.courseId, none(course))),
      ),
    )
    .limit(1);
  const [interview] = await db
    .select({ id: interviews.id })
    .from(interviews)
    .where(
      and(
        eq(interviews.userId, userId),
        eq(interviews.status, "active"),
        or(inArray(interviews.sceneId, none(sceneIds)), inArray(interviews.headId, none([...project, ...activity, ...job]))),
      ),
    )
    .limit(1);
  if (scene || child || interview) return "in_use";

  for (const table of MIGRATED_TABLES) {
    const [row] = await db
      .select({ id: table.id })
      .from(table)
      .where(
        and(
          eq(table.userId, userId),
          isNotNull(table.movedFrom),
          or(gt(table.contentVersion, 0), sql`${table.confirmedAt} > ${table.createdAt} + interval '1 minute'`),
        ),
      )
      .limit(1);
    if (row) return "edited";
  }
  const [claim] = await db
    .select({ id: recordClaims.id })
    .from(recordClaims)
    .where(
      and(
        eq(recordClaims.userId, userId),
        sql`${recordClaims.updatedAt} > ${recordClaims.createdAt} + interval '1 minute'`,
        or(inArray(recordClaims.sceneId, none(sceneIds)), inArray(recordClaims.jobId, none(job)), inArray(recordClaims.projectId, none(project))),
      ),
    )
    .limit(1);
  return claim ? "edited" : null;
}

// 옮겨서 만든 기록을 모두 지우고 옮기기 행도 지워, 옛 기록에서 처음부터 다시 옮길 수 있게 한다. 옛 표와 다른 사용자는 건드리지 않는다.
// 막히는 까닭(resetBlock)이 있으면 아무것도 지우지 않고 그 까닭을 돌려준다
export async function resetMoves(db: Db, userId: string): Promise<{ ok: true } | { ok: false; reason: ResetBlock }> {
  return db.transaction(async (tx) => {
    // 검사하는 사이 다른 요청이 옮긴 머리·사례를 고치거나 딸림 기록을 달지 못하게 그 행을 잠근다
    for (const table of MIGRATED_TABLES) {
      await tx.select({ id: table.id }).from(table).where(and(eq(table.userId, userId), isNotNull(table.movedFrom))).for("update");
    }
    const block = await resetBlock(tx as unknown as Db, userId);
    if (block) return { ok: false as const, reason: block };

    // 사례(주장·사례 인터뷰는 cascade) → 머리 인터뷰 → 머리·이력 사실 → 옮기기 행
    const headIds = (
      await Promise.all(
        [projects, activities, jobs].map((table) => tx.select({ id: table.id }).from(table).where(and(eq(table.userId, userId), isNotNull(table.movedFrom)))),
      )
    ).flatMap((rows) => rows.map((row) => row.id));
    await tx.delete(scenes).where(and(eq(scenes.userId, userId), isNotNull(scenes.movedFrom)));
    await tx.delete(interviews).where(and(eq(interviews.userId, userId), inArray(interviews.headId, none(headIds))));
    for (const table of HEAD_TABLES) await tx.delete(table).where(and(eq(table.userId, userId), isNotNull(table.movedFrom)));
    await tx.delete(moves).where(eq(moves.userId, userId));
    return { ok: true as const };
  });
}
