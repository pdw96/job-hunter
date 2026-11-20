import { and, eq } from "drizzle-orm";
import { beforeEach, expect, test } from "vitest";
import { createTestDb } from "@/db/test-db";
import type { Db } from "@/db/types";
import { user } from "@/modules/auth/schema";
import type { ExperienceInput } from "./input";
import { claimNextMove, finishMove, moveProgress, needsMove, planMoves, retryMove } from "./move-repo";
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
  expect((await rowsOf("u1")).map((row) => row.step)).toEqual(["record", "record"]);

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
  await planMoves(db, "u1");
  const [a, b] = await Promise.all([claimNextMove(db, "u1", t0), claimNextMove(db, "u1", t0)]);
  expect(a).not.toBeNull();
  expect(b).not.toBeNull();
  expect(a?.id).not.toBe(b?.id);
  // 둘 다 잡혀 있으면 더 잡을 것이 없다
  expect(await claimNextMove(db, "u1", t0)).toBeNull();
  const rows = await rowsOf("u1");
  expect(rows.every((row) => row.status === "running")).toBe(true);
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
  await planMoves(db, "u1");

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
  await planMoves(db, "u1");
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
  await planMoves(db, "u1");
  expect(await needsMove(db, "u1")).toBe(true);

  const a = await claimNextMove(db, "u1", t0);
  const b = await claimNextMove(db, "u1", t0);
  expect(await needsMove(db, "u1")).toBe(true); // running
  await finishMove(db, "u1", a!.id, { ok: true });
  await finishMove(db, "u1", b!.id, { ok: false, error: "실패" });
  expect(await needsMove(db, "u1")).toBe(false);
});

test("moveProgress는 수와 실패한 기록의 이름을 돌려준다", async () => {
  await createExperience(db, "u1", old("가나다상사", "job"));
  await createExperience(db, "u1", old("한국대학교", "school"));
  await createExperience(db, "u1", old("결제 개편", "project"));
  await planMoves(db, "u1");
  expect(await moveProgress(db, "u1")).toEqual({ total: 4, done: 0, failed: [], pending: 4 });

  const claimed = await claimNextMove(db, "u1", t0);
  const [row] = await db.select().from(moves).where(and(eq(moves.userId, "u1"), eq(moves.id, claimed!.id)));
  await finishMove(db, "u1", claimed!.id, { ok: false, error: "나눌 내용을 찾지 못했습니다" });
  const next = await claimNextMove(db, "u1", t0);
  await finishMove(db, "u1", next!.id, { ok: true });

  const progress = await moveProgress(db, "u1");
  expect(progress.total).toBe(4);
  expect(progress.done).toBe(1);
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
