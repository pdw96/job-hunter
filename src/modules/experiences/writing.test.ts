import { eq } from "drizzle-orm";
import { beforeEach, expect, test } from "vitest";
import { createTestDb } from "@/db/test-db";
import type { Db } from "@/db/types";
import { user } from "@/modules/auth/schema";
import { createTrack } from "@/modules/tracks/repo";
import type { SurveyInput } from "@/modules/tracks/survey";
import type { ExperienceInput } from "./input";
import { confirmExperience, createExperience, setTrackScope } from "./repo";
import { experiences } from "./schema";
import { listWritingSources } from "./writing";

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
  bannedPhrases: ["주도"],
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
// 프로젝트를 확인됨으로 만든다(AI 판정을 흉내 낸다). metrics는 충족 여부를 고른다
async function addConfirmedJob(input: ExperienceInput, userId = "u1", metrics: "met" | "unmet" = "met") {
  const id = await createExperience(db, userId, input);
  await db
    .update(experiences)
    .set({
      rubric: {
        period: { status: "met", note: null },
        role: { status: "met", note: null },
        level: { status: "met", note: null },
        metrics: { status: metrics, note: null },
        evidence: { status: "unjudged", note: null },
      },
    })
    .where(eq(experiences.id, id));
  await confirmExperience(db, userId, id);
  return id;
}
async function addSchool(input: ExperienceInput = school, userId = "u1") {
  const id = await createExperience(db, userId, input);
  await confirmExperience(db, userId, id);
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

test("확인됨만 나오고 부분 확인·미확인은 빠진다", async () => {
  const confirmed = await addSchool();
  const job1 = await addConfirmedJob(job);
  const partial = await createExperience(db, "u1", { ...job, name: "부분" });
  await confirmExperience(db, "u1", partial); // 판정 전이라 부분 확인
  await createExperience(db, "u1", { ...job, name: "미확인" });
  const list = await listWritingSources(db, "u1", t1);
  expect(list.map((s) => s.id)).toEqual([job1, confirmed]); // 시작 월 최근 순
  expect(list[0]).toMatchObject({ name: job.name, situation: job.situation, notDone: job.notDone, bannedPhrases: ["주도"], contentVersion: 0 });
});

test("요약만·제외인 경험은 빠진다", async () => {
  const a = await addConfirmedJob(job);
  const b = await addConfirmedJob({ ...job, name: "요약만" });
  const c = await addConfirmedJob({ ...job, name: "제외" });
  await setTrackScope(db, "u1", b, t1, "summary");
  await setTrackScope(db, "u1", c, t1, "exclude");
  expect((await listWritingSources(db, "u1", t1)).map((s) => s.id)).toEqual([a]);
});

test("수치가 충족이 아니면 metrics가 빈 배열이다", async () => {
  const met = await addConfirmedJob(job);
  const unmet = await addConfirmedJob({ ...job, name: "수치 미달" }, "u1", "unmet");
  const list = await listWritingSources(db, "u1", t1);
  expect(list.find((s) => s.id === met)?.metrics).toEqual(job.metrics);
  expect(list.find((s) => s.id === unmet)?.metrics).toEqual([]);
});

test("다른 사용자의 경험과 남의 트랙은 나오지 않는다", async () => {
  const mine = await addConfirmedJob(job);
  await addConfirmedJob({ ...job, name: "남의 것" }, "u2");
  expect((await listWritingSources(db, "u1", t1)).map((s) => s.id)).toEqual([mine]);
  expect(await listWritingSources(db, "u1", t2)).toEqual([]);
  expect(await listWritingSources(db, "u2", t1)).toEqual([]);
});

test("증빙 메모 칸이 없다", async () => {
  await addConfirmedJob(job);
  const [s] = await listWritingSources(db, "u1", t1);
  expect(Object.keys(s)).not.toContain("evidenceNote");
});
