import { eq } from "drizzle-orm";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createTestDb } from "@/db/test-db";
import type { Db } from "@/db/types";
import { recordUsage } from "@/modules/ai/usage";
import { createFakeAi } from "@/modules/ai/fake-client";
import { user } from "@/modules/auth/schema";
import { insertClaims } from "./claims-repo";
import type { ExperienceInput } from "./input";
import { moveNext, retryMoveCommand } from "./move-commands";
import { moveProgress, needsMove, planMoves } from "./move-repo";
import { confirmExperience, createExperience } from "./repo";
import { experiences, moves, type StoredRubric } from "./schema";

let db: Db;
const OFF = "아직 열리지 않은 기능입니다";

const old = (over: Partial<ExperienceInput> & Pick<ExperienceInput, "kind" | "name">): ExperienceInput => ({
  organization: "가나다 주식회사",
  role: "백엔드 개발",
  startMonth: "2023-03",
  endMonth: "2023-11",
  isOngoing: false,
  situation: "결제 장애가 잦았다",
  actions: "결제 승인 API 개편을 주도했다",
  result: "장애가 줄었다",
  metrics: [],
  notDone: null,
  bannedPhrases: [],
  evidenceNote: null,
  tags: [],
  ...over,
});

const allMet: StoredRubric = {
  period: { status: "met", note: null },
  role: { status: "met", note: null },
  level: { status: "met", note: null },
  metrics: { status: "met", note: null },
  evidence: { status: "closed", note: null },
};

const emptyImport = { education: [], courses: [], credentials: [], gaps: [], jobs: [], projects: [], activities: [], more: false };
const schoolImport = {
  ...emptyImport,
  education: [
    { schoolName: "한국대학교", location: "", degree: "bachelor", major: "경영학과", startMonth: "2016-03", endMonth: "2022-02", status: "graduated", gpa: "", gpaScale: "" },
  ],
};

// 첫 줄로 요청 종류를 가려 답한다(나누기 → 학력, 소속 → 짝 없음)
function ai() {
  const answer = (request: { messages: { text: string }[] }) =>
    request.messages[0].text.startsWith("[옮기기: 소속]") ? { links: [] } : schoolImport;
  return createFakeAi([answer, answer, answer, answer]);
}

async function seed() {
  const projectId = await createExperience(db, "u1", old({ kind: "project", name: "결제 개편" }), "import");
  await insertClaims(db, projectId, [{ kind: "role", quote: "결제 승인 API 개편을 주도했다", phrase: "주도", origin: "code", status: "confirmed" }]);
  await db.update(experiences).set({ rubric: allMet }).where(eq(experiences.id, projectId));
  const confirmed = await confirmExperience(db, "u1", projectId);
  if (!confirmed.ok) throw new Error(confirmed.reason);
  await createExperience(db, "u1", old({ kind: "school", name: "한국대학교", organization: "한국대학교" }));
}

beforeEach(async () => {
  vi.stubEnv("NEW_RECORDS", "1");
  delete process.env.AI_MONTHLY_LIMIT_USD;
  db = await createTestDb();
  await db.insert(user).values([
    { id: "u1", name: "A", email: "u1@example.com" },
    { id: "u2", name: "B", email: "u2@example.com" },
  ]);
});

afterEach(() => vi.unstubAllEnvs());

test("스위치가 꺼져 있으면 거절한다", async () => {
  vi.stubEnv("NEW_RECORDS", "");
  await seed();
  expect(await moveNext(db, ai(), "u1")).toEqual({ ok: false, message: OFF });
  expect(await retryMoveCommand(db, "u1", "x")).toEqual({ ok: false, message: OFF });
  expect(await db.select().from(moves)).toHaveLength(0);
});

test("옛 기록 둘(확인된 프로젝트, 학력)을 한 번에 하나씩 끝까지 옮긴다", async () => {
  await seed();
  const fake = ai();
  const results = [];
  for (let i = 0; i < 3; i += 1) results.push(await moveNext(db, fake, "u1"));
  expect(results.every((r) => r.ok)).toBe(true);
  // 기록 둘 + 프로젝트가 있고 학교가 있어 소속 잇기 하나
  expect(results[0]).toMatchObject({ ok: true, progress: { total: 3, done: 1, pending: 2 } });
  expect(results[2]).toEqual({ ok: true, progress: { total: 3, done: 3, pending: 0, failed: [] } });
  // 끝난 뒤 더 불러도 같다
  expect(await moveNext(db, fake, "u1")).toMatchObject({ ok: true, progress: { done: 3, pending: 0 } });
});

test("한도에 닿으면 문구를 돌려주고 그 행은 failed로 남고, 다시 시도하면 pending이 된다", async () => {
  await seed();
  process.env.AI_MONTHLY_LIMIT_USD = "1";
  await recordUsage(db, "u1", { purpose: "judge", model: "claude-sonnet-5-5", usage: { inputTokens: 0, outputTokens: 100_000, cacheReadTokens: 0, cacheWriteTokens: 0 }, at: new Date() });
  const fake = ai();
  const outcomes = [];
  for (let i = 0; i < 2; i += 1) outcomes.push(await moveNext(db, fake, "u1"));
  const limited = outcomes.find((r) => !r.ok);
  expect(limited).toEqual({ ok: false, message: "이번 달 AI 사용 한도에 닿았습니다. 다음 달에 다시 시도해 주세요" });

  const progress = await moveProgress(db, "u1");
  // 한도로 멈춘 행과 남은 소속 잇기가 함께 실패로 남는다
  expect(progress.failed.map((item) => item.name)).toEqual(expect.arrayContaining(["한국대학교", "프로젝트 소속 잇기"]));
  expect(progress.pending).toBe(0);

  const school = progress.failed.find((item) => item.name === "한국대학교")!;
  expect(await retryMoveCommand(db, "u1", school.id)).toEqual({ ok: true });
  expect((await moveProgress(db, "u1")).failed).toHaveLength(progress.failed.length - 1);
  expect((await moveProgress(db, "u1")).pending).toBeGreaterThan(0);
  // 실패하지 않은 행이나 모르는 행은 다시 시도할 수 없다
  expect(await retryMoveCommand(db, "u1", "nope")).toEqual({ ok: false, message: "다시 시도할 기록을 찾을 수 없습니다" });
});

test("다른 사용자의 이동 행은 다시 시도할 수 없다", async () => {
  await seed();
  await planMoves(db, "u1");
  const [row] = await db.select().from(moves);
  await db.update(moves).set({ status: "failed", error: "x" }).where(eq(moves.id, row.id));
  expect(await retryMoveCommand(db, "u2", row.id)).toMatchObject({ ok: false });
});

test("한도에 닿으면 남은 기록과 소속 잇기도 실패로 두어 앱에 들어올 수 있다", async () => {
  for (const name of ["가대학교", "나대학교", "다대학교"]) await createExperience(db, "u1", old({ kind: "school", name, organization: name }));
  process.env.AI_MONTHLY_LIMIT_USD = "1";
  await recordUsage(db, "u1", { purpose: "judge", model: "claude-sonnet-5-5", usage: { inputTokens: 0, outputTokens: 100_000, cacheReadTokens: 0, cacheWriteTokens: 0 }, at: new Date() });
  expect(await needsMove(db, "u1")).toBe(true);
  expect(await moveNext(db, ai(), "u1")).toMatchObject({ ok: false });
  const progress = await moveProgress(db, "u1");
  expect(progress.failed).toHaveLength(3);
  expect(progress.pending).toBe(0);
  expect(await needsMove(db, "u1")).toBe(false);
});
