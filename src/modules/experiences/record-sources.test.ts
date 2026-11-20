import { eq } from "drizzle-orm";
import { beforeEach, expect, test } from "vitest";
import { createTestDb } from "@/db/test-db";
import type { Db } from "@/db/types";
import { user } from "@/modules/auth/schema";
import { createTrack } from "@/modules/tracks/repo";
import type { SurveyInput } from "@/modules/tracks/survey";
import { confirmFact, createFact, setFactTrackScope, updateFact } from "./facts-repo";
import type { FactKind } from "./record-options";
import type { EducationInput, FactInputs, JobInput, ProjectInput, SceneInput } from "./record-input";
import { listRecordEvidence, listRecordResumeSources, listSceneWritingSources, recordNames } from "./record-sources";
import { confirmScene, createScene, deleteScene, setSceneTrackScope } from "./scenes-repo";
import { scenes } from "./schema";

let db: Db;
let t1: string;
let t2: string;

const job: JobInput = {
  company: "가나다 주식회사",
  department: "개발팀",
  title: "사원",
  employment: "regular",
  startMonth: "2022-03",
  endMonth: "2024-08",
  isOngoing: false,
  duties: ["결제 서버 운영", "장애 대응"],
  bannedPhrases: ["주도"],
};
const project: ProjectInput = {
  name: "사내 정산 도구",
  parent: null,
  startMonth: "2023-01",
  endMonth: "2023-06",
  isOngoing: false,
  role: "백엔드",
  tools: [],
  summary: null,
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
  metrics: [{ text: "월 장애 5건에서 1건", basis: "장애 보고서" }],
  notDone: null,
  bannedPhrases: ["혼자 구축"],
  evidenceNote: null,
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

async function track(userId: string) {
  const result = await createTrack(db, userId, survey);
  if (!result.ok) throw new Error(result.reason);
  return result.id;
}
async function fact<K extends FactKind>(kind: K, input: FactInputs[K], confirmed = true, userId = "u1") {
  const r = await createFact(db, userId, kind, input, { confirmed });
  if (!r.ok) throw new Error(r.reason);
  return r.id;
}
// 장면을 만들고 AI 판정을 흉내 낸다. state: confirmed는 필수 항목 충족 + 맞음, partial은 역할 미달 + 맞음
async function addScene(
  input: SceneInput,
  options: { state?: "confirmed" | "partial" | "unconfirmed"; metrics?: "met" | "unmet" } = {},
  userId = "u1",
) {
  const r = await createScene(db, userId, input);
  if (!r.ok) throw new Error(r.reason);
  const state = options.state ?? "confirmed";
  await db
    .update(scenes)
    .set({
      rubric: {
        period: { status: "met", note: null },
        role: { status: state === "partial" ? "unmet" : "met", note: null },
        level: { status: "met", note: null },
        metrics: { status: options.metrics ?? "met", note: null },
        evidence: { status: "unjudged", note: null },
      },
    })
    .where(eq(scenes.id, r.id));
  if (state !== "unconfirmed") await confirmScene(db, userId, r.id);
  return r.id;
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

// 자기소개서 원천

test("확인된 장면이라도 머리가 미확인이면 자소서 원천에 없고 채점 근거에는 있다", async () => {
  const jobId = await fact("job", job, false);
  const id = await addScene(scene({ kind: "job", id: jobId }));
  expect(await listSceneWritingSources(db, "u1", t1)).toEqual([]);
  expect((await listRecordEvidence(db, "u1", t1)).map((c) => c.id)).toEqual([id]);
});

test("머리를 확인하면 자소서 원천에 있고 소속은 회사 · 부서다", async () => {
  const jobId = await fact("job", job);
  const id = await addScene(scene({ kind: "job", id: jobId }, { judgment: "재시도보다 설계 변경", lessons: "작게 나눠 배포" }));
  const [source] = await listSceneWritingSources(db, "u1", t1);
  expect(source).toMatchObject({
    id,
    name: "결제 장애 대응",
    kind: "job",
    organization: "가나다 주식회사 · 개발팀",
    role: "사원",
    startMonth: "2023-03",
    endMonth: "2023-11",
    isOngoing: false,
    situation: "결제 장애가 잦았다",
    actions: "판단: 재시도보다 설계 변경\n승인 API를 다시 설계했다",
    result: "장애가 줄었다\n배운 점: 작게 나눠 배포",
    notDone: null,
    bannedPhrases: ["혼자 구축"],
    metrics: [{ text: "월 장애 5건에서 1건", basis: "장애 보고서" }],
  });
});

test("장면의 기간이 비면 머리의 기간을 쓰고, 프로젝트의 소속은 프로젝트 이름 · 소속 이름이다", async () => {
  const schoolId = await fact("education", school);
  const projectId = await fact("project", { ...project, parent: { kind: "education", id: schoolId } });
  await addScene(scene({ kind: "project", id: projectId }, { startMonth: null, endMonth: null }));
  const [source] = await listSceneWritingSources(db, "u1", t1);
  expect(source).toMatchObject({ kind: "project", organization: "사내 정산 도구 · 한국대학교", role: "백엔드", startMonth: "2023-01", endMonth: "2023-06" });
});

test("머리 범위가 요약만이면 장면 범위가 사용이어도 자소서 원천에 없다", async () => {
  const jobId = await fact("job", job);
  await addScene(scene({ kind: "job", id: jobId }));
  await setFactTrackScope(db, "u1", "job", jobId, t1, "summary");
  expect(await listSceneWritingSources(db, "u1", t1)).toEqual([]);
});

test("장면의 수치는 루브릭 수치가 충족일 때만 담는다", async () => {
  const jobId = await fact("job", job);
  await addScene(scene({ kind: "job", id: jobId }), { metrics: "unmet" });
  const [source] = await listSceneWritingSources(db, "u1", t1);
  expect(source.metrics).toEqual([]);
});

test("머리 이름을 고치면 그 장면의 contentVersion이 바뀐다", async () => {
  const jobId = await fact("job", job);
  await addScene(scene({ kind: "job", id: jobId }));
  const before = (await listSceneWritingSources(db, "u1", t1))[0].contentVersion;
  await updateFact(db, "u1", "job", jobId, { ...job, company: "라마바 주식회사" });
  await confirmFact(db, "u1", "job", jobId);
  const after = (await listSceneWritingSources(db, "u1", t1))[0].contentVersion;
  expect(after).not.toBe(before);
});

test("자소서 원천은 기간 시작 월 최근 순이다", async () => {
  const jobId = await fact("job", job);
  const old = await addScene(scene({ kind: "job", id: jobId }, { title: "옛 일", startMonth: "2022-04", endMonth: "2022-05" }));
  const recent = await addScene(scene({ kind: "job", id: jobId }, { title: "최근 일", startMonth: "2024-01", endMonth: "2024-02" }));
  expect((await listSceneWritingSources(db, "u1", t1)).map((s) => s.id)).toEqual([recent, old]);
});

// 이력서 원천

test("확인된 경력과 장면 2개(하나는 요약만)는 원천 하나로 모인다", async () => {
  const jobId = await fact("job", job);
  const a = await addScene(scene({ kind: "job", id: jobId }));
  const b = await addScene(scene({ kind: "job", id: jobId }, { title: "배포 자동화", bannedPhrases: ["전담"], metrics: [] }));
  await setSceneTrackScope(db, "u1", b, t1, "summary");
  const sources = await listRecordResumeSources(db, "u1", t1);
  expect(sources).toHaveLength(1);
  const [source] = sources;
  expect(source).toMatchObject({
    id: jobId,
    kind: "job",
    name: "가나다 주식회사",
    role: "사원",
    startMonth: "2022-03",
    endMonth: "2024-08",
    scope: "use",
    duties: ["결제 서버 운영", "장애 대응"],
    metrics: [{ text: "월 장애 5건에서 1건", basis: "장애 보고서" }],
  });
  expect(source.actions).toContain("[결제 장애 대응] 상황: 결제 장애가 잦았다 / 한 일: 승인 API를 다시 설계했다 / 결과: 장애가 줄었다");
  expect(source.actions).toContain("[배포 자동화]");
  expect(source.actions).toMatch(/\[배포 자동화\][^\n]*\(요약만\)/);
  expect(source.actions).not.toMatch(/\[결제 장애 대응\][^\n]*\(요약만\)/);
  expect([...source.bannedPhrases].sort()).toEqual(["전담", "주도", "혼자 구축"].sort());
  expect(source.codeLines).toBeUndefined();

  const before = source.contentVersion;
  await deleteScene(db, "u1", a);
  const [after] = await listRecordResumeSources(db, "u1", t1);
  expect(after.contentVersion).not.toBe(before);
});

test("확인되지 않은 장면과 제외한 장면은 이력서 원천에 들어가지 않는다", async () => {
  const jobId = await fact("job", job);
  await addScene(scene({ kind: "job", id: jobId }, { title: "미확인 일" }), { state: "unconfirmed" });
  await addScene(scene({ kind: "job", id: jobId }, { title: "부분 확인 일" }), { state: "partial" });
  const excluded = await addScene(scene({ kind: "job", id: jobId }, { title: "뺀 일" }));
  await setSceneTrackScope(db, "u1", excluded, t1, "exclude");
  const [source] = await listRecordResumeSources(db, "u1", t1);
  expect(source.actions).toBeNull();
  expect(source.metrics).toEqual([]);
});

test("장면 없는 확인된 프로젝트도 나오고, 소속은 소속 조직 이름이다", async () => {
  const jobId = await fact("job", job);
  const projectId = await fact("project", { ...project, parent: { kind: "job", id: jobId } });
  const solo = await fact("project", { ...project, name: "개인 블로그", startMonth: "2021-01", endMonth: "2021-02" });
  const sources = await listRecordResumeSources(db, "u1", t1);
  const byId = new Map(sources.map((s) => [s.id, s]));
  expect(byId.get(projectId)).toMatchObject({ kind: "project", name: "사내 정산 도구", organization: "가나다 주식회사", role: "백엔드", actions: null });
  expect(byId.get(solo)?.organization).toBeNull();
});

test("확인된 학력은 코드 줄로, 미확인 학력과 제외한 머리는 없다", async () => {
  const schoolId = await fact("education", school);
  await fact("education", { ...school, schoolName: "미확인 대학교" }, false);
  const jobId = await fact("job", job);
  await setFactTrackScope(db, "u1", "job", jobId, t1, "exclude");
  const sources = await listRecordResumeSources(db, "u1", t1);
  expect(sources.map((s) => s.id)).toEqual([schoolId]);
  expect(sources[0]).toMatchObject({ kind: "school", name: "한국대학교", codeLines: ["산업공학과 · 학사 · 졸업 · 학점 3.8/4.5"], scope: "use" });
});

test("교육 과정·자격·공백의 코드 줄과 기간", async () => {
  const course = await fact("course", { name: "웹 개발 과정", institution: "한국교육원", startMonth: "2021-03", endMonth: "2021-08", hours: 600, learned: "스프링" });
  const credential = await fact("credential", { type: "license", name: "정보처리기사", issuer: "한국산업인력공단", month: "2021-06", score: null });
  const gap = await fact("gap", { startMonth: "2024-09", endMonth: null, note: "자격 공부" });
  const empty = await fact("gap", { startMonth: null, endMonth: null, note: null });
  const byId = new Map((await listRecordResumeSources(db, "u1", t1)).map((s) => [s.id, s]));
  expect(byId.get(course)).toMatchObject({ kind: "training", name: "웹 개발 과정", codeLines: ["한국교육원 · 600시간", "스프링"] });
  expect(byId.get(credential)).toMatchObject({ kind: "certificate", name: "정보처리기사", startMonth: "2021-06", codeLines: ["자격증 · 한국산업인력공단"] });
  expect(byId.get(gap)).toMatchObject({ kind: "gap", name: "공백 기간", startMonth: "2024-09", endMonth: null, isOngoing: true, codeLines: ["자격 공부"] });
  expect(byId.get(empty)).toMatchObject({ startMonth: null, isOngoing: false, codeLines: [] });
});

test("요약만인 머리는 scope가 summary다", async () => {
  const jobId = await fact("job", job);
  await setFactTrackScope(db, "u1", "job", jobId, t1, "summary");
  const [source] = await listRecordResumeSources(db, "u1", t1);
  expect(source.scope).toBe("summary");
});

// 채점 근거

test("확인된 학력·자격과 부분 확인 장면이 들어가고 제외한 것은 없다", async () => {
  const schoolId = await fact("education", school);
  const credential = await fact("credential", { type: "language", name: "TOEIC", issuer: null, month: "2022-01", score: "900" });
  await fact("credential", { type: "language", name: "미확인 TOEIC", issuer: null, month: "2022-01", score: "800" }, false);
  const excludedSchool = await fact("education", { ...school, schoolName: "뺀 대학교" });
  await setFactTrackScope(db, "u1", "education", excludedSchool, t1, "exclude");
  const jobId = await fact("job", job, false);
  const partial = await addScene(scene({ kind: "job", id: jobId }), { state: "partial" });
  await addScene(scene({ kind: "job", id: jobId }, { title: "미확인 장면" }), { state: "unconfirmed" });
  const excludedScene = await addScene(scene({ kind: "job", id: jobId }, { title: "뺀 장면" }));
  await setSceneTrackScope(db, "u1", excludedScene, t1, "exclude");

  const candidates = await listRecordEvidence(db, "u1", t1);
  const byId = new Map(candidates.map((c) => [c.id, c]));
  expect(new Set(byId.keys())).toEqual(new Set([schoolId, credential, partial]));
  expect(byId.get(partial)).toMatchObject({ state: "partial", kind: "job", organization: "가나다 주식회사 · 개발팀" });
  expect(byId.get(schoolId)).toMatchObject({ state: "confirmed", kind: "school", actions: "산업공학과 · 학사 · 졸업 · 학점 3.8/4.5", situation: null, result: null });
  expect(byId.get(credential)).toMatchObject({ kind: "certificate", actions: "어학 · 900" });
});

test("확인된 경력 머리는 담당 업무를 줄로 담아 근거가 된다", async () => {
  const jobId = await fact("job", job);
  const [candidate] = await listRecordEvidence(db, "u1", t1);
  expect(candidate).toMatchObject({
    id: jobId,
    kind: "job",
    name: "가나다 주식회사",
    actions: "결제 서버 운영\n장애 대응",
    situation: null,
    result: null,
    state: "confirmed",
  });
});

// 본인 것만

test("다른 사용자의 트랙이면 셋 모두 빈 목록이다", async () => {
  const jobId = await fact("job", job);
  await addScene(scene({ kind: "job", id: jobId }));
  await fact("education", school);
  expect(await listSceneWritingSources(db, "u1", t2)).toEqual([]);
  expect(await listRecordResumeSources(db, "u1", t2)).toEqual([]);
  expect(await listRecordEvidence(db, "u1", t2)).toEqual([]);
});

test("다른 사용자의 기록은 읽히지 않는다", async () => {
  const jobId = await fact("job", job, true, "u2");
  await addScene(scene({ kind: "job", id: jobId }), {}, "u2");
  await fact("education", school, true, "u2");
  expect(await listSceneWritingSources(db, "u1", t1)).toEqual([]);
  expect(await listRecordResumeSources(db, "u1", t1)).toEqual([]);
  expect(await listRecordEvidence(db, "u1", t1)).toEqual([]);
  expect((await recordNames(db, "u1")).size).toBe(0);
});

test("recordNames는 장면 제목과 이력 사실 이름을 준다", async () => {
  const jobId = await fact("job", job, false);
  const sceneId = await addScene(scene({ kind: "job", id: jobId }), { state: "unconfirmed" });
  const schoolId = await fact("education", school);
  const gap = await fact("gap", { startMonth: "2024-09", endMonth: null, note: null });
  const names = await recordNames(db, "u1");
  expect(names.get(sceneId)).toBe("결제 장애 대응");
  expect(names.get(jobId)).toBe("가나다 주식회사");
  expect(names.get(schoolId)).toBe("한국대학교");
  expect(names.get(gap)).toBe("공백 기간");
});
