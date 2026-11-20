import { eq } from "drizzle-orm";
import { beforeEach, expect, test } from "vitest";
import { createTestDb } from "@/db/test-db";
import type { Db } from "@/db/types";
import type { AiRequest } from "@/modules/ai/client";
import { createFakeAi } from "@/modules/ai/fake-client";
import { user } from "@/modules/auth/schema";
import { createTrack } from "@/modules/tracks/repo";
import type { SurveyInput } from "@/modules/tracks/survey";
import { insertClaims } from "./claims-repo";
import { createFact, getFact, listFacts, updateFact } from "./facts-repo";
import type { ExperienceInput } from "./input";
import { affiliateProjects, moveRecord, runNextMove } from "./move";
import { claimNextMove, failPendingMoves, moveSummary, planMoves, resetMoves, retryMove } from "./move-repo";
import type { Kind } from "./options";
import { listRecordClaims } from "./record-claims-repo";
import type { ProjectInput } from "./record-input";
import { closeRubricItem, confirmExperience, createExperience, setTrackScope } from "./repo";
import { experiences, moves, projects, scenes as sceneRows, type StoredRubric } from "./schema";
import { getScene, listScenes } from "./scenes-repo";

let db: Db;
const now = new Date("2026-11-20T03:00:00Z");

const old = (over: Partial<ExperienceInput> & { kind: Kind }): ExperienceInput => ({
  name: "결제 시스템 개편",
  organization: "가나다 주식회사",
  role: "백엔드 개발",
  startMonth: "2023-03",
  endMonth: "2023-11",
  isOngoing: false,
  situation: "결제 장애가 잦았다",
  actions: "결제 승인 API 개편을 주도했다",
  result: "장애가 줄었다",
  metrics: [{ text: "월 장애 5건에서 1건", basis: "사내 장애 보고서" }],
  notDone: "프론트엔드는 하지 않았다",
  bannedPhrases: ["혼자 구축"],
  evidenceNote: "장애 보고서",
  tags: ["결제"],
  ...over,
});

const allMet: StoredRubric = {
  period: { status: "met", note: null },
  role: { status: "met", note: null },
  level: { status: "met", note: null },
  metrics: { status: "met", note: null },
  evidence: { status: "closed", note: null },
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

// 확인된 옛 기록: 루브릭을 모두 충족으로 두고 주장 하나를 맞음으로 닫은 뒤 확인한다
async function confirmedOld(input: ExperienceInput): Promise<string> {
  const id = await createExperience(db, "u1", input, "import");
  await insertClaims(db, id, [
    { kind: "role", quote: "결제 승인 API 개편을 주도했다", phrase: "주도", origin: "code", status: "confirmed" },
    { kind: "metric", quote: "월 장애 5건에서 1건", phrase: null, origin: "code", status: "fixed" },
  ]);
  await db.update(experiences).set({ rubric: allMet }).where(eq(experiences.id, id));
  const confirmed = await confirmExperience(db, "u1", id);
  if (!confirmed.ok) throw new Error(confirmed.reason);
  return id;
}

const blankScene = {
  startMonth: "",
  endMonth: "",
  isOngoing: false,
  situation: "",
  judgment: "",
  actions: "",
  result: "",
  lessons: "",
  metrics: [],
  notDone: "",
  evidenceNote: "",
  tags: [],
  roleClaims: [],
  bannedPhrases: [],
};

const emptyImport = { education: [], courses: [], credentials: [], gaps: [], jobs: [], projects: [], activities: [], more: false };

const jobImport = {
  ...emptyImport,
  jobs: [
    {
      company: "가나다상사",
      department: "영업팀",
      title: "",
      employment: "regular",
      startMonth: "2020-03",
      endMonth: "2022-02",
      isOngoing: false,
      duties: ["거래처 관리"],
      bannedPhrases: [],
      roleClaims: [],
      scenes: [
        { ...blankScene, title: "거래처 재계약", actions: "거래처 재계약 자료를 만들었다" },
        { ...blankScene, title: "주문 정리", actions: "주문 내역을 정리했다" },
      ],
    },
  ],
};

beforeEach(async () => {
  delete process.env.AI_MONTHLY_LIMIT_USD;
  db = await createTestDb();
  await db.insert(user).values([
    { id: "u1", name: "A", email: "u1@example.com" },
    { id: "u2", name: "B", email: "u2@example.com" },
  ]);
});

test("확인된 프로젝트는 머리·장면이 확인됨으로 옮겨지고 루브릭과 주장 상태가 같다. AI를 부르지 않는다", async () => {
  const oldId = await confirmedOld(old({ kind: "project" }));
  const trackResult = await createTrack(db, "u1", survey);
  if (!trackResult.ok) throw new Error(trackResult.reason);
  await setTrackScope(db, "u1", oldId, trackResult.id, "exclude");
  const ai = createFakeAi([]);

  expect(await moveRecord(db, ai, "u1", oldId, now)).toEqual({ ok: true });
  expect(ai.requests).toHaveLength(0);

  const facts = await listFacts(db, "u1");
  expect(facts.project).toHaveLength(1);
  const project = facts.project[0];
  expect(project.isConfirmed).toBe(true);
  expect(project.source).toBe("migrate");
  expect(project.movedFrom).toBe(oldId);
  expect(project.trackScopes).toEqual({ [trackResult.id]: "exclude" });
  // 머리도 옛 기록이 확인된 시각으로 확인된다
  const [oldRow] = await db.select({ confirmedAt: experiences.confirmedAt }).from(experiences).where(eq(experiences.id, oldId));
  const [headRow] = await db.select({ confirmedAt: projects.confirmedAt }).from(projects).where(eq(projects.id, project.id));
  expect(headRow.confirmedAt).toEqual(oldRow.confirmedAt);
  expect(project.value).toMatchObject({
    name: "결제 시스템 개편",
    role: "백엔드 개발",
    startMonth: "2023-03",
    endMonth: "2023-11",
    parent: null,
    summary: null,
  });

  const [summary] = await listScenes(db, "u1");
  const scene = await getScene(db, "u1", summary.id);
  expect(scene).toMatchObject({
    head: { kind: "project", id: project.id },
    title: "결제 시스템 개편",
    startMonth: null,
    endMonth: null,
    situation: "결제 장애가 잦았다",
    actions: "결제 승인 API 개편을 주도했다",
    result: "장애가 줄었다",
    judgment: null,
    lessons: null,
    metrics: [{ text: "월 장애 5건에서 1건", basis: "사내 장애 보고서" }],
    notDone: "프론트엔드는 하지 않았다",
    bannedPhrases: ["혼자 구축"],
    evidenceNote: "장애 보고서",
    tags: ["결제"],
    isConfirmed: true,
    state: "confirmed",
    source: "migrate",
    movedFrom: oldId,
    trackScopes: { [trackResult.id]: "exclude" },
  });
  expect(scene?.rubric).toEqual(allMet);

  const claims = await listRecordClaims(db, "u1", { kind: "scene", id: summary.id });
  expect(claims.map((claim) => [claim.quote, claim.status])).toEqual([
    ["결제 승인 API 개편을 주도했다", "confirmed"],
    ["월 장애 5건에서 1건", "fixed"],
  ]);
});

test("미확인 프로젝트는 미확인 장면과 새 대기 주장으로 옮긴다. 금지 표현·하지 않은 것은 그대로, 닫은 항목은 유지한다", async () => {
  const oldId = await createExperience(db, "u1", old({ kind: "project" }));
  await closeRubricItem(db, "u1", oldId, "evidence");
  const ai = createFakeAi([{ quotes: ["장애가 줄었다", "원본에 없는 구절"] }]);

  expect(await moveRecord(db, ai, "u1", oldId, now)).toEqual({ ok: true });
  expect(ai.requests).toHaveLength(1);
  expect(ai.requests[0].purpose).toBe("migrate");
  expect(ai.requests[0].messages[0].text.split("\n")[0]).toBe("[옮기기: 주장]");
  expect(ai.requests[0].messages[0].text).toContain("결제 승인 API 개편을 주도했다");
  // 금지 표현은 AI에 보내지 않는다
  expect(ai.requests[0].messages[0].text).not.toContain("혼자 구축");

  const facts = await listFacts(db, "u1");
  expect(facts.project[0].isConfirmed).toBe(false);
  const [summary] = await listScenes(db, "u1");
  const scene = await getScene(db, "u1", summary.id);
  expect(scene).toMatchObject({ isConfirmed: false, state: "unconfirmed", notDone: "프론트엔드는 하지 않았다", bannedPhrases: ["혼자 구축"] });
  expect(scene?.rubric.evidence.status).toBe("closed");
  expect(scene?.rubric.period.status).toBe("met");
  expect(scene?.rubric.role.status).toBe("unjudged");

  const claims = await listRecordClaims(db, "u1", { kind: "scene", id: summary.id });
  expect(claims.length).toBeGreaterThan(0);
  expect(claims.every((claim) => claim.status === "pending")).toBe(true);
  const quotes = claims.map((claim) => claim.quote);
  expect(quotes).toContain("결제 승인 API 개편을 주도했다");
  expect(quotes).toContain("장애가 줄었다"); // AI가 짚은 구절
  expect(quotes).not.toContain("원본에 없는 구절");
});

test("기타 기록은 활동 머리와 장면으로 옮긴다", async () => {
  const oldId = await createExperience(db, "u1", old({ kind: "other", name: "지역 봉사", organization: "행복센터", role: "팀원" }));
  const ai = createFakeAi([{ quotes: [] }]);
  expect(await moveRecord(db, ai, "u1", oldId, now)).toEqual({ ok: true });
  const facts = await listFacts(db, "u1");
  expect(facts.project).toHaveLength(0);
  expect(facts.activity).toHaveLength(1);
  expect(facts.activity[0].value).toMatchObject({ name: "지역 봉사", organization: "행복센터", role: "팀원", startMonth: "2023-03" });
  expect(facts.activity[0].movedFrom).toBe(oldId);
  const [scene] = await listScenes(db, "u1");
  expect(scene).toMatchObject({ head: { kind: "activity", id: facts.activity[0].id }, title: "지역 봉사" });
});

test("미확인 기록의 주장 AI 호출이 실패하면 옮기지 못하고 아무것도 남지 않는다", async () => {
  const oldId = await createExperience(db, "u1", old({ kind: "project" }));
  const ai = createFakeAi([{ fail: "unavailable" }]);
  const result = await moveRecord(db, ai, "u1", oldId, now);
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.error).toContain("AI");
  const facts = await listFacts(db, "u1");
  expect(Object.values(facts).flat()).toHaveLength(0);
  expect(await listScenes(db, "u1")).toHaveLength(0);
});

