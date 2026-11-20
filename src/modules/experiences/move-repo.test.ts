import { and, eq } from "drizzle-orm";
import { beforeEach, expect, test } from "vitest";
import { createTestDb } from "@/db/test-db";
import type { Db } from "@/db/types";
import { user } from "@/modules/auth/schema";
import type { ExperienceInput } from "./input";
import {
  claimNextMove,
  failPendingMoves,
  finishMove,
  hasSceneMoves,
  moveBanner,
  moveProgress,
  moveSummary,
  needsMove,
  planMoves,
  reopenAffiliate,
  retryMove,
  setMoveRoles,
} from "./move-repo";
import type { Kind } from "./options";
import { createExperience } from "./repo";
import { moves } from "./schema";

let db: Db;
const t0 = new Date("2026-11-20T03:00:00Z");
const minutes = (n: number) => new Date(t0.getTime() + n * 60_000);

const old = (name: string, kind: Kind): ExperienceInput => ({
  name,
  kind,
  organization: null,
  role: null,
  startMonth: "2022-03",
  endMonth: "2023-02",
  isOngoing: false,
  situation: null,
  actions: null,
  result: null,
  metrics: [],
  notDone: null,
  bannedPhrases: [],
  evidenceNote: null,
  tags: [],
});

const rowsOf = (userId: string) => db.select().from(moves).where(eq(moves.userId, userId));

// 정리(classify)가 끝난 상태로 할 일을 만든다(기록 행끼리의 순서만 보는 테스트용)
async function planClassified(userId: string) {
  await planMoves(db, userId);
  await db.update(moves).set({ status: "done" }).where(and(eq(moves.userId, userId), eq(moves.step, "classify")));
}

beforeEach(async () => {
  db = await createTestDb();
  await db.insert(user).values([
    { id: "u1", name: "A", email: "u1@example.com" },
    { id: "u2", name: "B", email: "u2@example.com" },
  ]);
});

test("planMoves는 옛 기록마다 record 행을 만들고, 몇 번 불러도 같다", async () => {
  await createExperience(db, "u1", old("결제 개편", "project"));
  await createExperience(db, "u1", old("가나다상사", "job"));
  await planMoves(db, "u1");
  await planMoves(db, "u1");
  const rows = await rowsOf("u1");
  // 프로젝트와 재직이 모두 있으므로 affiliate 행도 하나
  expect(rows.filter((row) => row.step === "record")).toHaveLength(2);
  expect(rows.filter((row) => row.step === "affiliate")).toHaveLength(1);
  expect(rows.every((row) => row.status === "pending")).toBe(true);
});

test("동시에 planMoves를 불러도 affiliate 행은 하나다", async () => {
  await createExperience(db, "u1", old("결제 개편", "project"));
  await createExperience(db, "u1", old("한국대학교", "school"));
  await Promise.all([planMoves(db, "u1"), planMoves(db, "u1"), planMoves(db, "u1")]);
  const rows = await rowsOf("u1");
  expect(rows.filter((row) => row.step === "affiliate")).toHaveLength(1);
});

test("프로젝트나 조직이 될 기록이 없으면 affiliate 행을 만들지 않는다", async () => {
  await createExperience(db, "u1", old("결제 개편", "project"));
  await createExperience(db, "u1", old("봉사", "other"));
  await planMoves(db, "u1");
  expect((await rowsOf("u1")).map((row) => row.step).sort()).toEqual(["classify", "record", "record"]);

  await createExperience(db, "u2", old("가나다상사", "job"));
  await planMoves(db, "u2");
  expect((await rowsOf("u2")).map((row) => row.step)).toEqual(["record"]);
});

test("나중에 생긴 옛 기록은 다시 부를 때 더한다", async () => {
  await createExperience(db, "u1", old("가나다상사", "job"));
  await planMoves(db, "u1");
  await createExperience(db, "u1", old("결제 개편", "project"));
  expect(await needsMove(db, "u1")).toBe(true);
  await planMoves(db, "u1");
  const rows = await rowsOf("u1");
  expect(rows.filter((row) => row.step === "record")).toHaveLength(2);
  expect(rows.filter((row) => row.step === "affiliate")).toHaveLength(1);
});

