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
import { createFact, getFact, listFacts } from "./facts-repo";
import type { ExperienceInput } from "./input";
import { affiliateProjects, moveRecord, runNextMove } from "./move";
import { claimNextMove, planMoves, retryMove } from "./move-repo";
import type { Kind } from "./options";
import { listRecordClaims } from "./record-claims-repo";
import type { ProjectInput } from "./record-input";
import { closeRubricItem, confirmExperience, createExperience, setTrackScope } from "./repo";
import { experiences, moves, projects, type StoredRubric } from "./schema";
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
  // 확인된 프로젝트는 AI를 부르지 않고, 학력은 AI가 실패한다. 소속 잇기는 조직이 없어 AI를 부르지 않는다
  const ai = createFakeAi([{ fail: "unavailable" }]);

  let progress = await runNextMove(db, ai, "u1", now);
  expect(progress.total).toBe(3);
  progress = await runNextMove(db, ai, "u1", now);
  progress = await runNextMove(db, ai, "u1", now);
  expect(progress).toMatchObject({ total: 3, done: 2, pending: 0 });
  expect(progress.failed).toHaveLength(1);
  expect(progress.failed[0].name).toBe("한국대학교 컴퓨터공학과");
  expect(progress.failed[0].error).toContain("AI");

  // 잡을 것이 없으면 진행만 돌려준다
  expect(await runNextMove(db, ai, "u1", now)).toEqual(progress);
  expect(ai.requests).toHaveLength(1);
  expect(ai.requests[0].messages[0].text).not.toContain("u1");
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
    return jobImport;
  };
  const ai = createFakeAi(Array.from({ length: 6 }, () => answer));
  for (let i = 0; i < 3; i += 1) await runNextMove(db, ai, "u1", now);
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