test("재직 하나는 AI가 나눈 대로 경력 1·장면 2로 옮긴다. 모두 미확인이고 장면은 옛 금지 표현을 갖는다", async () => {
  const oldId = await createExperience(
    db,
    "u1",
    old({ kind: "job", name: "가나다상사 영업", organization: "가나다상사", startMonth: "2020-03", endMonth: "2022-02", metrics: [] }),
  );
  const ai = createFakeAi([jobImport]);

  expect(await moveRecord(db, ai, "u1", oldId, now)).toEqual({ ok: true });
  expect(ai.requests[0].purpose).toBe("migrate");
  const text = ai.requests[0].messages[0].text;
  expect(text.split("\n")[0]).toBe("[옮기기: 나누기]");
  expect(text).toContain("'재직'");
  expect(text).toContain("가나다상사 영업");

  const facts = await listFacts(db, "u1");
  expect(facts.job).toHaveLength(1);
  expect(facts.job[0]).toMatchObject({ isConfirmed: false, source: "migrate", movedFrom: oldId });
  const scenes = await listScenes(db, "u1");
  expect(scenes).toHaveLength(2);
  for (const summary of scenes) {
    const scene = await getScene(db, "u1", summary.id);
    expect(scene).toMatchObject({ isConfirmed: false, movedFrom: oldId, source: "migrate", notDone: "프론트엔드는 하지 않았다" });
    expect(scene?.bannedPhrases).toContain("혼자 구축");
  }
});

test("학력인데 AI가 학력을 하나도 내지 않으면 옮기지 못하고 새 행이 없다", async () => {
  const oldId = await createExperience(db, "u1", old({ kind: "school", name: "한국대학교 컴퓨터공학과", startMonth: "2015-03", endMonth: "2019-02" }));
  const ai = createFakeAi([{ ...emptyImport, credentials: [{ type: "license", name: "정보처리기사", issuer: "", month: "", score: "" }] }]);
  expect(await moveRecord(db, ai, "u1", oldId, now)).toEqual({ ok: false, error: "나눌 내용을 찾지 못했습니다" });
  expect(Object.values(await listFacts(db, "u1")).flat()).toHaveLength(0);
});

test("학력은 학력으로 옮기고 옛 범위를 복사한다", async () => {
  const oldId = await createExperience(db, "u1", old({ kind: "school", name: "한국대학교 컴퓨터공학과", startMonth: "2015-03", endMonth: "2019-02" }));
  const trackResult = await createTrack(db, "u1", survey);
  if (!trackResult.ok) throw new Error(trackResult.reason);
  await setTrackScope(db, "u1", oldId, trackResult.id, "summary");
  const answer = {
    ...emptyImport,
    education: [
      { schoolName: "한국대학교", location: "", degree: "bachelor", major: "컴퓨터공학과", startMonth: "2015-03", endMonth: "2019-02", status: "graduated", gpa: "", gpaScale: "" },
    ],
  };
  expect(await moveRecord(db, createFakeAi([answer]), "u1", oldId, now)).toEqual({ ok: true });
  const facts = await listFacts(db, "u1");
  expect(facts.education).toHaveLength(1);
  expect(facts.education[0]).toMatchObject({ isConfirmed: false, movedFrom: oldId, trackScopes: { [trackResult.id]: "summary" } });
});

test("같은 옛 기록을 두 번 옮기면 둘째는 저장하지 않고 ok다", async () => {
  const oldId = await createExperience(db, "u1", old({ kind: "job", name: "가나다상사 영업", startMonth: "2020-03", endMonth: "2022-02" }));
  const ai = createFakeAi([jobImport]);
  expect(await moveRecord(db, ai, "u1", oldId, now)).toEqual({ ok: true });
  // 둘째는 AI도 부르지 않는다(준비된 답이 없으면 가짜 AI가 오류를 낸다)
  expect(await moveRecord(db, ai, "u1", oldId, now)).toEqual({ ok: true });
  expect(ai.requests).toHaveLength(1);
  expect((await listFacts(db, "u1")).job).toHaveLength(1);
  expect(await listScenes(db, "u1")).toHaveLength(2);

  const confirmedId = await confirmedOld(old({ kind: "project" }));
  await moveRecord(db, ai, "u1", confirmedId, now);
  await moveRecord(db, ai, "u1", confirmedId, now);
  expect((await listFacts(db, "u1")).project).toHaveLength(1);
});

