import { beforeEach, expect, test } from "vitest";
import { createTestDb } from "@/db/test-db";
import type { Db } from "@/db/types";
import { user } from "@/modules/auth/schema";
import { createTrack } from "@/modules/tracks/repo";
import type { SurveyInput } from "@/modules/tracks/survey";
import { listEvidenceCandidates } from "./evidence";
import type { ExperienceInput } from "./input";
import { confirmExperience, createExperience, setTrackScope } from "./repo";

let db: Db;
let t1: string;
let t2: string;

const job: ExperienceInput = {
  name: "결제 시스템 개편",
  kind: "project",
  organization: "가나다 주식회사",
  role: "백엔드 개발",
  startMonth: "2023-03",
  endMonth: "2023-11",
  isOngoing: false,
  situation: "장애가 잦았다",
  actions: "결제 승인 API를 다시 설계했다",
  result: "장애가 줄었다",
  metrics: [{ text: "월 장애 5건에서 1건", basis: "사내 장애 보고서" }],
  notDone: "프론트엔드는 하지 않았다",
  bannedPhrases: [],
  evidenceNote: "사내 보고서 링크",
  tags: [],
};
const school: ExperienceInput = {
  ...job,
  name: "한국대학교 컴퓨터공학과",
  kind: "school",
  startMonth: "2015-03",
  endMonth: "2019-02",
  metrics: [],
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
async function track(userId: string) {
  const result = await createTrack(db, userId, survey);
  if (!result.ok) throw new Error(result.reason);
  return result.id;
}
async function add(input: ExperienceInput, userId = "u1", confirm = true) {
  const id = await createExperience(db, userId, input);
  if (confirm) await confirmExperience(db, userId, id);
  return id;
}

beforeEach(async () => {
  db = await createTestDb();
  await db.insert(user).values([
    { id: "u1", name: "A", email: "u1@example.com" },
    { id: "u2", name: "B", email: "u2@example.com" },
  ]);
  t1 = await track("u1");
  t2 = await track("u2");
});

test("확인됨·부분 확인만 나온다", async () => {
  const confirmed = await add(school); // 학력은 확인하면 확인됨
  const partial = await add(job); // 프로젝트는 확인해도 AI 판정 전에는 부분 확인
  await add({ ...job, name: "미확인" }, "u1", false);
  const list = await listEvidenceCandidates(db, "u1", t1);
  expect(list.map((c) => [c.id, c.state])).toEqual([
    [partial, "partial"],
    [confirmed, "confirmed"],
  ]); // 시작 월 최근 순
});

test("그 트랙에서 제외한 경험은 빠지고 요약만은 나온다", async () => {
  const a = await add(job);
  const b = await add({ ...job, name: "요약만" });
  const c = await add({ ...job, name: "제외" });
  await setTrackScope(db, "u1", b, t1, "summary");
  await setTrackScope(db, "u1", c, t1, "exclude");
  const ids = (await listEvidenceCandidates(db, "u1", t1)).map((x) => x.id);
  expect(ids).toContain(a);
  expect(ids).not.toContain(c);
  expect(ids).toContain(b);
});

test("다른 트랙에서 제외한 것은 이 트랙에 영향이 없다", async () => {
  const id = await add(job);
  const other = await track("u1");
  await setTrackScope(db, "u1", id, other, "exclude");
  expect((await listEvidenceCandidates(db, "u1", t1)).map((x) => x.id)).toEqual([id]);
  expect(await listEvidenceCandidates(db, "u1", other)).toEqual([]);
});

test("다른 사용자의 경험과 남의 트랙은 나오지 않는다", async () => {
  const mine = await add(job);
  await add({ ...job, name: "남의 것" }, "u2");
  expect((await listEvidenceCandidates(db, "u1", t1)).map((x) => x.id)).toEqual([mine]);
  expect(await listEvidenceCandidates(db, "u1", t2)).toEqual([]);
  expect(await listEvidenceCandidates(db, "u2", t1)).toEqual([]);
});

test("수치와 증빙 메모 칸이 없다", async () => {
  await add(job);
  const [c] = await listEvidenceCandidates(db, "u1", t1);
  expect(Object.keys(c)).not.toContain("metrics");
  expect(Object.keys(c)).not.toContain("evidenceNote");
  expect(c).toMatchObject({ name: job.name, situation: job.situation, notDone: job.notDone });
});