test("동시에 두 번 돌려도 하나만 옮긴다", async () => {
  await createExperience(db, "u1", old("가나다상사", "job"));
  await createExperience(db, "u1", old("나라상사", "job"));
  await planClassified("u1");
  const [a, b] = await Promise.all([claimNextMove(db, "u1", t0), claimNextMove(db, "u1", t0)]);
  expect(a).not.toBeNull();
  expect(b).not.toBeNull();
  expect(a?.id).not.toBe(b?.id);
  // 둘 다 잡혀 있으면 더 잡을 것이 없다
  expect(await claimNextMove(db, "u1", t0)).toBeNull();
  const rows = await rowsOf("u1");
  expect(rows.filter((row) => row.step === "record").every((row) => row.status === "running")).toBe(true);
});

test("running이 5분 지나면 다시 잡는다", async () => {
  await createExperience(db, "u1", old("가나다상사", "job"));
  await planMoves(db, "u1");
  const first = await claimNextMove(db, "u1", t0);
  expect(first).toMatchObject({ step: "record" });
  expect(await claimNextMove(db, "u1", minutes(4))).toBeNull();
  const again = await claimNextMove(db, "u1", minutes(6));
  expect(again?.id).toBe(first?.id);
  // 다시 잡으면 시작 시각이 새로 적혀, 곧바로 또 잡히지 않는다
  expect(await claimNextMove(db, "u1", minutes(7))).toBeNull();
});

test("affiliate는 record가 모두 done·failed일 때만 잡힌다", async () => {
  const projectId = await createExperience(db, "u1", old("결제 개편", "project"));
  const jobId = await createExperience(db, "u1", old("가나다상사", "job"));
  await planClassified("u1");

  const first = await claimNextMove(db, "u1", t0);
  expect(first?.step).toBe("record");
  const second = await claimNextMove(db, "u1", t0);
  expect(second?.step).toBe("record");
  expect([first?.oldId, second?.oldId].sort()).toEqual([projectId, jobId].sort());
  // record가 running이면 affiliate는 아직 잡히지 않는다
  expect(await claimNextMove(db, "u1", t0)).toBeNull();

  await finishMove(db, "u1", first!.id, { ok: true });
  expect(await claimNextMove(db, "u1", t0)).toBeNull();
  await finishMove(db, "u1", second!.id, { ok: false, error: "나눌 내용을 찾지 못했습니다" });
  const affiliate = await claimNextMove(db, "u1", t0);
  expect(affiliate).toMatchObject({ step: "affiliate", oldId: null });
});

test("affiliate는 record가 하나라도 pending이면 잡히지 않는다", async () => {
  await createExperience(db, "u1", old("결제 개편", "project"));
  await createExperience(db, "u1", old("가나다상사", "job"));
  await planClassified("u1");
  const first = await claimNextMove(db, "u1", t0);
  await finishMove(db, "u1", first!.id, { ok: true });
  const next = await claimNextMove(db, "u1", t0);
  expect(next?.step).toBe("record");
});

test("finishMove는 상태와 오류를 적고 시도 수를 늘린다. retryMove는 실패한 것을 pending으로 되돌린다", async () => {
  await createExperience(db, "u1", old("가나다상사", "job"));
  await planMoves(db, "u1");
  const claimed = await claimNextMove(db, "u1", t0);
  await finishMove(db, "u1", claimed!.id, { ok: false, error: "AI 서비스에 연결하지 못했습니다" });
  let [row] = await rowsOf("u1");
  expect(row).toMatchObject({ status: "failed", attempts: 1, error: "AI 서비스에 연결하지 못했습니다" });

  expect(await retryMove(db, "u1", claimed!.id)).toEqual({ ok: true });
  [row] = await rowsOf("u1");
  expect(row).toMatchObject({ status: "pending", error: null });

  const again = await claimNextMove(db, "u1", t0);
  await finishMove(db, "u1", again!.id, { ok: true });
  [row] = await rowsOf("u1");
  expect(row).toMatchObject({ status: "done", attempts: 2, error: null });
  // 끝난 것은 되돌리지 않는다
  expect(await retryMove(db, "u1", again!.id)).toEqual({ ok: false, reason: "not_found" });
});

test("needsMove는 행이 없는 옛 기록이나 남은 일이 있을 때만 true다", async () => {
  expect(await needsMove(db, "u1")).toBe(false);
  await createExperience(db, "u1", old("가나다상사", "job"));
  await createExperience(db, "u1", old("한국대학교", "school"));
  expect(await needsMove(db, "u1")).toBe(true);
  await planClassified("u1");
  expect(await needsMove(db, "u1")).toBe(true);

  const a = await claimNextMove(db, "u1", t0);
  const b = await claimNextMove(db, "u1", t0);
  expect(await needsMove(db, "u1")).toBe(true); // running
  await finishMove(db, "u1", a!.id, { ok: true });
  await finishMove(db, "u1", b!.id, { ok: false, error: "실패" });
  expect(await needsMove(db, "u1")).toBe(false);
});