test("다른 사용자의 옛 기록은 옮기지 못한다", async () => {
  const oldId = await createExperience(db, "u1", old({ kind: "project" }));
  const result = await moveRecord(db, createFakeAi([]), "u2", oldId, now);
  expect(result.ok).toBe(false);
  expect(Object.values(await listFacts(db, "u2")).flat()).toHaveLength(0);
  expect(Object.values(await listFacts(db, "u1")).flat()).toHaveLength(0);
});

// ---- 프로젝트 소속 잇기 ----

const projectInput = (name: string, startMonth: string | null, endMonth: string | null): ProjectInput => ({
  name,
  parent: null,
  startMonth,
  endMonth,
  isOngoing: false,
  role: null,
  tools: [],
  summary: null,
  bannedPhrases: [],
});

async function made(result: { ok: true; id: string } | { ok: false; reason: string }): Promise<string> {
  if (!result.ok) throw new Error(result.reason);
  return result.id;
}

// 보낸 글에서 이름으로 별명(P1, J1 …)을 찾는다
const aliasOf = (text: string, name: string) => {
  const found = text.match(new RegExp(`^([PJSC]\\d+) \\| 이름: ${name}`, "m"));
  if (!found) throw new Error(`별명을 찾지 못했습니다: ${name}`);
  return found[1];
};

test("affiliateProjects는 기간 안의 짝만 쓰고, 학교에 딸린 짝도 쓰며, 확인된 프로젝트의 확인을 유지한다", async () => {
  const migrate = { source: "migrate" as const, movedFrom: "old" };
  const jobId = await made(
    await createFact(
      db,
      "u1",
      "job",
      { company: "가나다상사", department: null, title: null, employment: "regular", startMonth: "2022-03", endMonth: "2024-02", isOngoing: false, duties: [], bannedPhrases: [] },
      migrate,
    ),
  );
  const schoolId = await made(
    await createFact(
      db,
      "u1",
      "education",
      { schoolName: "한국대학교", location: null, degree: "bachelor", major: null, startMonth: "2016-03", endMonth: "2022-02", status: "graduated", gpa: null, gpaScale: null },
      migrate,
    ),
  );
  const inside = await made(await createFact(db, "u1", "project", projectInput("리뉴얼 TF", "2023-06", "2023-09"), migrate));
  const outside = await made(await createFact(db, "u1", "project", projectInput("옛 사이드", "2019-03", "2019-06"), migrate));
  const atSchool = await made(await createFact(db, "u1", "project", projectInput("졸업 작품", "2021-03", "2021-12"), migrate));
  const confirmed = await made(await createFact(db, "u1", "project", projectInput("확인된 TF", "2022-05", "2022-08"), { ...migrate, confirmed: true }));
  const noPeriod = await made(await createFact(db, "u1", "project", projectInput("기간 없는 일", null, null), migrate));
  // 직접 만든 프로젝트는 보내지 않는다
  await createFact(db, "u1", "project", projectInput("직접 만든 것", "2023-01", "2023-02"));

  const ai = createFakeAi([
    (request: AiRequest<unknown>) => {
      const text = request.messages[0].text;
      const job = aliasOf(text, "가나다상사");
      return {
        links: [
          { project: aliasOf(text, "리뉴얼 TF"), parent: job },
          { project: aliasOf(text, "옛 사이드"), parent: job },
          { project: aliasOf(text, "졸업 작품"), parent: aliasOf(text, "한국대학교") },
          { project: aliasOf(text, "확인된 TF"), parent: job },
          { project: aliasOf(text, "기간 없는 일"), parent: job },
          { project: "P99", parent: job },
        ],
      };
    },
  ]);

  expect(await affiliateProjects(db, ai, "u1", now)).toEqual({ ok: true });
  const text = ai.requests[0].messages[0].text;
  expect(ai.requests[0].purpose).toBe("migrate");
  expect(text.split("\n")[0]).toBe("[옮기기: 소속]");
  expect(text).not.toContain("직접 만든 것");

  const parentOf = async (id: string) => (await getFact(db, "u1", "project", id))?.value.parent;
  expect(await parentOf(inside)).toEqual({ kind: "job", id: jobId });
  expect(await parentOf(outside)).toBeNull();
  expect(await parentOf(atSchool)).toEqual({ kind: "education", id: schoolId });
  expect(await parentOf(confirmed)).toEqual({ kind: "job", id: jobId });
  expect((await getFact(db, "u1", "project", confirmed))?.isConfirmed).toBe(true);
  expect(await parentOf(noPeriod)).toBeNull();
});

test("옮긴 프로젝트나 조직이 없으면 affiliateProjects는 AI를 부르지 않는다", async () => {
  await createFact(db, "u1", "project", projectInput("리뉴얼 TF", "2023-06", "2023-09"), { source: "migrate", movedFrom: "old" });
  const ai = createFakeAi([]);
  expect(await affiliateProjects(db, ai, "u1", now)).toEqual({ ok: true });
  expect(ai.requests).toHaveLength(0);
});

test("affiliateProjects의 AI 호출이 실패하면 ok가 아니다", async () => {
  await createFact(db, "u1", "project", projectInput("리뉴얼 TF", "2023-06", "2023-09"), { source: "migrate", movedFrom: "old" });
  await createFact(
    db,
    "u1",
    "job",
    { company: "가나다상사", department: null, title: null, employment: "regular", startMonth: "2022-03", endMonth: "2024-02", isOngoing: false, duties: [], bannedPhrases: [] },
    { source: "migrate", movedFrom: "old2" },
  );
  const result = await affiliateProjects(db, createFakeAi([{ fail: "invalid" }]), "u1", now);
  expect(result.ok).toBe(false);
});

// ---- 하나씩 돌리기 ----

test("runNextMove는 하나씩 옮기고 진행을 돌려준다. 실패한 것은 옛 이름으로 남는다", async () => {
  await confirmedOld(old({ kind: "project" }));
  await createExperience(db, "u1", old({ kind: "school", name: "한국대학교 컴퓨터공학과", startMonth: "2015-03", endMonth: "2019-02" }));
  await planMoves(db, "u1");
  // 정리는 빈 답(모두 기본값), 확인된 프로젝트는 AI를 부르지 않고, 학력은 AI가 실패한다. 소속 잇기는 조직이 없어 AI를 부르지 않는다
  const ai = createFakeAi([{ records: [] }, { fail: "unavailable" }]);

  let progress = await runNextMove(db, ai, "u1", now);
  expect(progress.total).toBe(4);
  for (let i = 0; i < 3; i += 1) progress = await runNextMove(db, ai, "u1", now);
  expect(progress).toMatchObject({ total: 4, done: 3, pending: 0 });
  expect(progress.failed).toHaveLength(1);
  expect(progress.failed[0].name).toBe("한국대학교 컴퓨터공학과");
  expect(progress.failed[0].error).toContain("AI");

  // 잡을 것이 없으면 진행만 돌려준다
  expect(await runNextMove(db, ai, "u1", now)).toEqual(progress);
  expect(ai.requests).toHaveLength(2);
  expect(ai.requests.every((request) => !request.messages[0].text.includes("u1"))).toBe(true);
});

// ---- 공백·나누기 메모·늦은 옮기기 (작업 검토) ----

test("진행 중인 옛 공백은 AI 없이 끝 월 없는 공백으로 옮긴다", async () => {
  const oldId = await createExperience(
    db,
    "u1",
    old({ kind: "gap", name: "이직 준비", startMonth: "2024-03", endMonth: null, isOngoing: true, situation: "쉬었다", actions: "  자격증  공부와\n 포트폴리오 정리 ", metrics: [] }),
  );
  const ai = createFakeAi([]);
  expect(await moveRecord(db, ai, "u1", oldId, now)).toEqual({ ok: true });
  expect(ai.requests).toHaveLength(0);
  const facts = await listFacts(db, "u1");
  expect(facts.gap).toHaveLength(1);
  expect(facts.gap[0]).toMatchObject({
    value: { startMonth: "2024-03", endMonth: null, note: "자격증 공부와 포트폴리오 정리" },
    isConfirmed: false,
    source: "migrate",
    movedFrom: oldId,
  });
});

