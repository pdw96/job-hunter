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
  migratedCount,
  moveSummary,
  needsMove,
  planMoves,
  reopenAffiliate,
  retryMove,
  resetBlock,
  resetMoves,
  reviveFailedHeads,
  setMoveRoles,
} from "./move-repo";
import type { Kind } from "./options";
import { createFact, setFactTrackScope, setProjectParentIfUnset, unconfirmFact, updateFact } from "./facts-repo";
import { createTrack } from "@/modules/tracks/repo";
import { createExperience, listExperiences } from "./repo";
import { insertRecordClaims } from "./record-claims-repo";
import { createScene, setSceneTrackScope, unconfirmScene, updateScene } from "./scenes-repo";
import type { JobInput, ProjectInput, SceneInput } from "./record-input";
import { education, gaps, interviews, jobs, moves, projects, recordClaims, scenes } from "./schema";

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
  const base = { kinds: [], recordTotal: 2, recordDone: 2, recordFailed: 0, affiliate: null, classify: null, duplicateDone: 0 };
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

test("다시 시도 목록을 차례로 보내면, 앞의 것과 함께 이미 pending이 된 행도 ok다(화면의 모두 다시 시도가 멈추지 않게)", async () => {
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
  const scene = await recordOf("u1", star);
  // 한도처럼 모두 실패 처리된 경우: 장면도 failed
  await failPendingMoves(db, "u1", "한도", t0);
  expect(await retryMove(db, "u1", head!.id, t0)).toEqual({ ok: true });
  expect(await retryMove(db, "u1", scene.id, t0)).toEqual({ ok: true });
  expect((await recordOf("u1", star)).status).toBe("pending");
  // 끝난 것은 여전히 not_found
  await finishMove(db, "u1", (await claimNextMove(db, "u1", t0))!.id, { ok: true });
  const done = await recordOf("u1", job);
  expect(await retryMove(db, "u1", done.id, t0)).toEqual({ ok: false, reason: "not_found" });
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

test("머리가 실패한 채 pending으로 남은 장면은 기다림으로 세지 않고 실패로 센다(갇히지 않게)", async () => {
  const job = await createExperience(db, "u1", old("한빛전자", "job"));
  const star = await createExperience(db, "u1", old("성과 사례", "project"));
  await planMoves(db, "u1");
  await db.update(moves).set({ status: "done" }).where(and(eq(moves.userId, "u1"), eq(moves.step, "classify")));
  await db.update(moves).set({ status: "failed", error: "한도" }).where(and(eq(moves.userId, "u1"), eq(moves.oldId, job)));
  await db.update(moves).set({ status: "pending", role: "scene", ref: job }).where(and(eq(moves.userId, "u1"), eq(moves.oldId, star)));
  await db.update(moves).set({ status: "done" }).where(and(eq(moves.userId, "u1"), eq(moves.step, "affiliate")));

  const progress = await moveProgress(db, "u1");
  expect(progress.pending).toBe(0);
  expect(progress.failed.find((item) => item.name === "성과 사례")?.error).toBe("소속 기록을 옮기지 못했습니다");
  expect(await needsMove(db, "u1")).toBe(false);
  const summary = await moveSummary(db, "u1");
  expect(summary.recordFailed).toBe(2);
  expect(summary.recordDone + summary.recordFailed).toBe(summary.recordTotal);
  // 화면의 다시 시도는 그 장면의 머리를 되돌린다
  const starId = (await recordOf("u1", star)).id;
  expect(await retryMove(db, "u1", starId, t0)).toEqual({ ok: true });
  expect((await recordOf("u1", job)).status).toBe("pending");
  // 이미 기다리는 장면을 다시 보내도 ok다(모두 다시 시도가 멈추지 않게)
  expect(await retryMove(db, "u1", starId, t0)).toEqual({ ok: true });
});

test("reviveFailedHeads는 pending 장면의 실패한 머리만 pending으로 되돌린다", async () => {
  const job = await createExperience(db, "u1", old("한빛전자", "job"));
  const star = await createExperience(db, "u1", old("성과 사례", "project"));
  const other = await createExperience(db, "u1", old("한빛대학교", "school"));
  await planMoves(db, "u1");
  await db.update(moves).set({ status: "failed", error: "한도" }).where(eq(moves.userId, "u1"));
  await db.update(moves).set({ status: "pending", role: "scene", ref: job }).where(and(eq(moves.userId, "u1"), eq(moves.oldId, star)));
  await reviveFailedHeads(db, "u2", t0);
  expect((await recordOf("u1", job)).status).toBe("failed");
  await reviveFailedHeads(db, "u1", t0);
  expect(await recordOf("u1", job)).toMatchObject({ status: "pending", error: null });
  expect((await recordOf("u1", other)).status).toBe("failed");
});

test("finishMove는 countAttempt가 false면 시도 수를 늘리지 않는다(한도로 멈춘 것)", async () => {
  await createExperience(db, "u1", old("한빛상사", "job"));
  await planMoves(db, "u1");
  const claimed = await claimNextMove(db, "u1", t0);
  await finishMove(db, "u1", claimed!.id, { ok: false, error: "한도" }, t0, { countAttempt: false });
  expect((await rowsOf("u1"))[0]).toMatchObject({ status: "failed", attempts: 0 });
});

// ---- 옮기기 다시 하기 ----

const jobInput: JobInput = { company: "가나다상사", department: null, title: "사원", employment: "regular", startMonth: "2020-03", endMonth: "2022-02", isOngoing: false, duties: [], bannedPhrases: [] };
const projectInput = (name: string, parent: ProjectInput["parent"] = null): ProjectInput => ({ name, parent, startMonth: null, endMonth: null, isOngoing: false, role: null, tools: [], summary: null, bannedPhrases: [] });
const sceneInput = (head: SceneInput["head"], title: string): SceneInput => ({
  head, title, startMonth: null, endMonth: null, isOngoing: false, situation: "상황", judgment: null, actions: "한 일", result: "결과", lessons: null, metrics: [], notDone: null, bannedPhrases: [], evidenceNote: null, tags: [],
});
const okId = (r: { ok: true; id: string } | { ok: false; reason: string }) => {
  if (!r.ok) throw new Error(r.reason);
  return r.id;
};
const migrate = (n: string) => ({ source: "migrate" as const, movedFrom: n });

async function seedMigrated(userId: string) {
  const oldId = await createExperience(db, userId, old("옛 재직", "job"), "import");
  await planMoves(db, userId);
  const jobId = okId(await createFact(db, userId, "job", jobInput, migrate(oldId)));
  const projectId = okId(await createFact(db, userId, "project", projectInput("옮긴 프로젝트", { kind: "job", id: jobId }), migrate("p-old")));
  const sceneId = okId(await createScene(db, userId, sceneInput({ kind: "job", id: jobId }, "옮긴 사례"), migrate("s-old")));
  await insertRecordClaims(db, userId, { kind: "scene", id: sceneId }, [{ kind: "role", quote: "한 일", phrase: null, origin: "code", status: "pending" }]);
  okId(await createFact(db, userId, "gap", { startMonth: "2024-03", endMonth: null, note: null }, migrate("g-old")));
  return { oldId, jobId, projectId, sceneId };
}
const countOf = async (table: typeof scenes | typeof jobs | typeof projects | typeof gaps, userId: string) =>
  (await db.select().from(table).where(eq(table.userId, userId))).length;

test("resetMoves는 옮겨서 만든 기록과 옮기기 행을 지우고, 직접 넣은 기록과 옛 기록은 남기며 needsMove가 다시 true다", async () => {
  await seedMigrated("u1");
  const manualJob = okId(await createFact(db, "u1", "job", { ...jobInput, company: "직접 회사" }));
  const manualProject = okId(await createFact(db, "u1", "project", projectInput("직접 프로젝트")));
  okId(await createScene(db, "u1", sceneInput({ kind: "project", id: manualProject }, "직접 사례")));
  // 옮겨 온 머리 아래라도 사례가 옮겨 온 것이면 함께 지운다. 직접 넣은 머리 아래의 옮긴 사례도 지운다
  okId(await createScene(db, "u1", sceneInput({ kind: "job", id: manualJob }, "직접 머리 아래 옮긴 사례"), migrate("s2-old")));
  await db.update(moves).set({ status: "done" }).where(eq(moves.userId, "u1"));
  expect(await needsMove(db, "u1")).toBe(false);

  expect(await resetMoves(db, "u1")).toEqual({ ok: true });
  expect(await rowsOf("u1")).toEqual([]);
  expect(await needsMove(db, "u1")).toBe(true);
  expect(await countOf(jobs, "u1")).toBe(1);
  expect((await db.select().from(jobs).where(eq(jobs.userId, "u1")))[0].company).toBe("직접 회사");
  expect(await countOf(projects, "u1")).toBe(1);
  expect((await db.select().from(scenes).where(eq(scenes.userId, "u1"))).map((s) => s.title)).toEqual(["직접 사례"]);
  expect(await countOf(gaps, "u1")).toBe(0);
  expect(await db.select().from(recordClaims).where(eq(recordClaims.userId, "u1"))).toEqual([]);
  expect(await listExperiences(db, "u1")).toHaveLength(1); // 옛 표는 그대로
});

test("resetMoves는 다른 사용자의 기록과 옮기기 행을 건드리지 않는다", async () => {
  await seedMigrated("u1");
  await seedMigrated("u2");
  expect(await resetMoves(db, "u1")).toEqual({ ok: true });
  expect(await rowsOf("u2")).toHaveLength(1);
  expect(await countOf(jobs, "u2")).toBe(1);
  expect(await countOf(projects, "u2")).toBe(1);
  expect(await countOf(scenes, "u2")).toBe(1);
  expect(await countOf(gaps, "u2")).toBe(1);
  expect((await db.select().from(recordClaims).where(eq(recordClaims.userId, "u2"))).length).toBe(1);
});

test("옮긴 머리에 직접 넣은 사례가 딸려 있으면 in_use로 아무것도 바꾸지 않는다", async () => {
  const { jobId } = await seedMigrated("u1");
  okId(await createScene(db, "u1", sceneInput({ kind: "job", id: jobId }, "직접 사례")));
  expect(await resetMoves(db, "u1")).toEqual({ ok: false, reason: "in_use" });
  expect(await countOf(scenes, "u1")).toBe(2);
  expect(await countOf(jobs, "u1")).toBe(1);
  expect(await countOf(gaps, "u1")).toBe(1);
  expect(await rowsOf("u1")).toHaveLength(1);
});

test("옮긴 머리에 직접 만든 프로젝트가 딸려 있어도 in_use다(소속을 조용히 비우지 않는다)", async () => {
  const { jobId } = await seedMigrated("u1");
  okId(await createFact(db, "u1", "project", projectInput("직접 프로젝트", { kind: "job", id: jobId })));
  expect(await resetMoves(db, "u1")).toEqual({ ok: false, reason: "in_use" });
  expect(await countOf(projects, "u1")).toBe(2);
  expect(await countOf(jobs, "u1")).toBe(1);
  expect(await rowsOf("u1")).toHaveLength(1);
});

test("migratedCount는 옮겨서 만든 이력 사실·머리·사례를 센다", async () => {
  expect(await migratedCount(db, "u1")).toBe(0);
  await seedMigrated("u1");
  okId(await createFact(db, "u1", "job", { ...jobInput, company: "직접 회사" }));
  expect(await migratedCount(db, "u1")).toBe(4); // 재직·프로젝트·사례·공백
  expect(await migratedCount(db, "u2")).toBe(0);
});

test("moveSummary는 같은 기록이라 옮기지 않은(done) 개수를 따로 돌려준다", async () => {
  await createExperience(db, "u1", old("가", "school"));
  await createExperience(db, "u1", old("나", "school"));
  await planMoves(db, "u1");
  const [a, b] = await db.select().from(moves).where(and(eq(moves.userId, "u1"), eq(moves.step, "record")));
  await db.update(moves).set({ role: "duplicate", ref: b.oldId, status: "done" }).where(eq(moves.id, a.id));
  await db.update(moves).set({ role: "duplicate", ref: a.oldId, status: "pending" }).where(eq(moves.id, b.id));
  expect((await moveSummary(db, "u1")).duplicateDone).toBe(1);
});

// ---- 다시 하기가 막히는 경우 ----

const later = (n = 5) => new Date(Date.now() + n * 60_000);
const manualEducation = (userId: string) =>
  db.insert(education).values({ id: `edu-${userId}`, userId, schoolName: "학교", degree: "bachelor", status: "graduated", movedFrom: "e-old" } as typeof education.$inferInsert);
const addInterview = (userId: string, values: Partial<typeof interviews.$inferInsert>) =>
  db.insert(interviews).values({ id: `iv-${Math.random()}`, userId, messages: [], status: "active", ...values });
const unchanged = async (userId: string) => {
  expect(await rowsOf(userId)).toHaveLength(1);
  expect(await countOf(jobs, userId)).toBe(1);
  expect(await countOf(scenes, userId)).toBeGreaterThanOrEqual(1);
};

test("옮긴 활동에 직접 넣은 사례가 딸려 있으면 in_use다", async () => {
  await seedMigrated("u1");
  const { activities } = await import("./schema");
  await db.insert(activities).values({ id: "act1", userId: "u1", name: "활동", movedFrom: "a-old" } as typeof activities.$inferInsert);
  okId(await createScene(db, "u1", sceneInput({ kind: "activity", id: "act1" }, "직접 사례")));
  expect(await resetBlock(db, "u1")).toBe("in_use");
  expect(await resetMoves(db, "u1")).toEqual({ ok: false, reason: "in_use" });
  await unchanged("u1");
});

test("옮긴 학력·교육 아래 직접 만든 프로젝트가 있으면 in_use다", async () => {
  await seedMigrated("u1");
  await manualEducation("u1");
  const { courses } = await import("./schema");
  await db.insert(courses).values({ id: "crs1", userId: "u1", name: "과정", movedFrom: "c-old" } as typeof courses.$inferInsert);
  okId(await createFact(db, "u1", "project", projectInput("학교 프로젝트", { kind: "education", id: "edu-u1" })));
  expect(await resetBlock(db, "u1")).toBe("in_use");
  await db.delete(projects).where(eq(projects.name, "학교 프로젝트"));
  okId(await createFact(db, "u1", "project", projectInput("과정 프로젝트", { kind: "course", id: "crs1" })));
  expect(await resetMoves(db, "u1")).toEqual({ ok: false, reason: "in_use" });
  await unchanged("u1");
});

test("옮긴 머리·사례의 진행 중인 인터뷰가 있으면 in_use, 끝난 인터뷰는 막지 않는다", async () => {
  const { jobId, sceneId } = await seedMigrated("u1");
  await addInterview("u1", { headKind: "job", headId: jobId });
  expect(await resetBlock(db, "u1")).toBe("in_use");
  await db.delete(interviews);
  await addInterview("u1", { sceneId });
  expect(await resetMoves(db, "u1")).toEqual({ ok: false, reason: "in_use" });
  await unchanged("u1");
  await db.update(interviews).set({ status: "done" });
  expect(await resetBlock(db, "u1")).toBeNull();
});

test("resetMoves는 옮긴 머리·사례의 주장과 인터뷰를 함께 지운다(재직·프로젝트 주장, 사례·머리 인터뷰)", async () => {
  const { jobId, projectId, sceneId } = await seedMigrated("u1");
  await insertRecordClaims(db, "u1", { kind: "job", id: jobId }, [{ kind: "role", quote: "재직", phrase: null, origin: "code", status: "pending" }]);
  await insertRecordClaims(db, "u1", { kind: "project", id: projectId }, [{ kind: "role", quote: "프로젝트", phrase: null, origin: "code", status: "pending" }]);
  await addInterview("u1", { sceneId, status: "done" });
  await addInterview("u1", { headKind: "job", headId: jobId, status: "done" });
  await addInterview("u2", { headKind: "job", headId: "other", status: "done" });
  expect((await db.select().from(recordClaims).where(eq(recordClaims.userId, "u1"))).length).toBe(3);
  expect(await resetMoves(db, "u1")).toEqual({ ok: true });
  expect(await db.select().from(recordClaims).where(eq(recordClaims.userId, "u1"))).toEqual([]);
  // 사례 인터뷰는 cascade로 지워지고, 머리 인터뷰는 고아로 남는다(화면이 머리가 없는 것을 처리한다)
  const left = await db.select().from(interviews).where(eq(interviews.userId, "u1"));
  expect(left.map((row) => row.headId)).toEqual([jobId]);
  expect(await db.select().from(interviews).where(eq(interviews.userId, "u2"))).toHaveLength(1);
});

test("옮긴 뒤 고친 행(content_version > 0)이 있으면 edited로 아무것도 바꾸지 않는다", async () => {
  const { jobId } = await seedMigrated("u1");
  expect(await resetBlock(db, "u1")).toBeNull();
  await db.update(jobs).set({ contentVersion: 1 }).where(eq(jobs.id, jobId));
  expect(await resetBlock(db, "u1")).toBe("edited");
  expect(await resetMoves(db, "u1")).toEqual({ ok: false, reason: "edited" });
  await unchanged("u1");
});

test("옮긴 뒤 확인한 행(confirmed_at이 만든 때보다 5초 넘게 뒤)이 있으면 edited다. 장면이어도 마찬가지다", async () => {
  const { sceneId, projectId } = await seedMigrated("u1");
  await db.update(projects).set({ confirmedAt: new Date(Date.now() + 2_000) }).where(eq(projects.id, projectId));
  expect(await resetBlock(db, "u1")).toBeNull(); // 5초 안은 같은 때로 본다
  await db.update(scenes).set({ confirmedAt: later(5) }).where(eq(scenes.id, sceneId));
  expect(await resetMoves(db, "u1")).toEqual({ ok: false, reason: "edited" });
  await unchanged("u1");
});

test("이어받은 확인(confirmed_at이 만든 때보다 앞)은 막지 않는다", async () => {
  const { jobId } = await seedMigrated("u1");
  await db.update(jobs).set({ confirmedAt: new Date("2020-01-01T00:00:00Z") }).where(eq(jobs.id, jobId));
  expect(await resetBlock(db, "u1")).toBeNull();
  expect(await resetMoves(db, "u1")).toEqual({ ok: true });
});

test("옮긴 뒤 답한 주장(updated_at이 만든 때보다 5초 넘게 뒤)이 있으면 edited다", async () => {
  await seedMigrated("u1");
  await db.update(recordClaims).set({ updatedAt: later(5), status: "confirmed" as never });
  expect(await resetBlock(db, "u1")).toBe("edited");
  expect(await resetMoves(db, "u1")).toEqual({ ok: false, reason: "edited" });
  await unchanged("u1");
  expect((await db.select().from(recordClaims).where(eq(recordClaims.userId, "u1"))).length).toBe(1);
});

test("직접 만든 행을 고쳤거나 다른 사용자가 고친 것은 edited로 세지 않는다", async () => {
  await seedMigrated("u1");
  await seedMigrated("u2");
  const manualJob = okId(await createFact(db, "u1", "job", { ...jobInput, company: "직접 회사" }));
  await db.update(jobs).set({ contentVersion: 3, confirmedAt: later(10) }).where(eq(jobs.id, manualJob));
  await db.update(jobs).set({ contentVersion: 3 }).where(eq(jobs.userId, "u2"));
  expect(await resetBlock(db, "u1")).toBeNull();
  expect(await resetBlock(db, "u2")).toBe("edited");
});

test("resetBlock은 옮긴 기록이 없으면 null이다", async () => {
  expect(await resetBlock(db, "u1")).toBeNull();
});

// ---- 시각으로 본 "옮긴 뒤 고침" ----

// 옮길 때 쓴 행은 한 번에 쓰므로 updated_at = created_at이다. 사용자가 고친 것을 흉내 내려고 모두 한 시간 전으로 돌려 둔다
async function backdate() {
  const past = new Date(Date.now() - 3_600_000);
  for (const table of [jobs, projects, scenes, gaps, education]) await db.update(table).set({ createdAt: past, updatedAt: past } as never);
  await db.update(recordClaims).set({ createdAt: past, updatedAt: past });
}
const survey = { name: "개발", majorCode: "20", jobs: [{ ncsCode: "20010202", customName: null }], applicantType: "new", experienceMonths: null, regions: ["seoul"], salaryMin: null, employmentTypes: ["regular"], importanceOrder: ["jobMatch", "location", "experience", "field", "preferred"], extraAnswers: {} } as const;
async function trackOf(userId: string) {
  const r = await createTrack(db, userId, survey as never);
  if (!r.ok) throw new Error(r.reason);
  return r.id;
}

test("옮긴 직후(고치지 않은) 사용자는 막히지 않는다", async () => {
  await seedMigrated("u1");
  expect(await resetBlock(db, "u1")).toBeNull();
});

test("content_version·confirmed_at을 건드리지 않는 사용자 수정도 edited로 막는다", async () => {
  const { jobId, projectId, sceneId } = await seedMigrated("u1");
  const track = await trackOf("u1");
  const edits: [string, () => Promise<unknown>][] = [
    ["재직 금지 표현", () => db.update(jobs).set({ bannedPhrases: ["x"], updatedAt: new Date() }).where(eq(jobs.id, jobId))],
    ["프로젝트 저장", () => updateFact(db, "u1", "project", projectId, { ...projectInput("옮긴 프로젝트", { kind: "job", id: jobId }), bannedPhrases: ["과장"] })],
    ["사례 금지 표현·증빙·태그", () => updateScene(db, "u1", sceneId, { ...sceneInput({ kind: "job", id: jobId }, "옮긴 사례"), bannedPhrases: ["과장"], evidenceNote: "증빙", tags: ["a"] })],
    ["재직 트랙 범위", () => setFactTrackScope(db, "u1", "job", jobId, track, "summary")],
    ["사례 트랙 범위", () => setSceneTrackScope(db, "u1", sceneId, track, "summary")],
    ["공백 확인 해제", () => unconfirmFact(db, "u1", "gap", "none")],
    ["사례 확인 해제", () => unconfirmScene(db, "u1", sceneId)],
  ];
  for (const [label, edit] of edits) {
    await backdate();
    await db.update(jobs).set({ trackScopes: {} }).where(eq(jobs.userId, "u1"));
    expect(await resetBlock(db, "u1"), `${label} 전`).toBeNull();
    if (label === "공백 확인 해제") {
      const [gap] = await db.select().from(gaps).where(eq(gaps.userId, "u1"));
      expect(await unconfirmFact(db, "u1", "gap", gap.id)).toEqual({ ok: true });
    } else {
      await edit();
    }
    expect(await resetBlock(db, "u1"), label).toBe("edited");
  }
});

test("소속 잇기(affiliate)의 부모 쓰기는 edited로 세지 않는다", async () => {
  const { jobId } = await seedMigrated("u1");
  const free = okId(await createFact(db, "u1", "project", projectInput("소속 없음"), migrate("p2-old")));
  await backdate();
  expect(await setProjectParentIfUnset(db, "u1", free, { kind: "job", id: jobId })).toMatchObject({ ok: true, changed: true });
  expect(await resetBlock(db, "u1")).toBeNull();
});

test("다시 하기는 옮긴 사용자 주장 행도 잠가 막는 사이 답이 끼어들지 못하게 한다(주장 답이 있으면 막는다)", async () => {
  await seedMigrated("u1");
  await backdate();
  await db.update(recordClaims).set({ updatedAt: new Date() });
  expect(await resetMoves(db, "u1")).toEqual({ ok: false, reason: "edited" });
});