test("needsMove: 모든 옛 기록에 행이 있어도 소속 잇기 행이 빠졌으면 true, 다 끝났으면 false다", async () => {
  await createExperience(db, "u1", old("가나다상사", "job"));
  await createExperience(db, "u1", old("결제 개편", "project"));
  await planMoves(db, "u1");
  // record 행만 남기고 affiliate 행이 없는 상태(만들다 끊긴 경우)
  await db.delete(moves).where(and(eq(moves.userId, "u1"), eq(moves.step, "affiliate")));
  await db.update(moves).set({ status: "done" }).where(eq(moves.userId, "u1"));
  expect(await needsMove(db, "u1")).toBe(true);
  await planMoves(db, "u1");
  expect(await needsMove(db, "u1")).toBe(true); // 새 affiliate 행이 pending
  await db.update(moves).set({ status: "done" }).where(eq(moves.userId, "u1"));
  expect(await needsMove(db, "u1")).toBe(false);
  // 다른 사용자의 옛 기록과 행은 보지 않는다
  await createExperience(db, "u2", old("남의 회사", "job"));
  expect(await needsMove(db, "u1")).toBe(false);
});

test("moveProgress는 수와 실패한 기록의 이름을 돌려준다", async () => {
  await createExperience(db, "u1", old("가나다상사", "job"));
  await createExperience(db, "u1", old("한국대학교", "school"));
  await createExperience(db, "u1", old("결제 개편", "project"));
  await planClassified("u1");
  // 기록 셋 + 소속 잇기 + 끝난 정리
  expect(await moveProgress(db, "u1")).toEqual({ total: 5, done: 1, failed: [], pending: 4 });

  const claimed = await claimNextMove(db, "u1", t0);
  const [row] = await db.select().from(moves).where(and(eq(moves.userId, "u1"), eq(moves.id, claimed!.id)));
  await finishMove(db, "u1", claimed!.id, { ok: false, error: "나눌 내용을 찾지 못했습니다" });
  const next = await claimNextMove(db, "u1", t0);
  await finishMove(db, "u1", next!.id, { ok: true });

  const progress = await moveProgress(db, "u1");
  expect(progress.total).toBe(5);
  expect(progress.done).toBe(2);
  expect(progress.pending).toBe(2);
  expect(progress.failed).toHaveLength(1);
  expect(progress.failed[0].id).toBe(row.id);
  expect(progress.failed[0].error).toBe("나눌 내용을 찾지 못했습니다");
  expect(["가나다상사", "한국대학교", "결제 개편"]).toContain(progress.failed[0].name);
});

test("다른 사용자의 행은 잡지도 보지도 못한다", async () => {
  await createExperience(db, "u1", old("가나다상사", "job"));
  await planMoves(db, "u1");
  expect(await claimNextMove(db, "u2", t0)).toBeNull();
  expect(await needsMove(db, "u2")).toBe(false);
  expect(await moveProgress(db, "u2")).toEqual({ total: 0, done: 0, failed: [], pending: 0 });

  const claimed = await claimNextMove(db, "u1", t0);
  await finishMove(db, "u2", claimed!.id, { ok: true });
  const [row] = await rowsOf("u1");
  expect(row.status).toBe("running");
  await finishMove(db, "u1", claimed!.id, { ok: false, error: "실패" });
  expect(await retryMove(db, "u2", claimed!.id)).toEqual({ ok: false, reason: "not_found" });
  expect((await rowsOf("u1"))[0].status).toBe("failed");
  // u2가 planMoves를 불러도 u1의 기록으로 행을 만들지 않는다
  await planMoves(db, "u2");
  expect(await rowsOf("u2")).toEqual([]);
});