test("월이 없는 옛 공백도 옮기고, 긴 메모는 100자 안으로 자른다", async () => {
  const oldId = await createExperience(
    db,
    "u1",
    old({ kind: "gap", name: "공백", startMonth: null, endMonth: null, situation: "가".repeat(150), actions: "   ", result: null, metrics: [] }),
  );
  expect(await moveRecord(db, createFakeAi([]), "u1", oldId, now)).toEqual({ ok: true });
  const [gap] = (await listFacts(db, "u1")).gap;
  expect(gap.value.startMonth).toBeNull();
  expect(gap.value.endMonth).toBeNull();
  expect(gap.value.note).toHaveLength(100);
  expect(gap.value.note?.endsWith("…")).toBe(true);
});

test("같은 옛 기록을 동시에 옮겨도 한 번만 저장한다", async () => {
  const oldId = await createExperience(db, "u1", old({ kind: "gap", name: "공백", startMonth: "2024-03", endMonth: "2024-08", metrics: [] }));
  const results = await Promise.all([moveRecord(db, createFakeAi([]), "u1", oldId, now), moveRecord(db, createFakeAi([]), "u1", oldId, now)]);
  expect(results).toEqual([{ ok: true }, { ok: true }]);
  expect((await listFacts(db, "u1")).gap).toHaveLength(1);
});

test("나누기에서 검사를 통과하지 못한 사례가 있으면 통과한 것은 옮기고 메모를 돌려준다", async () => {
  const oldId = await createExperience(db, "u1", old({ kind: "job", name: "가나다상사 영업", startMonth: "2020-03", endMonth: "2022-02", metrics: [] }));
  // 제목이 빈 사례는 검사에서 빠진다
  const answer = { ...jobImport, jobs: [{ ...jobImport.jobs[0], scenes: [...jobImport.jobs[0].scenes, { ...blankScene, title: "" }] }] };
  const result = await moveRecord(db, createFakeAi([answer]), "u1", oldId, now);
  expect(result).toEqual({ ok: true, note: "1개는 검사를 통과하지 못해 옮기지 못했습니다" });
  expect((await listFacts(db, "u1")).job).toHaveLength(1);
  expect(await listScenes(db, "u1")).toHaveLength(2);
});

test("원본에 없던 숫자로 칸을 비웠으면 메모를 돌려준다", async () => {
  const oldId = await createExperience(db, "u1", old({ kind: "job", name: "가나다상사 영업", startMonth: "2020-03", endMonth: "2022-02", metrics: [] }));
  const answer = { ...jobImport, jobs: [{ ...jobImport.jobs[0], department: "영업 7팀" }] };
  const result = await moveRecord(db, createFakeAi([answer]), "u1", oldId, now);
  expect(result).toEqual({ ok: true, note: "원본에 없던 숫자가 있어 일부 칸을 비웠습니다" });
});

test("runNextMove는 나누기 메모를 done 행의 error 칸에 남긴다", async () => {
  await createExperience(db, "u1", old({ kind: "job", name: "가나다상사 영업", startMonth: "2020-03", endMonth: "2022-02", metrics: [] }));
  await planMoves(db, "u1");
  const answer = { ...jobImport, jobs: [{ ...jobImport.jobs[0], scenes: [...jobImport.jobs[0].scenes, { ...blankScene, title: "" }] }] };
  const progress = await runNextMove(db, createFakeAi([answer]), "u1", now);
  expect(progress).toMatchObject({ total: 1, done: 1, pending: 0, failed: [] });
  const [row] = await db.select().from(moves).where(eq(moves.userId, "u1"));
  expect(row).toMatchObject({ status: "done", error: "1개는 검사를 통과하지 못해 옮기지 못했습니다" });
});

test("소속 잇기가 끝난 뒤 프로젝트를 늦게 옮기면 소속 잇기를 다시 돈다", async () => {
  const projectId = await createExperience(db, "u1", old({ kind: "project" }));
  await createExperience(db, "u1", old({ kind: "job", name: "가나다상사 영업", startMonth: "2020-03", endMonth: "2022-02", metrics: [] }));
  await planMoves(db, "u1");
  let claimsAsked = 0;
  const answer = (request: AiRequest<unknown>) => {
    const first = request.messages[0].text.split("\n")[0];
    if (first === "[옮기기: 주장]") return (claimsAsked += 1) === 1 ? { fail: "unavailable" as const } : { quotes: [] };
    if (first === "[옮기기: 소속]") return { links: [] };
    if (first === "[옮기기: 정리]") return { records: [] };
    return jobImport;
  };
  const ai = createFakeAi(Array.from({ length: 7 }, () => answer));
  for (let i = 0; i < 4; i += 1) await runNextMove(db, ai, "u1", now);
  const rows = async () => db.select().from(moves).where(eq(moves.userId, "u1"));
  const affiliateStatus = async () => (await rows()).find((row) => row.step === "affiliate")?.status;
  expect(await affiliateStatus()).toBe("done");
  const failed = (await rows()).find((row) => row.oldId === projectId);
  expect(failed?.status).toBe("failed");

  await retryMove(db, "u1", failed!.id, now);
  await runNextMove(db, ai, "u1", now);
  expect((await rows()).find((row) => row.oldId === projectId)?.status).toBe("done");
  expect(await affiliateStatus()).toBe("pending");
  expect((await claimNextMove(db, "u1", now))?.step).toBe("affiliate");
});

// ---- Codex 검토 (PR 40) ----

test("소속을 묻는 사이 다른 탭에서 프로젝트를 고쳐도 그 고친 것이 남고 소속만 쓰인다", async () => {
  const migrate = { source: "migrate" as const, movedFrom: "old" };
  const jobId = await made(
    await createFact(
      db,
      "u1",
      "job",
      { company: "가나다상사", department: null, title: null, employment: "regular", startMonth: "2022-03", endMonth: "2024-02", isOngoing: false, duties: [], bannedPhrases: [] },
      migrate,
    ),
  );
  const edited = await made(await createFact(db, "u1", "project", projectInput("리뉴얼 TF", "2023-06", "2023-09"), migrate));
  const manual = await made(await createFact(db, "u1", "project", projectInput("직접 고른 TF", "2023-01", "2023-03"), migrate));
  const schoolId = await made(
    await createFact(
      db,
      "u1",
      "education",
      { schoolName: "한국대학교", location: null, degree: "bachelor", major: null, startMonth: "2016-03", endMonth: "2024-02", status: "graduated", gpa: null, gpaScale: null },
      migrate,
    ),
  );

  const ai = createFakeAi([
    async (request: AiRequest<unknown>) => {
      // AI가 답하는 사이: 한 프로젝트는 역할·금지 표현을 고치고, 다른 프로젝트는 사용자가 소속을 직접 고른다
      await updateFact(db, "u1", "project", edited, { ...projectInput("리뉴얼 TF", "2023-06", "2023-09"), role: "자료 정리", bannedPhrases: ["총괄"] });
      await updateFact(db, "u1", "project", manual, { ...projectInput("직접 고른 TF", "2023-01", "2023-03"), parent: { kind: "education", id: schoolId } });
      const text = request.messages[0].text;
      return {
        links: [
          { project: aliasOf(text, "리뉴얼 TF"), parent: aliasOf(text, "가나다상사") },
          { project: aliasOf(text, "직접 고른 TF"), parent: aliasOf(text, "가나다상사") },
        ],
      };
    },
  ]);
  expect(await affiliateProjects(db, ai, "u1", now)).toEqual({ ok: true });

  const editedAfter = await getFact(db, "u1", "project", edited);
  expect(editedAfter?.value).toMatchObject({ role: "자료 정리", bannedPhrases: ["총괄"], parent: { kind: "job", id: jobId } });
  expect((await getFact(db, "u1", "project", manual))?.value.parent).toEqual({ kind: "education", id: schoolId });
});

