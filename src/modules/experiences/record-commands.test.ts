import { beforeEach, afterEach, expect, test, vi } from "vitest";
import { createTestDb } from "@/db/test-db";
import type { Db } from "@/db/types";
import { user } from "@/modules/auth/schema";
import { createTrack } from "@/modules/tracks/repo";
import type { SurveyInput } from "@/modules/tracks/survey";
import { findClaims, subjectOfJob } from "./claims";
import { createFact, getFact } from "./facts-repo";
import { answerClaimCommand, deleteFactCommand, saveFact, setFactConfirmed } from "./record-commands";
import { insertRecordClaims, listRecordClaims } from "./record-claims-repo";
import type { JobInput } from "./record-input";
import { createScene } from "./scenes-repo";

let db: Db;

const OFF = "아직 열리지 않은 기능입니다";
const school = { schoolName: "한국대학교", location: "서울", degree: "bachelor", major: "컴퓨터공학", startMonth: "2015-03", endMonth: "2019-02", status: "graduated", gpa: null, gpaScale: null };
const job: JobInput = {
  company: "가나다 주식회사",
  department: null,
  title: null,
  employment: "regular",
  startMonth: "2022-01",
  endMonth: "2023-12",
  isOngoing: false,
  duties: ["주간 보고서 30건 작성 주도"],
  bannedPhrases: [],
};
const survey: SurveyInput = {
  name: "개발",
  majorCode: "20",
  jobs: [{ ncsCode: "20010202", customName: null }],
  applicantType: "new",
  experienceMonths: null,
  regions: ["seoul"],
  salaryMin: null,
  employmentTypes: ["regular"],
  importanceOrder: ["jobMatch", "location", "experience", "field", "preferred"],
  extraAnswers: {},
};

beforeEach(async () => {
  vi.stubEnv("NEW_RECORDS", "1");
  db = await createTestDb();
  await db.insert(user).values([
    { id: "u1", name: "A", email: "u1@example.com" },
    { id: "u2", name: "B", email: "u2@example.com" },
  ]);
});
afterEach(() => vi.unstubAllEnvs());

test("스위치가 꺼져 있으면 저장하지 않고 안내한다", async () => {
  vi.stubEnv("NEW_RECORDS", "");
  const result = await saveFact(db, "u1", "education", null, school, {});
  expect(result).toEqual({ ok: false, errors: {}, message: OFF });
  expect(await deleteFactCommand(db, "u1", "education", "x")).toEqual({ ok: false, message: OFF });
  expect(await setFactConfirmed(db, "u1", "education", "x", true)).toEqual({ ok: false, message: OFF });
  expect(await answerClaimCommand(db, "u1", "x", "confirm")).toEqual({ ok: false, message: OFF });
  vi.stubEnv("NEW_RECORDS", "1");
  const { listFacts } = await import("./facts-repo");
  expect((await listFacts(db, "u1")).education).toEqual([]);
});

test("잘못된 입력은 칸별 오류, 알 수 없는 종류는 찾을 수 없음", async () => {
  const bad = await saveFact(db, "u1", "education", null, { ...school, schoolName: "" }, {});
  expect(bad.ok).toBe(false);
  if (!bad.ok) expect(bad.errors.schoolName).toBeTruthy();
  expect(await saveFact(db, "u1", "nope" as never, null, school, {})).toEqual({ ok: false, errors: {}, message: "기록을 찾을 수 없습니다" });
});

test("올바른 입력은 저장되고 범위도 저장된다. 고치면 같은 id", async () => {
  const t = await createTrack(db, "u1", survey);
  if (!t.ok) throw new Error(t.reason);
  const saved = await saveFact(db, "u1", "education", null, school, { [t.id]: "summary" });
  expect(saved.ok).toBe(true);
  if (!saved.ok) return;
  const fact = await getFact(db, "u1", "education", saved.id);
  expect(fact?.value.schoolName).toBe("한국대학교");
  expect(fact?.trackScopes).toEqual({ [t.id]: "summary" });
  const again = await saveFact(db, "u1", "education", saved.id, { ...school, major: "수학" }, {});
  expect(again).toEqual({ ok: true, id: saved.id });
  expect((await getFact(db, "u1", "education", saved.id))?.value.major).toBe("수학");
  expect(await saveFact(db, "u2", "education", saved.id, school, {})).toEqual({ ok: false, errors: {}, message: "기록을 찾을 수 없습니다" });
  expect(await saveFact(db, "u1", "education", null, school, "bad")).toMatchObject({ ok: false, message: "트랙별 사용 범위를 다시 골라 주세요" });
});

test("없는 소속의 프로젝트는 소속을 찾을 수 없음", async () => {
  const result = await saveFact(db, "u1", "project", null, { name: "p", parent: { kind: "job", id: "none" }, startMonth: null, endMonth: null, isOngoing: false, role: null, tools: [], summary: null, bannedPhrases: [] }, {});
  expect(result).toEqual({ ok: false, errors: {}, message: "소속을 찾을 수 없습니다" });
});

test("장면이 달린 경력은 지울 수 없다", async () => {
  const j = await createFact(db, "u1", "job", job);
  if (!j.ok) throw new Error();
  const s = await createScene(db, "u1", { head: { kind: "job", id: j.id }, title: "장면", startMonth: null, endMonth: null, isOngoing: false, situation: null, judgment: null, actions: null, result: null, lessons: null, metrics: [], notDone: null, bannedPhrases: [], evidenceNote: null, tags: [] });
  expect(s.ok).toBe(true);
  expect(await deleteFactCommand(db, "u1", "job", j.id)).toEqual({ ok: false, message: "장면 1개가 있습니다. 장면을 먼저 지우거나 다른 곳으로 옮겨 주세요" });
  expect(await getFact(db, "u1", "job", j.id)).not.toBeNull();
  const e = await createFact(db, "u1", "education", school as never);
  if (!e.ok) throw new Error();
  expect(await deleteFactCommand(db, "u1", "education", e.id)).toEqual({ ok: true });
  expect(await deleteFactCommand(db, "u1", "education", e.id)).toEqual({ ok: false, message: "기록을 찾을 수 없습니다" });
});

test("열린 줄이 남은 경력은 맞음 불가, 줄에 답하면 가능, 고치기로 확인을 풀 수 있다", async () => {
  const j = await createFact(db, "u1", "job", job, { source: "import" });
  if (!j.ok) throw new Error();
  await insertRecordClaims(db, "u1", { kind: "job", id: j.id }, findClaims(subjectOfJob(job)));
  expect(await setFactConfirmed(db, "u1", "job", j.id, true)).toEqual({ ok: false, message: "줄 확인이 남아 있습니다" });
  const claims = await listRecordClaims(db, "u1", { kind: "job", id: j.id });
  for (const c of claims) expect(await answerClaimCommand(db, "u1", c.id, "confirm")).toEqual({ ok: true });
  expect(await setFactConfirmed(db, "u1", "job", j.id, true)).toEqual({ ok: true });
  expect((await getFact(db, "u1", "job", j.id))?.isConfirmed).toBe(true);
  expect(await setFactConfirmed(db, "u1", "job", j.id, false)).toEqual({ ok: true });
  expect(await answerClaimCommand(db, "u1", claims[0].id, "unknown")).toEqual({ ok: false, message: "이 줄에는 그 답을 할 수 없습니다" });
  expect(await answerClaimCommand(db, "u2", claims[0].id, "confirm")).toEqual({ ok: false, message: "기록을 찾을 수 없습니다" });
});