test("finishMove는 ok여도 메모가 있으면 error 칸에 남기고, finishMove·retryMove는 받은 시각을 쓴다", async () => {
  await createExperience(db, "u1", old("가나다상사", "job"));
  await planMoves(db, "u1");
  const claimed = await claimNextMove(db, "u1", t0);
  await finishMove(db, "u1", claimed!.id, { ok: true, note: "1개는 검사를 통과하지 못해 옮기지 못했습니다" }, minutes(1));
  let [row] = await rowsOf("u1");
  expect(row).toMatchObject({ status: "done", error: "1개는 검사를 통과하지 못해 옮기지 못했습니다", updatedAt: minutes(1) });
  expect(await moveProgress(db, "u1")).toMatchObject({ done: 1, failed: [] });

  await db.update(moves).set({ status: "failed" }).where(eq(moves.id, claimed!.id));
  await retryMove(db, "u1", claimed!.id, minutes(2));
  [row] = await rowsOf("u1");
  expect(row).toMatchObject({ status: "pending", updatedAt: minutes(2) });
});

test("reopenAffiliate는 끝난 affiliate 행만 pending으로 되돌린다", async () => {
  await createExperience(db, "u1", old("결제 개편", "project"));
  await createExperience(db, "u1", old("가나다상사", "job"));
  await planMoves(db, "u1");
  await db.update(moves).set({ status: "done" }).where(eq(moves.userId, "u1"));
  await reopenAffiliate(db, "u1", t0);
  await reopenAffiliate(db, "u2", t0);
  const rows = await rowsOf("u1");
  expect(rows.find((row) => row.step === "affiliate")?.status).toBe("pending");
  expect(rows.filter((row) => row.step === "record").every((row) => row.status === "done")).toBe(true);
});

test("moveSummary는 옛 구분마다 전체·완료·실패·메모를 모은다", async () => {
  const school = await createExperience(db, "u1", old("한국대학교", "school"));
  await createExperience(db, "u1", old("가나다상사", "job"));
  const training = await createExperience(db, "u1", old("부트캠프", "training"));
  await createExperience(db, "u2", old("남의 학교", "school"));
  await planMoves(db, "u1");
  const rows = await rowsOf("u1");
  const of = (oldId: string) => rows.find((row) => row.oldId === oldId)!;
  await finishMove(db, "u1", of(school).id, { ok: true, note: "사례 1개는 옮기지 못했습니다" });
  await finishMove(db, "u1", of(training).id, { ok: false, error: "AI의 답을 읽지 못했습니다" });

  const summary = await moveSummary(db, "u1");
  expect(summary.affiliate).toBeNull();
  const byKind = Object.fromEntries(summary.kinds.map((k) => [k.kind, k]));
  expect(byKind.school).toMatchObject({ total: 1, done: 1, failed: [], notes: ["사례 1개는 옮기지 못했습니다"] });
  expect(byKind.job).toMatchObject({ total: 1, done: 0, failed: [], notes: [] });
  expect(byKind.training).toMatchObject({ total: 1, done: 0, notes: [] });
  expect(byKind.training.failed).toEqual([{ id: of(training).id, name: "부트캠프", error: "AI의 답을 읽지 못했습니다" }]);
  expect(summary.kinds).toHaveLength(3);
});

test("moveBanner는 기록 실패, 소속 제안만 실패, 실패 없음을 가른다", () => {
  const base = { kinds: [], recordTotal: 2, recordDone: 2, recordFailed: 0, affiliate: null, classify: null };
  const failedAffiliate = { id: "a", status: "failed" as const, error: "x" };
  expect(moveBanner(base)).toBeNull();
  expect(moveBanner({ ...base, affiliate: failedAffiliate })).toBe("프로젝트 소속 제안을 하지 못했습니다 · 다시 시도");
  expect(moveBanner({ ...base, recordFailed: 1, affiliate: failedAffiliate })).toBe("옮기지 못한 기록 1개 · 다시 시도");
});

// ---- 정리(classify) ----

const classifyOf = async (userId: string) => (await rowsOf(userId)).filter((row) => row.step === "classify");
const recordOf = async (userId: string, oldId: string) => (await rowsOf(userId)).find((row) => row.oldId === oldId)!;

test("planMoves는 옛 기록이 둘 이상이면 classify 행을 하나 만들고, 동시에 몇 번 불러도 하나다", async () => {
  await createExperience(db, "u1", old("한빛대학교", "school"));
  await createExperience(db, "u1", old("한빛대학교", "school"));
  await Promise.all([planMoves(db, "u1"), planMoves(db, "u1"), planMoves(db, "u1")]);
  const rows = await classifyOf("u1");
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ status: "pending", oldId: null, role: null, ref: null });
  // 옛 기록이 하나면 정리할 것이 없다
  await createExperience(db, "u2", old("한빛상사", "job"));
  await planMoves(db, "u2");
  expect(await classifyOf("u2")).toEqual([]);
});

