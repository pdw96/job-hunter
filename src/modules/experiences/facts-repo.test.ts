import { beforeEach, expect, test } from "vitest";
import { createTestDb } from "@/db/test-db";
import type { Db } from "@/db/types";
import { user } from "@/modules/auth/schema";
import { createTrack } from "@/modules/tracks/repo";
import type { SurveyInput } from "@/modules/tracks/survey";
import {
  confirmFact,
  countRecords,
  createFact,
  deleteFact,
  getFact,
  listFacts,
  setFactTrackScope,
  unconfirmFact,
  updateFact,
} from "./facts-repo";
import { FACT_KINDS, type FactKind } from "./record-options";
import type { FactInputs, ProjectInput } from "./record-input";

let db: Db;
let t1: string;
let t2: string;

const INPUTS: FactInputs = {
  education: {
    schoolName: "한국대학교",
    location: "서울",
    degree: "bachelor",
    major: "컴퓨터공학",
    startMonth: "2015-03",
    endMonth: "2019-02",
    status: "graduated",
    gpa: "3.8",
    gpaScale: "4.5",
  },
  course: { name: "백엔드 부트캠프", institution: "코딩학원", startMonth: "2020-01", endMonth: "2020-06", hours: 600, learned: "서버 개발" },
  job: {
    company: "가나다 주식회사",
    department: "개발팀",
    title: "사원",
    employment: "regular",
    startMonth: "2020-07",
    endMonth: "2022-06",
    isOngoing: false,
    duties: ["결제 API 개발", "장애 대응"],
    bannedPhrases: ["혼자 구축"],
  },
  gap: { startMonth: "2019-03", endMonth: "2019-12", note: "취업 준비" },
  credential: { type: "license", name: "정보처리기사", issuer: "한국산업인력공단", month: "2019-11", score: null },
  project: {
    name: "결제 개편",
    parent: null,
    startMonth: "2021-01",
    endMonth: "2021-06",
    isOngoing: false,
    role: "백엔드",
    tools: ["TypeScript"],
    summary: "결제 승인 개편",
    bannedPhrases: [],
  },
  activity: { name: "동아리 회장", organization: "개발 동아리", startMonth: "2016-03", endMonth: "2017-02", isOngoing: false, role: "회장" },
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

async function make<K extends FactKind>(userId: string, kind: K, input: FactInputs[K] = INPUTS[kind]) {
  const r = await createFact(db, userId, kind, input);
  if (!r.ok) throw new Error(r.reason);
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

test.each(FACT_KINDS)("%s: 만들면 입력 그대로 읽히고 미확인이며, 맞음을 누르면 확인됨이다", async (kind) => {
  const id = await make("u1", kind);
  const found = await getFact(db, "u1", kind, id);
  expect(found).toMatchObject({ kind, id, value: INPUTS[kind], isConfirmed: false, contentVersion: 0, source: "manual", trackScopes: {}, movedFrom: null });
  expect((await listFacts(db, "u1"))[kind].map((f) => f.id)).toEqual([id]);

  expect(await confirmFact(db, "u1", kind, id)).toEqual({ ok: true });
  expect((await getFact(db, "u1", kind, id))?.isConfirmed).toBe(true);
  expect(await unconfirmFact(db, "u1", kind, id)).toEqual({ ok: true });
  expect((await getFact(db, "u1", kind, id))?.isConfirmed).toBe(false);
});

test("옵션: 출처·옮겨 온 기록·확인됨·트랙 범위로 만들 수 있다", async () => {
  const r = await createFact(db, "u1", "gap", INPUTS.gap, { source: "import", movedFrom: "old1", confirmed: true, trackScopes: { [t1]: "exclude" } });
  if (!r.ok) throw new Error();
  expect(await getFact(db, "u1", "gap", r.id)).toMatchObject({
    source: "import",
    movedFrom: "old1",
    isConfirmed: true,
    trackScopes: { [t1]: "exclude" },
  });
});

test("내용 칸을 고치면 미확인으로 돌아가고 contentVersion이 오른다. 내용이 같으면 그대로다", async () => {
  const id = await make("u1", "education");
  await confirmFact(db, "u1", "education", id);

  expect(await updateFact(db, "u1", "education", id, { ...INPUTS.education })).toEqual({ ok: true });
  expect(await getFact(db, "u1", "education", id)).toMatchObject({ isConfirmed: true, contentVersion: 0 });

  await updateFact(db, "u1", "education", id, { ...INPUTS.education, major: "전자공학" });
  expect(await getFact(db, "u1", "education", id)).toMatchObject({
    isConfirmed: false,
    contentVersion: 1,
    value: { major: "전자공학" },
  });
});

test("확인에 영향 없는 칸(쓰면 안 되는 표현)만 고치면 확인이 유지된다", async () => {
  const id = await make("u1", "job");
  await confirmFact(db, "u1", "job", id);
  await updateFact(db, "u1", "job", id, { ...INPUTS.job, bannedPhrases: ["다른 표현"] });
  expect(await getFact(db, "u1", "job", id)).toMatchObject({ isConfirmed: true, contentVersion: 0, value: { bannedPhrases: ["다른 표현"] } });
});

test("프로젝트의 parent는 경력·학교·교육 과정으로 저장되고, parent만 바꾸면 확인이 유지된다", async () => {
  const jobId = await make("u1", "job");
  const eduId = await make("u1", "education");
  const courseId = await make("u1", "course");
  const pid = await make("u1", "project", { ...INPUTS.project, parent: { kind: "job", id: jobId } });
  expect((await getFact(db, "u1", "project", pid))?.value.parent).toEqual({ kind: "job", id: jobId });

  await confirmFact(db, "u1", "project", pid);
  for (const parent of [{ kind: "education", id: eduId }, { kind: "course", id: courseId }, null] as ProjectInput["parent"][]) {
    expect(await updateFact(db, "u1", "project", pid, { ...INPUTS.project, parent })).toEqual({ ok: true });
    expect(await getFact(db, "u1", "project", pid)).toMatchObject({ isConfirmed: true, contentVersion: 0, value: { parent } });
  }
});

test("남의 경력·학교·교육 과정을 parent로 주면 만들기도 고치기도 not_found이다", async () => {
  const pid = await make("u1", "project");
  const notFound = { ok: false, reason: "not_found" };
  const others = [
    { kind: "job", id: await make("u2", "job") },
    { kind: "education", id: await make("u2", "education") },
    { kind: "course", id: await make("u2", "course") },
    { kind: "job", id: "없는-id" },
  ] as const;
  for (const parent of others) {
    expect(await createFact(db, "u1", "project", { ...INPUTS.project, parent })).toEqual(notFound);
    expect(await updateFact(db, "u1", "project", pid, { ...INPUTS.project, parent })).toEqual(notFound);
  }
  expect((await listFacts(db, "u1")).project).toHaveLength(1);
  expect((await getFact(db, "u1", "project", pid))?.value.parent).toBeNull();
});

test("장면이 없는 경력은 지워진다", async () => {
  const id = await make("u1", "job");
  expect(await deleteFact(db, "u1", "job", id)).toEqual({ ok: true });
  expect(await getFact(db, "u1", "job", id)).toBeNull();
  expect(await deleteFact(db, "u1", "job", id)).toEqual({ ok: false, reason: "not_found" });
});

test("경력·학교·교육 과정을 지우면 딸린 프로젝트의 parent가 null이 된다", async () => {
  for (const kind of ["job", "education", "course"] as const) {
    const parentId = await make("u1", kind);
    const pid = await make("u1", "project", { ...INPUTS.project, parent: { kind, id: parentId } });
    expect(await deleteFact(db, "u1", kind, parentId)).toEqual({ ok: true });
    expect((await getFact(db, "u1", "project", pid))?.value.parent).toBeNull();
    expect((await listFacts(db, "u1")).project.find((p) => p.id === pid)?.value.parent).toBeNull();
  }
});

test("메뉴마다 시작 월 최근 순으로 나오고 시작 월이 없으면 아래로 간다", async () => {
  const a = await make("u1", "course", { ...INPUTS.course, startMonth: "2019-01" });
  const b = await make("u1", "course", { ...INPUTS.course, startMonth: null, endMonth: null });
  const c = await make("u1", "course", { ...INPUTS.course, startMonth: "2022-05" });
  expect((await listFacts(db, "u1")).course.map((f) => f.id)).toEqual([c, a, b]);
});

test("트랙 범위: 남의 트랙은 not_found, 내 트랙은 trackScopes에 한 키씩 들어간다", async () => {
  const id = await make("u1", "credential");
  expect(await setFactTrackScope(db, "u1", "credential", id, t2, "exclude")).toEqual({ ok: false, reason: "not_found" });
  expect((await getFact(db, "u1", "credential", id))?.trackScopes).toEqual({});

  expect(await setFactTrackScope(db, "u1", "credential", id, t1, "summary")).toEqual({ ok: true });
  expect((await getFact(db, "u1", "credential", id))?.trackScopes).toEqual({ [t1]: "summary" });
  expect(await setFactTrackScope(db, "u1", "credential", id, t1, "exclude")).toEqual({ ok: true });
  expect((await getFact(db, "u1", "credential", id))?.trackScopes).toEqual({ [t1]: "exclude" });

  expect(await setFactTrackScope(db, "u2", "credential", id, t2, "exclude")).toEqual({ ok: false, reason: "not_found" });
});

test("countRecords는 이력 사실 수를 센다", async () => {
  expect(await countRecords(db, "u1")).toBe(0);
  await make("u1", "job");
  await make("u1", "gap");
  await make("u2", "job");
  expect(await countRecords(db, "u1")).toBe(2);
  expect(await countRecords(db, "u2")).toBe(1);
});

test("다른 사용자의 것은 읽히지 않고 고치기·지우기·확인이 모두 not_found이며 원래 값이 그대로다", async () => {
  const notFound = { ok: false, reason: "not_found" };
  for (const kind of FACT_KINDS) {
    const id = await make("u1", kind);
    expect(await getFact(db, "u2", kind, id)).toBeNull();
    expect((await listFacts(db, "u2"))[kind]).toEqual([]);
    expect(await updateFact(db, "u2", kind, id, INPUTS[kind])).toEqual(notFound);
    expect(await deleteFact(db, "u2", kind, id)).toEqual(notFound);
    expect(await confirmFact(db, "u2", kind, id)).toEqual(notFound);
    expect(await unconfirmFact(db, "u2", kind, id)).toEqual(notFound);
    expect(await getFact(db, "u1", kind, id)).toMatchObject({ value: INPUTS[kind], isConfirmed: false });
  }
});