test("나누기에서 사례가 너무 많아 다 담지 못했으면 담은 것만 옮기고 메모를 남긴다", async () => {
  const oldId = await createExperience(db, "u1", old({ kind: "job", name: "가나다상사 영업", startMonth: "2020-03", endMonth: "2022-02", metrics: [] }));
  await planMoves(db, "u1");
  const many = Array.from({ length: 10 }, (_, i) => ({ ...blankScene, title: `사례 ${["가", "나", "다", "라", "마", "바", "사", "아", "자", "차"][i]}`, actions: "거래처 자료를 만들었다" }));
  const answer = { ...jobImport, jobs: [{ ...jobImport.jobs[0], scenes: many }] };
  const progress = await runNextMove(db, createFakeAi([answer]), "u1", now);
  expect(progress).toMatchObject({ done: 1, failed: [] });
  expect(await listScenes(db, "u1")).toHaveLength(8);
  const [row] = await db.select().from(moves).where(eq(moves.userId, "u1"));
  expect(row).toMatchObject({ status: "done", error: "내용이 많아 일부를 옮기지 못했습니다. 경험 사례에서 더 추가해 주세요" });
  expect((await listFacts(db, "u1")).job[0].movedFrom).toBe(oldId);
});

// ---- 옮기기 전에 기록 전체를 보고 정리한다 (Task 13) ----

// 보낸 정리 글에서 이름으로 별명을 모두 찾는다(같은 이름이 둘이면 둘 다)
const aliasesOf = (text: string, name: string) =>
  [...text.matchAll(/^(R\d+) \| 이름: (.+?) \| /gm)].filter((match) => match[2] === name).map((match) => match[1]);

// 나누기 흉내: 구분마다 그 메뉴 하나로. 재직은 사례 둘을 함께 내어, 머리만 만들 때 버려지는지 본다
function splitAnswer(text: string) {
  const name = text.match(/\[이름\]\n(.+)/)?.[1] ?? "";
  const kind = text.match(/이 글은 예전 기록의 '(.+?)' 한 건입니다/)?.[1];
  if (kind === "학력") {
    return { ...emptyImport, education: [{ schoolName: name, location: "", degree: "bachelor", major: "", startMonth: "", endMonth: "", status: "graduated", gpa: "", gpaScale: "" }] };
  }
  if (kind === "교육") return { ...emptyImport, courses: [{ name, institution: "", startMonth: "", endMonth: "", hours: "", learned: "" }] };
  if (kind === "자격") return { ...emptyImport, credentials: [{ type: "license", name, issuer: "", month: "", score: "" }] };
  return { ...jobImport, jobs: [{ ...jobImport.jobs[0], company: "한빛전자", department: "", startMonth: "", endMonth: "" }] };
}

type Answerer = (request: AiRequest<unknown>) => unknown;
// 첫 줄로 옮기기 요청을 가려 답한다. 정리는 classify가 답한다
const movingAi = (classify: Answerer, count = 60) =>
  createFakeAi(
    Array.from({ length: count }, () => (request: AiRequest<unknown>) => {
      const text = request.messages[0].text;
      const first = text.split("\n")[0];
      if (first === "[옮기기: 정리]") return classify(request);
      if (first === "[옮기기: 주장]") return { quotes: [] };
      if (first === "[옮기기: 소속]") return { links: [] };
      return splitAnswer(text);
    }),
  );

async function runAll(ai: ReturnType<typeof createFakeAi>) {
  await planMoves(db, "u1");
  for (let i = 0; i < 60; i += 1) {
    const progress = await runNextMove(db, ai, "u1", now);
    if (progress.pending === 0) return progress;
  }
  throw new Error("끝나지 않았다");
}

const minute = (n: number) => new Date(now.getTime() + n * 60_000);

// 옛 기록 37개(노션 가져오기)와 같은 모양의 작은 예시. 같은 기록 짝, 회사의 성과 사례(STAR), 한 프로젝트의 단계 기록, 구분마다 확인된 것 하나
async function seedNotionShape() {
  const at = new Map<string, number>(); // 만든 순서를 createdAt으로 분명하게 둔다
  let order = 0;
  const make = async (input: ExperienceInput, confirm = false) => {
    const id = confirm ? await confirmedOld(input) : await createExperience(db, "u1", input, "import");
    order += 1;
    at.set(id, order);
    await db.update(experiences).set({ createdAt: minute(order) }).where(eq(experiences.id, id));
    return id;
  };
  const none = { metrics: [], notDone: null, bannedPhrases: [], evidenceNote: null, tags: [] };
  const fact = (kind: Kind, name: string, over: Partial<ExperienceInput> = {}) =>
    old({ kind, name, organization: null, role: null, situation: null, actions: null, result: null, ...none, ...over });
  const ids = {
    school: [await make(fact("school", "한빛대학교 경영학과", { situation: "경영학을 전공했다. 학생회 활동도 했다" })), await make(fact("school", "한빛대학교 경영학과"), true)],
    training: [await make(fact("training", "데이터 분석 부트캠프")), await make(fact("training", "데이터 분석 부트캠프", { actions: "파이썬으로 분석 과제를 했다" }))],
    certA: [await make(fact("certificate", "정보처리기사", { startMonth: "2021-06", endMonth: null })), await make(fact("certificate", "정보처리기사", { startMonth: "2021-06", endMonth: null }))],
    certB: [await make(fact("certificate", "컴퓨터활용능력 1급", { startMonth: "2020-03", endMonth: null })), await make(fact("certificate", "컴퓨터활용능력 1급", { startMonth: "2020-03", endMonth: null }))],
    certC: await make(fact("certificate", "SQLD", { startMonth: "2022-09", endMonth: null }), true),
    gapA: [await make(fact("gap", "이직 준비", { startMonth: "2019-03", endMonth: "2019-12" })), await make(fact("gap", "이직 준비 기간", { startMonth: "2019-03", endMonth: "2019-12" }))],
    gapB: [await make(fact("gap", "구직", { startMonth: "2024-03", endMonth: null, isOngoing: true })), await make(fact("gap", "구직 중", { startMonth: "2024-03", endMonth: null, isOngoing: true }))],
    jobs: [
      await make(old({ kind: "job", name: "한빛전자 영업 총괄", organization: "한빛전자", startMonth: "2020-03", endMonth: "2024-02", metrics: [] })),
      await make(old({ kind: "job", name: "한빛전자 영업 전담", organization: "한빛전자", startMonth: "2020-03", endMonth: "2024-02", actions: "거래처 관리와 신규 거래처 발굴, 월별 매출 보고서 작성을 맡았다", metrics: [] })),
    ],
    other: await make(old({ kind: "other", name: "지역 아동센터 봉사", organization: "아동센터", metrics: [] })),
    dashboard: [
      await make(old({ kind: "project", name: "고객 문의 대시보드", metrics: [], actions: "문의 현황을 대시보드로 만들었다. 매주 팀에 공유했다" })),
      await make(old({ kind: "project", name: "고객 문의 대시보드 구축", metrics: [], actions: "대시보드를 만들었다" })),
    ],
    star: [
      await make(old({ kind: "project", name: "성과 사례 · 재고 정리 (STAR)", organization: "한빛전자", startMonth: "2021-03", endMonth: "2021-08" }), true),
      await make(old({ kind: "project", name: "성과 사례 · 거래처 재계약 (STAR)", organization: "한빛전자", startMonth: "2022-03", endMonth: "2022-06", metrics: [] })),
    ],
    erp: [
      await make(old({ kind: "project", name: "AI 기반 ERP 구축", startMonth: "2023-01", endMonth: "2023-12", metrics: [] })),
      await make(old({ kind: "project", name: "AI 기반 ERP 구축 · 1단계 설계", startMonth: "2023-01", endMonth: "2023-04", metrics: [] })),
      await make(old({ kind: "project", name: "AI 기반 ERP 구축 · 2단계 개발", startMonth: "2023-05", endMonth: "2023-12", metrics: [] })),
    ],
  };
  return ids;
}