test("이미 옮기기를 시작한(끝난 행이 있는) 사용자에게는 classify 행을 더하지 않는다", async () => {
  await createExperience(db, "u1", old("한빛대학교", "school"));
  await createExperience(db, "u1", old("한빛상사", "job"));
  await planMoves(db, "u1");
  // 정리가 없던 때 옮긴 사용자처럼 classify 행을 지우고 기록 행을 끝낸다
  await db.delete(moves).where(and(eq(moves.userId, "u1"), eq(moves.step, "classify")));
  await db.update(moves).set({ status: "done" }).where(eq(moves.userId, "u1"));
  await planMoves(db, "u1");
  expect(await classifyOf("u1")).toEqual([]);
  expect(await needsMove(db, "u1")).toBe(false);
});

test("classify가 먼저 잡히고, 끝나기 전(pending·running·failed)에는 기록 행이 잡히지 않는다", async () => {
  await createExperience(db, "u1", old("한빛대학교", "school"));
  await createExperience(db, "u1", old("한빛상사", "job"));
  await planMoves(db, "u1");
  const first = await claimNextMove(db, "u1", t0);
  expect(first).toMatchObject({ step: "classify", oldId: null });
  expect(await claimNextMove(db, "u1", t0)).toBeNull(); // running
  await finishMove(db, "u1", first!.id, { ok: false, error: "AI 서비스에 연결하지 못했습니다" });
  expect(await claimNextMove(db, "u1", t0)).toBeNull(); // failed: 기록은 기다린다
  const records = (await rowsOf("u1")).filter((row) => row.step === "record");
  expect(records.every((row) => row.status === "pending")).toBe(true);
  // 실패한 정리는 진행에서 기다림으로 세지 않아 화면이 멈추고, 실패 줄에 이름이 나온다
  const progress = await moveProgress(db, "u1");
  expect(progress.pending).toBe(0);
  expect(progress.failed).toEqual([{ id: first!.id, name: "같은 기록·사례 정리", error: "AI 서비스에 연결하지 못했습니다" }]);
  // 다시 시도하면 정리부터
  expect(await retryMove(db, "u1", first!.id, t0)).toEqual({ ok: true });
  const again = await claimNextMove(db, "u1", t0);
  expect(again?.step).toBe("classify");
  await finishMove(db, "u1", again!.id, { ok: true });
  expect((await claimNextMove(db, "u1", t0))?.step).toBe("record");
});

test("setMoveRoles는 끝나지 않은 기록 행에 역할과 짝을 적고, claimNextMove는 장면을 머리가 done일 때만 잡는다", async () => {
  const job = await createExperience(db, "u1", old("한빛전자", "job"));
  const star = await createExperience(db, "u1", old("성과 사례 · 재고 정리 (STAR)", "project"));
  const school = await createExperience(db, "u1", old("한빛대학교", "school"));
  await planMoves(db, "u1");
  const classify = await claimNextMove(db, "u1", t0);
  await setMoveRoles(db, "u1", [
    { oldId: job, role: "head", ref: null },
    { oldId: star, role: "scene", ref: job },
    { oldId: school, role: "fact", ref: null },
  ]);
  await setMoveRoles(db, "u2", [{ oldId: school, role: "duplicate", ref: job }]); // 남의 것은 바뀌지 않는다
  await finishMove(db, "u1", classify!.id, { ok: true });
  expect(await recordOf("u1", star)).toMatchObject({ role: "scene", ref: job });
  expect(await recordOf("u1", school)).toMatchObject({ role: "fact", ref: null });
  expect(await hasSceneMoves(db, "u1", job)).toBe(true);
  expect(await hasSceneMoves(db, "u1", school)).toBe(false);
  expect(await hasSceneMoves(db, "u2", job)).toBe(false);

  const a = await claimNextMove(db, "u1", t0);
  const b = await claimNextMove(db, "u1", t0);
  expect([a?.oldId, b?.oldId].sort()).toEqual([job, school].sort());
  expect(await claimNextMove(db, "u1", t0)).toBeNull(); // 머리가 아직 running
  const jobMove = a?.oldId === job ? a : b;
  expect(jobMove).toMatchObject({ role: "head", ref: null });
  await finishMove(db, "u1", jobMove!.id, { ok: true });
  const scene = await claimNextMove(db, "u1", t0);
  expect(scene).toMatchObject({ step: "record", oldId: star, role: "scene", ref: job });
});

