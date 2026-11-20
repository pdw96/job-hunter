import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, lt, notExists, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Db } from "@/db/types";
import type { Kind } from "./options";
import { type ExperienceSummary, listExperiences } from "./repo";
import { moves } from "./schema";

// 옛 기록을 새 표로 옮기는 일의 목록(experiences_moves). 옛 기록 하나가 record 행 하나이고,
// 모두 끝난 뒤 옮긴 프로젝트의 소속을 잇는 affiliate 행이 사용자마다 하나까지 있다. 옛 표는 읽기만 한다.

export type MoveProgress = { total: number; done: number; failed: { id: string; name: string; error: string }[]; pending: number };
export type ClaimedMove = { id: string; step: "record" | "affiliate"; oldId: string | null };

// running인 채로 이만큼 지나면 멈춘 것으로 보고 다시 잡는다(화면을 닫았거나 서버가 끊김)
const STALE_MS = 5 * 60_000;
const AFFILIATE_NAME = "프로젝트 소속 잇기";
// 프로젝트가 딸릴 조직이 되는 옛 구분(재직·학력·교육)
const PARENT_KINDS: readonly Kind[] = ["job", "school", "training"];

// 옮긴 프로젝트와 조직이 될 기록이 모두 있어야 소속을 이을 일이 있다
const needsAffiliate = (old: ExperienceSummary[]) =>
  old.some((item) => item.kind === "project") && old.some((item) => PARENT_KINDS.includes(item.kind));

export async function planMoves(db: Db, userId: string): Promise<void> {
  const old = await listExperiences(db, userId);
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

export async function needsMove(db: Db, userId: string): Promise<boolean> {
  const [old, rows] = await Promise.all([
    listExperiences(db, userId),
    db.select({ step: moves.step, oldId: moves.oldId, status: moves.status }).from(moves).where(eq(moves.userId, userId)),
  ]);
  const covered = new Set(rows.map((row) => row.oldId));
  if (old.some((item) => !covered.has(item.id))) return true;
  if (needsAffiliate(old) && !rows.some((row) => row.step === "affiliate")) return true;
  return rows.some((row) => row.status === "pending" || row.status === "running");
}

// 할 일 하나를 running으로 잡는다. 고르기와 바꾸기를 한 문장으로 해서, 동시에 불러도 같은 행을 둘이 잡지 않는다.
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
  const next = db
    .select({ id: moves.id })
    .from(moves)
    .where(and(eq(moves.userId, userId), claimable, or(eq(moves.step, "record"), notExists(recordsLeft))))
    .orderBy(sql`${moves.step} = 'affiliate'`, asc(moves.updatedAt), asc(moves.id))
    .limit(1);
  const [row] = await db
    .update(moves)
    .set({ status: "running", startedAt: now, updatedAt: now })
    // 동시에 같은 행을 고른 쪽은 앞 문장이 끝날 때까지 기다린 뒤 이 조건을 새 값으로 다시 보고(Postgres의 다시 읽기), 0행이 된다.
    // FOR UPDATE SKIP LOCKED는 PGlite에서 잡을 행을 건너뛰는 일이 있어 쓰지 않는다
    .where(and(eq(moves.userId, userId), inArray(moves.id, next), claimable))
    .returning({ id: moves.id, step: moves.step, oldId: moves.oldId });
  return row ?? null;
}

export async function finishMove(
  db: Db,
  userId: string,
  id: string,
  // ok여도 note가 있으면(일부를 옮기지 못함) error 칸에 남겨 화면이 보여 주게 한다
  result: { ok: true; note?: string } | { ok: false; error: string },
  now: Date = new Date(),
): Promise<void> {
  await db
    .update(moves)
    .set({
      status: result.ok ? "done" : "failed",
      error: result.ok ? (result.note ?? null) : result.error,
      attempts: sql`${moves.attempts} + 1`,
      updatedAt: now,
    })
    .where(and(eq(moves.id, id), eq(moves.userId, userId)));
}

// 실패한 것만 다시 pending으로 돌린다
export async function retryMove(
  db: Db,
  userId: string,
  id: string,
  now: Date = new Date(),
): Promise<{ ok: true } | { ok: false; reason: "not_found" }> {
  const updated = await db
    .update(moves)
    .set({ status: "pending", error: null, startedAt: null, updatedAt: now })
    .where(and(eq(moves.id, id), eq(moves.userId, userId), eq(moves.status, "failed")))
    .returning({ id: moves.id });
  return updated.length > 0 ? { ok: true } : { ok: false, reason: "not_found" };
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
  const failedRows = rows.filter((row) => row.status === "failed");
  // 실패한 기록은 옛 이름으로 보여 준다(화면용. AI에는 보내지 않는다)
  const names = failedRows.some((row) => row.oldId !== null)
    ? new Map((await listExperiences(db, userId)).map((item) => [item.id, item.name]))
    : new Map<string, string>();
  return {
    total: rows.length,
    done: rows.filter((row) => row.status === "done").length,
    failed: failedRows.map((row) => ({
      id: row.id,
      name: row.oldId === null ? AFFILIATE_NAME : (names.get(row.oldId) ?? "지워진 기록"),
      error: row.error ?? "",
    })),
    pending: rows.filter((row) => row.status === "pending" || row.status === "running").length,
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
export type MoveSummary = { kinds: KindMove[]; recordTotal: number; recordDone: number; recordFailed: number; affiliate: { id: string; status: "pending" | "running" | "done" | "failed"; error: string } | null };

export async function moveSummary(db: Db, userId: string): Promise<MoveSummary> {
  const [rows, old] = await Promise.all([
    db.select().from(moves).where(eq(moves.userId, userId)).orderBy(asc(moves.updatedAt), asc(moves.id)),
    listExperiences(db, userId),
  ]);
  const byId = new Map(old.map((item) => [item.id, item]));
  const kinds = new Map<Kind, KindMove>();
  let affiliate: MoveSummary["affiliate"] = null;
  for (const row of rows) {
    if (row.step === "affiliate" || row.oldId === null) {
      affiliate = { id: row.id, status: row.status, error: row.error ?? "" };
      continue;
    }
    const item = byId.get(row.oldId);
    if (!item) continue; // 옛 기록이 지워졌으면 줄에 넣지 않는다
    const entry = kinds.get(item.kind) ?? { kind: item.kind, total: 0, done: 0, failed: [], notes: [] };
    entry.total += 1;
    if (row.status === "done") {
      entry.done += 1;
      if (row.error) entry.notes.push(row.error);
    } else if (row.status === "failed") {
      entry.failed.push({ id: row.id, name: item.name, error: row.error ?? "" });
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
  };
}

// /records 위의 띠 문구. 기록이 실패했으면 그 개수, 소속 제안만 실패했으면 그 안내, 아니면 없음
export function moveBanner(summary: MoveSummary): string | null {
  if (summary.recordFailed > 0) return `옮기지 못한 기록 ${summary.recordFailed}개 · 다시 시도`;
  if (summary.affiliate?.status === "failed") return "프로젝트 소속 제안을 하지 못했습니다 · 다시 시도";
  return null;
}