// 사람이 보듯 답하는 정리: 같은 이름(또는 같은 것)은 duplicate, 성과 사례는 재직의 scene, ERP 단계는 ERP 머리의 scene.
// 짝은 일부러 남겨야 할 것의 반대쪽을 가리키게 둔다(남길 것은 코드가 정한다)
function notionClassify(request: AiRequest<unknown>) {
  const text = request.messages[0].text;
  const one = (name: string) => aliasesOf(text, name)[0];
  const pair = (name: string) => aliasesOf(text, name);
  const records: { record: string; role: string; ref: string | null }[] = [];
  const add = (record: string, role: string, ref: string | null = null) => records.push({ record, role, ref });
  for (const name of ["한빛대학교 경영학과", "데이터 분석 부트캠프", "정보처리기사", "컴퓨터활용능력 1급"]) {
    const [a, b] = pair(name);
    add(b, "fact");
    add(a, "duplicate", b);
  }
  add(one("SQLD"), "fact");
  add(one("이직 준비"), "fact");
  add(one("이직 준비 기간"), "duplicate", one("이직 준비"));
  add(one("구직"), "fact");
  add(one("구직 중"), "duplicate", one("구직"));
  add(one("한빛전자 영업 총괄"), "head");
  add(one("한빛전자 영업 전담"), "duplicate", one("한빛전자 영업 총괄"));
  add(one("지역 아동센터 봉사"), "head");
  add(one("고객 문의 대시보드 구축"), "head");
  add(one("고객 문의 대시보드"), "duplicate", one("고객 문의 대시보드 구축"));
  add(one("성과 사례 · 재고 정리 (STAR)"), "scene", one("한빛전자 영업 총괄"));
  add(one("성과 사례 · 거래처 재계약 (STAR)"), "scene", one("한빛전자 영업 총괄"));
  add(one("AI 기반 ERP 구축"), "head");
  add(one("AI 기반 ERP 구축 · 1단계 설계"), "scene", one("AI 기반 ERP 구축"));
  add(one("AI 기반 ERP 구축 · 2단계 개발"), "scene", one("AI 기반 ERP 구축"));
  return { records };
}

test("옛 기록 37개 모양의 예시에서 새 학력 1·교육 1·자격 3·공백 2·경력 1이 되고, 사례는 머리 아래로 모인다", async () => {
  const ids = await seedNotionShape();
  const ai = movingAi(notionClassify);
  const progress = await runAll(ai);
  expect(progress.failed).toEqual([]);

  // 정리는 한 번, 맨 먼저
  const classify = ai.requests.filter((r) => r.messages[0].text.startsWith("[옮기기: 정리]"));
  expect(classify).toHaveLength(1);
  expect(ai.requests[0]).toBe(classify[0]);

  const facts = await listFacts(db, "u1");
  expect(facts.education).toHaveLength(1);
  expect(facts.course).toHaveLength(1);
  expect(facts.credential).toHaveLength(3);
  expect(facts.gap).toHaveLength(2);
  expect(facts.job).toHaveLength(1);
  expect(facts.activity).toHaveLength(1);
  expect(facts.project.map((p) => p.value.name).sort()).toEqual(["AI 기반 ERP 구축", "고객 문의 대시보드"]);

  // 남길 것은 코드가 정한다: 확인된 것 → 본문이 긴 것 → 먼저 만든 것
  expect(facts.education[0].movedFrom).toBe(ids.school[1]); // 확인됨
  expect(facts.course[0].movedFrom).toBe(ids.training[1]); // 본문이 김
  expect(facts.credential.map((c) => c.movedFrom).sort()).toEqual([ids.certA[0], ids.certB[0], ids.certC].sort()); // 먼저 만든 것
  expect(facts.job[0].movedFrom).toBe(ids.jobs[1]); // 본문이 김
  expect(facts.project.find((p) => p.value.name === "고객 문의 대시보드")?.movedFrom).toBe(ids.dashboard[0]);

  // 재직은 머리(담당 업무 줄까지)만, 사례는 성과 사례 둘
  const job = facts.job[0];
  expect(job.value.duties).toEqual(["거래처 관리"]);
  const scenes = await listScenes(db, "u1");
  const under = (kind: string, id: string) => scenes.filter((s) => s.head.kind === kind && s.head.id === id).map((s) => s.title).sort();
  expect(under("job", job.id)).toEqual(["성과 사례 · 거래처 재계약 (STAR)", "성과 사례 · 재고 정리 (STAR)"]);
  const erp = facts.project.find((p) => p.value.name === "AI 기반 ERP 구축")!;
  expect(under("project", erp.id)).toEqual(["AI 기반 ERP 구축", "AI 기반 ERP 구축 · 1단계 설계", "AI 기반 ERP 구축 · 2단계 개발"]);
  expect(scenes).toHaveLength(7); // 재직 2 + ERP 3 + 대시보드 1 + 봉사 1
  // 머리만 만들 때는 사례를 만들지 말라고 알린다
  const jobRequest = ai.requests.find((r) => r.messages[0].text.includes("'재직' 한 건"));
  expect(jobRequest?.messages[0].text).toContain("사례는 따로 옮깁니다");

  // 확인됐던 성과 사례는 경력 아래에서 확인 상태와 주장 답을 이어 간다
  const confirmedStar = scenes.find((s) => s.title === "성과 사례 · 재고 정리 (STAR)")!;
  const star = await getScene(db, "u1", confirmedStar.id);
  expect(star).toMatchObject({ isConfirmed: true, state: "confirmed", movedFrom: ids.star[0], head: { kind: "job", id: job.id } });
  // 다른 머리의 사례는 머리와 다른 자기 기간을 장면에 둔다
  expect(star).toMatchObject({ startMonth: "2021-03", endMonth: "2021-08" });
  expect(star?.rubric).toEqual(allMet);
  const claims = await listRecordClaims(db, "u1", { kind: "scene", id: confirmedStar.id });
  expect(claims.map((claim) => claim.status)).toEqual(["confirmed", "fixed"]);

  // 같은 기록 행은 아무것도 만들지 않고 메모와 함께 done. 화면의 개수는 옛 기록 모두
  const rows = await db.select().from(moves).where(eq(moves.userId, "u1"));
  const duplicates = rows.filter((row) => row.role === "duplicate");
  expect(duplicates).toHaveLength(8);
  expect(duplicates.every((row) => row.status === "done" && row.error === "같은 기록이 있어 하나만 옮겼습니다")).toBe(true);
  expect(rows.find((row) => row.oldId === ids.school[0])).toMatchObject({ role: "duplicate", ref: ids.school[1] });
  const summary = await moveSummary(db, "u1");
  expect(summary).toMatchObject({ recordTotal: 23, recordDone: 23, recordFailed: 0, classify: { status: "done" } });
});