test("머리가 실패하면 기다리던 장면도 실패하고, 머리를 다시 시도하면 장면도 pending이 된다", async () => {
  const job = await createExperience(db, "u1", old("한빛전자", "job"));
  const star = await createExperience(db, "u1", old("성과 사례 · 재고 정리 (STAR)", "project"));
  await planMoves(db, "u1");
  const classify = await claimNextMove(db, "u1", t0);
  await setMoveRoles(db, "u1", [
    { oldId: job, role: "head", ref: null },
    { oldId: star, role: "scene", ref: job },
  ]);
  await finishMove(db, "u1", classify!.id, { ok: true });
  const head = await claimNextMove(db, "u1", t0);
  await finishMove(db, "u1", head!.id, { ok: false, error: "AI 서비스에 연결하지 못했습니다" });
  expect(await recordOf("u1", star)).toMatchObject({ status: "failed", error: "소속 기록을 옮기지 못했습니다" });
  // 남은 기록이 없으니 소속 잇기로 넘어간다
  const affiliate = await claimNextMove(db, "u1", t0);
  expect(affiliate?.step).toBe("affiliate");
  await finishMove(db, "u1", affiliate!.id, { ok: true });

  await retryMove(db, "u1", head!.id, t0);
  expect(await recordOf("u1", star)).toMatchObject({ status: "pending", error: null });
  // 장면만 다시 시도해도 실패한 머리가 함께 pending이 된다
  const again = await claimNextMove(db, "u1", t0);
  await finishMove(db, "u1", again!.id, { ok: false, error: "x" });
  await retryMove(db, "u1", (await recordOf("u1", star)).id, t0);
  expect((await recordOf("u1", job)).status).toBe("pending");
  expect((await claimNextMove(db, "u1", t0))?.oldId).toBe(job);
});

test("기록 행을 다시 시도하면 실패한 정리도 pending이 된다(정리 없이 기다리기만 하지 않게)", async () => {
  const school = await createExperience(db, "u1", old("한빛대학교", "school"));
  await createExperience(db, "u1", old("한빛상사", "job"));
  await planMoves(db, "u1");
  await failPendingMoves(db, "u1", "한도", t0);
  expect((await classifyOf("u1"))[0].status).toBe("failed");
  await retryMove(db, "u1", (await recordOf("u1", school)).id, t0);
  expect((await classifyOf("u1"))[0].status).toBe("pending");
  expect((await claimNextMove(db, "u1", t0))?.step).toBe("classify");
});

test("moveSummary는 classify 행을 구분 줄에 넣지 않고 따로 돌려주며, 같은 기록(done)도 옮김으로 센다", async () => {
  const a = await createExperience(db, "u1", old("한빛대학교", "school"));
  const b = await createExperience(db, "u1", old("한빛대학교", "school"));
  await planMoves(db, "u1");
  const classify = (await classifyOf("u1"))[0];
  let summary = await moveSummary(db, "u1");
  expect(summary.classify).toEqual({ id: classify.id, status: "pending", error: "" });
  expect(summary.affiliate).toBeNull();
  expect(summary.recordTotal).toBe(2);
  await finishMove(db, "u1", classify.id, { ok: true });
  await finishMove(db, "u1", (await recordOf("u1", a)).id, { ok: true });
  await finishMove(db, "u1", (await recordOf("u1", b)).id, { ok: true, note: "같은 기록이 있어 하나만 옮겼습니다" });
  summary = await moveSummary(db, "u1");
  expect(summary).toMatchObject({ recordTotal: 2, recordDone: 2, recordFailed: 0, classify: { status: "done" } });
  expect(summary.kinds).toHaveLength(1);
});

test("claimNextMove는 지금까지 시도한 수를 함께 돌려준다", async () => {
  await createExperience(db, "u1", old("한빛대학교", "school"));
  await createExperience(db, "u1", old("한빛상사", "job"));
  await planMoves(db, "u1");
  const first = await claimNextMove(db, "u1", t0);
  expect(first).toMatchObject({ step: "classify", attempts: 0 });
  await finishMove(db, "u1", first!.id, { ok: false, error: "x" });
  await retryMove(db, "u1", first!.id, t0);
  expect(await claimNextMove(db, "u1", t0)).toMatchObject({ step: "classify", attempts: 1 });
});
