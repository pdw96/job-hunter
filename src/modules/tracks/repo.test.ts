import { eq } from "drizzle-orm";
import { beforeEach, expect, test } from "vitest";
import { createTestDb } from "@/db/test-db";
import type { Db } from "@/db/types";
import { user } from "@/modules/auth/schema";
import { countTracks, createTrack, getTrack, listTracks, updateTrack } from "./repo";
import { trackJobs, tracks } from "./schema";
import type { SurveyInput } from "./survey";

let db: Db;

const input: SurveyInput = {
  name: "백엔드 개발",
  majorCode: "20",
  jobs: [
    { ncsCode: "20010202", customName: null },
    { ncsCode: null, customName: "그로스 해커" },
    { ncsCode: "20010204", customName: null },
  ],
  applicantType: "experienced",
  experienceMonths: 30,
  regions: ["seoul", "gyeonggi"],
  salaryMin: 4000,
  employmentTypes: ["regular"],
  importanceOrder: ["jobMatch", "location", "experience", "field", "preferred"],
  extraAnswers: { remoteWork: "prefer" },
};

async function create(userId: string, overrides: Partial<SurveyInput> = {}) {
  const result = await createTrack(db, userId, { ...input, ...overrides });
  if (!result.ok) throw new Error(result.reason);
  return result.id;
}

beforeEach(async () => {
  db = await createTestDb();
  await db.insert(user).values([
    { id: "u1", name: "A", email: "u1@example.com" },
    { id: "u2", name: "B", email: "u2@example.com" },
  ]);
});

test("만든 트랙을 본인이 다시 읽으면 입력과 같고 배점이 순서대로 붙는다", async () => {
  const id = await create("u1");
  const track = await getTrack(db, "u1", id);
  expect(track).toMatchObject({ ...input, id });
  expect(track?.weights).toEqual({ jobMatch: 30, location: 25, experience: 20, field: 15, preferred: 10 });
});

test("다른 사용자의 트랙은 읽히지 않고 목록에도 나오지 않는다", async () => {
  const id = await create("u1");
  expect(await getTrack(db, "u2", id)).toBeNull();
  expect(await listTracks(db, "u2")).toEqual([]);
});

test("다른 사용자의 트랙을 고치려 하면 not_found이고 원래 값이 그대로다", async () => {
  const id = await create("u1");
  expect(await updateTrack(db, "u2", id, { ...input, name: "탈취" })).toEqual({ ok: false, reason: "not_found" });
  expect((await getTrack(db, "u1", id))?.name).toBe("백엔드 개발");
});

test("없는 NCS 코드나 세분류가 아닌 코드는 invalid_job이고 트랙이 만들어지지 않는다", async () => {
  const result = await createTrack(db, "u1", { ...input, jobs: [{ ncsCode: "99999999", customName: null }] });
  expect(result).toEqual({ ok: false, reason: "invalid_job" });
  expect(await db.select().from(tracks)).toEqual([]);
  expect(await db.select().from(trackJobs)).toEqual([]);
});

test("없는 분야 코드는 invalid_major다", async () => {
  expect(await createTrack(db, "u1", { ...input, majorCode: "99" })).toEqual({ ok: false, reason: "invalid_major" });
  expect(await createTrack(db, "u1", { ...input, majorCode: "0201".slice(0, 2) + "" })).toMatchObject({ ok: true });
});

test("목록은 만든 순서이고 직무 이름을 순서대로 담는다", async () => {
  await create("u1");
  await create("u1", { name: "기획", majorCode: "02", jobs: [{ ncsCode: "02010101", customName: null }], extraAnswers: {} });
  const list = await listTracks(db, "u1");
  expect(list.map((t) => t.name)).toEqual(["백엔드 개발", "기획"]);
  expect(list[0].jobNames).toEqual(["응용SW엔지니어링", "그로스 해커", "DB엔지니어링"]);
  expect(list[1].jobNames).toEqual(["경영기획"]);
});

test("고치면 직무 목록이 새 것으로 바뀌고 배점도 다시 계산된다", async () => {
  const id = await create("u1");
  const result = await updateTrack(db, "u1", id, {
    ...input,
    jobs: [{ ncsCode: "20010401", customName: null }],
    importanceOrder: ["location", "jobMatch", "experience", "field", "preferred"],
  });
  expect(result).toEqual({ ok: true });
  const track = await getTrack(db, "u1", id);
  expect(track?.jobs).toEqual([{ ncsCode: "20010401", customName: null }]);
  expect(track?.weights.location).toBe(30);
  expect(await db.select().from(trackJobs).where(eq(trackJobs.trackId, id))).toHaveLength(1);
});

test("잘못된 직무로 고치려 하면 원래 직무가 그대로 남는다", async () => {
  const id = await create("u1");
  const result = await updateTrack(db, "u1", id, { ...input, jobs: [{ ncsCode: "99999999", customName: null }] });
  expect(result).toEqual({ ok: false, reason: "invalid_job" });
  expect((await getTrack(db, "u1", id))?.jobs).toHaveLength(3);
});

test("사용자를 지우면 트랙과 직무가 함께 지워진다", async () => {
  await create("u1");
  await db.delete(user).where(eq(user.id, "u1"));
  expect(await db.select().from(tracks)).toEqual([]);
  expect(await db.select().from(trackJobs)).toEqual([]);
});

test("트랙 수는 본인 것만 센다", async () => {
  await create("u1");
  await create("u1");
  await create("u2");
  expect(await countTracks(db, "u1")).toBe(2);
  expect(await countTracks(db, "u2")).toBe(1);
});