test("정리에 실패하면 classify 행만 실패하고 기록 행은 기다리며, 다시 시도하면 정리부터 이어 간다", async () => {
  await createExperience(db, "u1", old({ kind: "project", name: "고객 문의 대시보드" }));
  await createExperience(db, "u1", old({ kind: "project", name: "고객 문의 대시보드 구축" }));
  await planMoves(db, "u1");
  let calls = 0;
  const ai = movingAi(() => ((calls += 1) === 1 ? { fail: "unavailable" } : { records: [] }));
  const progress = await runNextMove(db, ai, "u1", now);
  expect(progress.pending).toBe(0);
  expect(progress.failed.map((item) => item.name)).toEqual(["같은 기록·사례 정리"]);
  const rows = await db.select().from(moves).where(eq(moves.userId, "u1"));
  expect(rows.filter((row) => row.step === "record").every((row) => row.status === "pending")).toBe(true);
  expect(await listFacts(db, "u1").then((f) => f.project)).toHaveLength(0);

  await retryMove(db, "u1", progress.failed[0].id, now);
  for (let i = 0; i < 3; i += 1) await runNextMove(db, ai, "u1", now);
  // 빈 답이면 모두 기본값(프로젝트는 머리)
  expect((await listFacts(db, "u1")).project).toHaveLength(2);
});

test("장면의 머리가 그 사이 지워졌으면 장면 기록을 자기 머리로 옮긴다", async () => {
  const head = await createExperience(db, "u1", old({ kind: "project", name: "AI 기반 ERP 구축" }));
  const scene = await createExperience(db, "u1", old({ kind: "project", name: "AI 기반 ERP 구축 · 1단계" }));
  const ai = movingAi((request) => {
    const text = request.messages[0].text;
    const of = (name: string) => aliasesOf(text, name)[0];
    return { records: [{ record: of("AI 기반 ERP 구축"), role: "head", ref: null }, { record: of("AI 기반 ERP 구축 · 1단계"), role: "scene", ref: of("AI 기반 ERP 구축") }] };
  });
  await planMoves(db, "u1");
  await runNextMove(db, ai, "u1", now); // 정리
  await runNextMove(db, ai, "u1", now); // 머리
  const [moved] = (await listFacts(db, "u1")).project;
  expect(moved.movedFrom).toBe(head);
  await db.delete(sceneRows).where(eq(sceneRows.projectId, moved.id));
  await db.delete(projects).where(eq(projects.id, moved.id));
  await runNextMove(db, ai, "u1", now);
  const [own] = (await listFacts(db, "u1")).project;
  expect(own.movedFrom).toBe(scene);
  expect((await listScenes(db, "u1")).map((s) => s.head.id)).toEqual([own.id]);
});

test("같은 기록 행은 AI를 부르지 않고 아무것도 만들지 않는다", async () => {
  const a = await createExperience(db, "u1", old({ kind: "project", name: "고객 문의 대시보드" }));
  const result = await moveRecord(db, createFakeAi([]), "u1", a, now, { role: "duplicate", ref: "other" });
  expect(result).toEqual({ ok: true, note: "같은 기록이 있어 하나만 옮겼습니다" });
  expect((await listFacts(db, "u1")).project).toHaveLength(0);
});

test("정리가 한도 밖의 까닭으로 두 번 실패하면 모두 기본값으로 정리를 끝내고 메모를 남기며, 기록은 하나씩 옮겨진다", async () => {
  const a = await createExperience(db, "u1", old({ kind: "project", name: "고객 문의 대시보드" }));
  const b = await createExperience(db, "u1", old({ kind: "school", name: "한빛대학교", organization: "한빛대학교" }));
  await planMoves(db, "u1");
  const ai = movingAi(() => ({ fail: "invalid" }));
  let progress = await runNextMove(db, ai, "u1", now);
  expect(progress.failed.map((item) => item.name)).toEqual(["같은 기록·사례 정리"]);
  await retryMove(db, "u1", progress.failed[0].id, now);
  progress = await runNextMove(db, ai, "u1", now);
  expect(progress.failed).toEqual([]);
  const rows = await db.select().from(moves).where(eq(moves.userId, "u1"));
  expect(rows.find((row) => row.step === "classify")).toMatchObject({ status: "done", attempts: 2, error: "기록 정리를 하지 못해 하나씩 옮겼습니다" });
  expect(rows.find((row) => row.oldId === a)).toMatchObject({ role: "head", ref: null, status: "pending" });
  expect(rows.find((row) => row.oldId === b)).toMatchObject({ role: "fact", ref: null, status: "pending" });
  // 기록 행이 이어서 잡힌다
  expect((await claimNextMove(db, "u1", now))?.step).toBe("record");
});

test("정리가 한도에 걸리면 두 번째여도 기본값으로 넘기지 않고 실패로 둔다", async () => {
  await createExperience(db, "u1", old({ kind: "project", name: "고객 문의 대시보드" }));
  await createExperience(db, "u1", old({ kind: "project", name: "재고 시스템" }));
  await planMoves(db, "u1");
  await db.update(moves).set({ attempts: 1 }).where(eq(moves.step, "classify"));
  process.env.AI_MONTHLY_LIMIT_USD = "0";
  const progress = await runNextMove(db, movingAi(() => ({ records: [] })), "u1", now);
  expect(progress.failed.map((item) => item.name)).toEqual(["같은 기록·사례 정리"]);
  expect(progress.failed[0].error).toBe("이번 달 AI 사용 한도에 닿았습니다. 다음 달에 다시 시도해 주세요");
});

// ---- 작업 검토 (Task 13) ----

test("정리가 한도로 모두 실패한 뒤 기록 하나만 다시 시도해도, 정리가 그것을 실패한 머리의 장면으로 정하면 머리를 되살려 끝까지 옮긴다", async () => {
  const job = await createExperience(db, "u1", old({ kind: "job", name: "한빛전자 영업", organization: "한빛전자", startMonth: "2020-03", endMonth: "2024-02", metrics: [] }));
  const star = await createExperience(db, "u1", old({ kind: "project", name: "성과 사례 · 재고 정리 (STAR)", organization: "한빛전자", metrics: [] }));
  await planMoves(db, "u1");
  process.env.AI_MONTHLY_LIMIT_USD = "0";
  const ai = movingAi((request) => {
    const text = request.messages[0].text;
    const of = (name: string) => aliasesOf(text, name)[0];
    return { records: [{ record: of("한빛전자 영업"), role: "head", ref: null }, { record: of("성과 사례 · 재고 정리 (STAR)"), role: "scene", ref: of("한빛전자 영업") }] };
  });
  await runNextMove(db, ai, "u1", now); // 정리가 한도에 걸린다
  await failPendingMoves(db, "u1", "한도", now); // moveNext가 하는 것처럼 남은 것도 실패로
  delete process.env.AI_MONTHLY_LIMIT_USD;

  // 다음 달: 사례 기록 하나만 다시 시도한다(정리도 함께 pending)
  const starRow = (await db.select().from(moves).where(eq(moves.oldId, star)))[0];
  await retryMove(db, "u1", starRow.id, now);
  let progress = await runNextMove(db, ai, "u1", now); // 정리 → 사례는 실패한 재직의 장면이 된다
  const jobRow = (await db.select().from(moves).where(eq(moves.oldId, job)))[0];
  expect(jobRow).toMatchObject({ status: "pending" }); // 머리를 되살렸다
  for (let i = 0; i < 5 && progress.pending > 0; i += 1) progress = await runNextMove(db, ai, "u1", now);
  expect(progress.pending).toBe(0);
  const [moved] = (await listFacts(db, "u1")).job;
  expect((await listScenes(db, "u1")).map((s) => [s.title, s.head.id])).toEqual([["성과 사례 · 재고 정리 (STAR)", moved.id]]);
});

