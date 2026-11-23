import { eq } from "drizzle-orm";
import { beforeEach, expect, test } from "vitest";
import { createTestDb } from "@/db/test-db";
import type { Db } from "@/db/types";
import { user } from "@/modules/auth/schema";
import { createTrack } from "@/modules/tracks/repo";
import type { SurveyInput } from "@/modules/tracks/survey";
import { createFact, setFactTrackScope } from "./facts-repo";
import { listMotiveHooks } from "./motive-hooks";
import type { CourseInput, CredentialInput, EducationInput, FactInputs, JobInput, SceneInput } from "./record-input";
import type { FactKind } from "./record-options";
import { confirmScene, createScene, setSceneTrackScope } from "./scenes-repo";
import { scenes } from "./schema";

let db: Db;
let t1: string;

const job: JobInput = {
  company: "가나다 주식회사",
  department: "개발팀",
  title: "사원",
  employment: "regular",
  startMonth: "2022-03",
  endMonth: "2024-08",
  isOngoing: false,
  duties: ["결제 서버 운영"],
  bannedPhrases: [],
};
const school: EducationInput = {
  schoolName: "한국대학교",
  location: "서울",
  degree: "bachelor",
  major: "산업공학과",
  startMonth: "2016-03",
  endMonth: "2020-02",
  status: "graduated",
  gpa: "3.8",
  gpaScale: "4.5",
};
const course: CourseInput = {
  name: "Kotlin 백엔드 개발 과정",
  institution: "나다아카데미",
  startMonth: "2021-03",
  endMonth: "2021-08",
  hours: 600,
  learned: "Spring Boot로 주문 API를 만들었다",
};
const credential: CredentialInput = { type: "license", name: "정보처리기사", issuer: "한국산업인력공단", month: "2021-11", score: null };
const scene = (head: SceneInput["head"], over: Partial<SceneInput> = {}): SceneInput => ({
  head,
  title: "결제 장애 대응",
  startMonth: "2023-03",
  endMonth: "2023-11",
  isOngoing: false,
  situation: "결제 장애가 잦았다",
  judgment: null,
  actions: "승인 API를 다시 설계했다",
  result: "장애가 줄었다",
  lessons: null,
  metrics: [],
  notDone: null,
  bannedPhrases: [],
  evidenceNote: "비밀 증빙 메모",
  tags: [],
  ...over,
});
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

async function fact<K extends FactKind>(kind: K, input: FactInputs[K], confirmed = true, userId = "u1") {
  const r = await createFact(db, userId, kind, input, { confirmed });
  if (!r.ok) throw new Error(r.reason);
  return r.id;
}
// 장면을 만들고 AI 판정을 흉내 낸 뒤 확인한다
async function addScene(input: SceneInput, confirmed = true, userId = "u1") {
  const r = await createScene(db, userId, input);
  if (!r.ok) throw new Error(r.reason);
  const met = { status: "met" as const, note: null };
  await db
    .update(scenes)
    .set({ rubric: { period: met, role: met, level: met, metrics: met, evidence: { status: "unjudged", note: null } } })
    .where(eq(scenes.id, r.id));
  if (confirmed) await confirmScene(db, userId, r.id);
  return r.id;
}

beforeEach(async () => {
  db = await createTestDb();
  await db.insert(user).values([
    { id: "u1", name: "A", email: "u1@example.com" },
    { id: "u2", name: "B", email: "u2@example.com" },
  ]);
  const mine = await createTrack(db, "u1", survey);
  if (!mine.ok) throw new Error(mine.reason);
  t1 = mine.id;
});

test("확인된 사례·학력·교육·자격만 나온다", async () => {
  const jobId = await fact("job", job);
  await addScene(scene({ kind: "job", id: jobId }));
  await addScene(scene({ kind: "job", id: jobId }, { title: "미확인 사례" }), false);
  await fact("education", school);
  await fact("course", course);
  await fact("credential", credential);
  await fact("course", { ...course, name: "미확인 과정" }, false);
  const hooks = await listMotiveHooks(db, "u1", t1);
  expect(hooks).toEqual([
    { kind: "scene", label: "결제 장애 대응", detail: "결제 장애가 잦았다 / 승인 API를 다시 설계했다 / 장애가 줄었다" },
    { kind: "education", label: "한국대학교", detail: "한국대학교 · 산업공학과" },
    { kind: "course", label: "Kotlin 백엔드 개발 과정", detail: "Kotlin 백엔드 개발 과정 · 나다아카데미 · Spring Boot로 주문 API를 만들었다" },
    { kind: "credential", label: "정보처리기사", detail: "정보처리기사 · 자격증" },
  ]);
  // 경력 머리 자체, 학점, 증빙 메모는 담지 않는다
  const all = JSON.stringify(hooks);
  expect(all).not.toContain("3.8");
  expect(all).not.toContain("비밀 증빙");
});

test("머리가 미확인인 사례는 빠진다", async () => {
  const jobId = await fact("job", job, false);
  await addScene(scene({ kind: "job", id: jobId }));
  expect(await listMotiveHooks(db, "u1", t1)).toEqual([]);
});

test("트랙에서 제외한 기록은 빠진다", async () => {
  const jobId = await fact("job", job);
  const sceneId = await addScene(scene({ kind: "job", id: jobId }));
  await setSceneTrackScope(db, "u1", sceneId, t1, "exclude");
  const courseId = await fact("course", course);
  await setFactTrackScope(db, "u1", "course", courseId, t1, "exclude");
  await fact("credential", credential);
  expect((await listMotiveHooks(db, "u1", t1)).map((h) => h.label)).toEqual(["정보처리기사"]);
});

test("사례가 이력 사실보다 먼저, 20개까지", async () => {
  for (let i = 0; i < 18; i++) await fact("course", { ...course, name: `과정 ${i}` });
  const jobId = await fact("job", job);
  for (let i = 0; i < 4; i++) await addScene(scene({ kind: "job", id: jobId }, { title: `사례 ${i}` }));
  const hooks = await listMotiveHooks(db, "u1", t1);
  expect(hooks).toHaveLength(20);
  expect(hooks.slice(0, 4).every((h) => h.kind === "scene")).toBe(true);
  expect(hooks.slice(4).every((h) => h.kind === "course")).toBe(true);
});

test("사례의 내용은 300자로 자른다", async () => {
  const jobId = await fact("job", job);
  await addScene(scene({ kind: "job", id: jobId }, { situation: "가".repeat(400) }));
  const [hook] = await listMotiveHooks(db, "u1", t1);
  expect([...hook.detail]).toHaveLength(300);
});

test("다른 사용자의 기록은 나오지 않는다", async () => {
  await fact("course", course, true, "u2");
  expect(await listMotiveHooks(db, "u1", t1)).toEqual([]);
  // 남의 트랙으로 물어도 아무것도 없다
  await fact("course", course);
  expect(await listMotiveHooks(db, "u2", t1)).toEqual([]);
});