test("기본값으로 넘기는 것은 한도 밖의 실패만 센다: 한도 한 번 + 실패 한 번은 아직 실패, 실패 두 번째에 넘긴다", async () => {
  await createExperience(db, "u1", old({ kind: "project", name: "고객 문의 대시보드" }));
  await createExperience(db, "u1", old({ kind: "project", name: "재고 시스템" }));
  await planMoves(db, "u1");
  const classifyRow = async () => (await db.select().from(moves).where(eq(moves.step, "classify")))[0];
  const ai = movingAi(() => ({ fail: "unavailable" }));
  process.env.AI_MONTHLY_LIMIT_USD = "0";
  await runNextMove(db, ai, "u1", now);
  delete process.env.AI_MONTHLY_LIMIT_USD;
  expect(await classifyRow()).toMatchObject({ status: "failed", attempts: 0 });
  await retryMove(db, "u1", (await classifyRow()).id, now);
  await runNextMove(db, ai, "u1", now);
  expect(await classifyRow()).toMatchObject({ status: "failed", attempts: 1 });
  await retryMove(db, "u1", (await classifyRow()).id, now);
  await runNextMove(db, ai, "u1", now);
  expect(await classifyRow()).toMatchObject({ status: "done", error: "기록 정리를 하지 못해 하나씩 옮겼습니다" });
});

test("정리 중 예외가 나도 실패로 세어 두 번째에 기본값으로 넘긴다", async () => {
  await createExperience(db, "u1", old({ kind: "project", name: "고객 문의 대시보드" }));
  await createExperience(db, "u1", old({ kind: "project", name: "재고 시스템" }));
  await planMoves(db, "u1");
  const ai = movingAi(() => {
    throw new Error("연결 끊김");
  });
  let progress = await runNextMove(db, ai, "u1", now);
  expect(progress.failed.map((item) => item.name)).toEqual(["같은 기록·사례 정리"]);
  await retryMove(db, "u1", progress.failed[0].id, now);
  progress = await runNextMove(db, ai, "u1", now);
  expect(progress.failed).toEqual([]);
  expect((await db.select().from(moves).where(eq(moves.step, "classify")))[0]).toMatchObject({ status: "done", error: "기록 정리를 하지 못해 하나씩 옮겼습니다" });
});

test("사례가 자기 머리로 옮겨지면(머리가 지워짐) 끝난 소속 잇기를 다시 돌게 한다", async () => {
  await createExperience(db, "u1", old({ kind: "job", name: "한빛전자 영업", organization: "한빛전자", startMonth: "2020-03", endMonth: "2024-02", metrics: [] }));
  await createExperience(db, "u1", old({ kind: "project", name: "AI 기반 ERP 구축" }));
  await createExperience(db, "u1", old({ kind: "project", name: "AI 기반 ERP 구축 · 1단계" }));
  const ai = movingAi((request) => {
    const text = request.messages[0].text;
    const of = (name: string) => aliasesOf(text, name)[0];
    return {
      records: [
        { record: of("한빛전자 영업"), role: "head", ref: null },
        { record: of("AI 기반 ERP 구축"), role: "head", ref: null },
        { record: of("AI 기반 ERP 구축 · 1단계"), role: "scene", ref: of("AI 기반 ERP 구축") },
      ],
    };
  });
  await planMoves(db, "u1");
  for (let i = 0; i < 3; i += 1) await runNextMove(db, ai, "u1", now); // 정리, 재직, 머리 프로젝트
  const head = (await listFacts(db, "u1")).project[0];
  await db.delete(sceneRows).where(eq(sceneRows.projectId, head.id));
  await db.delete(projects).where(eq(projects.id, head.id));
  await db.update(moves).set({ status: "done" }).where(eq(moves.step, "affiliate"));
  await runNextMove(db, ai, "u1", now); // 사례가 자기 머리로
  expect((await db.select().from(moves).where(eq(moves.step, "affiliate")))[0].status).toBe("pending");
});

test("옮긴 기록을 모두 지우고 다시 옮기면 같은 정리된 구조가 나온다(중복 없이)", async () => {
  const ids = await seedNotionShape();
  await runAll(movingAi(notionClassify));
  const snapshot = async () => {
    const facts = await listFacts(db, "u1");
    return {
      counts: [facts.education, facts.course, facts.credential, facts.gap, facts.job, facts.project, facts.activity].map((list) => list.length),
      scenes: (await listScenes(db, "u1")).map((s) => s.title).sort(),
      moved: [...facts.education, ...facts.job].map((f) => f.movedFrom).sort(),
    };
  };
  const first = await snapshot();

  expect(await resetMoves(db, "u1")).toEqual({ ok: true });
  expect(await listScenes(db, "u1")).toEqual([]);
  expect(await db.select().from(moves).where(eq(moves.userId, "u1"))).toEqual([]);

  const progress = await runAll(movingAi(notionClassify));
  expect(progress.failed).toEqual([]);
  expect(await snapshot()).toEqual(first);
  expect(first.counts).toEqual([1, 1, 3, 2, 1, 2, 1]);
  expect(first.moved).toEqual([ids.school[1], ids.jobs[1]].sort());
  expect((await moveSummary(db, "u1")).duplicateDone).toBe(8);
});

test("AI 답을 기다리는 사이 다른 탭에서 다시 옮기기를 하면, 늦게 온 답은 저장하지 않는다(새로 옮기는 것만 남는다)", async () => {
  await createExperience(db, "u1", old({ kind: "school", name: "한국대학교 컴퓨터공학과", startMonth: "2015-03", endMonth: "2019-02" }));
  await planMoves(db, "u1");
  const school = {
    ...emptyImport,
    education: [
      { schoolName: "한국대학교", location: "", degree: "bachelor", major: "컴퓨터공학과", startMonth: "2015-03", endMonth: "2019-02", status: "graduated", gpa: "", gpaScale: "" },
    ],
  };
  const stale = createFakeAi([
    async () => {
      expect(await resetMoves(db, "u1")).toEqual({ ok: true });
      return school;
    },
  ]);
  await runNextMove(db, stale, "u1", now);
  expect((await listFacts(db, "u1")).education).toHaveLength(0);

  await planMoves(db, "u1");
  await runNextMove(db, createFakeAi([school]), "u1", now);
  expect((await listFacts(db, "u1")).education).toHaveLength(1);
});

test("정리 답을 기다리는 사이 다시 옮기기를 하면, 늦게 온 정리는 새 기록 행의 역할을 바꾸지 않는다", async () => {
  await createExperience(db, "u1", old({ kind: "school", name: "한국대학교", startMonth: "2015-03", endMonth: "2019-02" }));
  await createExperience(db, "u1", old({ kind: "school", name: "한국대학교", startMonth: "2015-03", endMonth: "2019-02" }));
  await planMoves(db, "u1");
  const stale = createFakeAi([
    async () => {
      expect(await resetMoves(db, "u1")).toEqual({ ok: true });
      await planMoves(db, "u1");
      return { records: [{ record: "R1", role: "fact", ref: null }, { record: "R2", role: "duplicate", ref: "R1" }] };
    },
  ]);
  await runNextMove(db, stale, "u1", now);
  const rows = await db.select().from(moves).where(eq(moves.userId, "u1"));
  expect(rows.filter((row) => row.step === "record").map((row) => row.role)).toEqual([null, null]);
  expect(rows.find((row) => row.step === "classify")?.status).toBe("pending");
});
