import { beforeEach, expect, test } from "vitest";
import { createTestDb } from "@/db/test-db";
import type { Db } from "@/db/types";
import { createFakeAi } from "@/modules/ai/fake-client";
import { user } from "@/modules/auth/schema";
import { listFacts } from "./facts-repo";
import { listRecordClaims } from "./record-claims-repo";
import { importRecords, requestRecordImport, saveImportPlan } from "./record-import";
import { getScene, listScenes } from "./scenes-repo";

let db: Db;
const now = new Date("2026-11-20T03:00:00Z");

const SOURCE = `[학력]
한국대학교 경영학과 (2016.03 ~ 2022.02) 졸업

[자격]
정보처리기사 2021.11

[경력]
가나다커머스 마케팅팀 정규직 2022.03 ~ 2024.02
- SNS 채널 운영을 총괄
- 신규 고객 유입 캠페인을 주도하여 매출 30% 향상에 기여
- 고객 설문을 설계하고 결과를 정리했다
사용 금지: "ERP 구축 주도"

[프로젝트]
브랜드 리뉴얼 TF 2023.06 ~ 2023.09
- 리뉴얼 TF에 참여해 회의 자료를 만들었다`;

const scene = (over: Record<string, unknown> = {}) => ({
  title: "장면",
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
  ...over,
});

const education = (over: Record<string, unknown> = {}) => ({
  schoolName: "한국대학교",
  location: "",
  degree: "bachelor",
  major: "경영학과",
  startMonth: "2016-03",
  endMonth: "2022-02",
  status: "graduated",
  gpa: "",
  gpaScale: "",
  ...over,
});

const jobAnswer = (over: Record<string, unknown> = {}) => ({
  company: "가나다커머스",
  department: "마케팅팀",
  title: "",
  employment: "regular",
  startMonth: "2022-03",
  endMonth: "2024-02",
  isOngoing: false,
  duties: ["SNS 채널 운영을 총괄"],
  bannedPhrases: ["ERP 구축 주도", "지어낸 표현"],
  roleClaims: [],
  scenes: [
    scene({ title: "신규 고객 캠페인", actions: "신규 고객 유입 캠페인을 주도하여 매출 30% 향상에 기여" }),
    scene({ title: "고객 설문", actions: "고객 설문을 설계하고 결과를 정리했다" }),
  ],
  ...over,
});

const answer = (over: Record<string, unknown> = {}) => ({
  education: [education()],
  courses: [],
  credentials: [{ type: "license", name: "정보처리기사", issuer: "", month: "2021-11", score: "" }],
  gaps: [],
  jobs: [jobAnswer()],
  projects: [
    {
      name: "브랜드 리뉴얼 TF",
      parentIndex: { kind: "job", index: 0 },
      startMonth: "2023-06",
      endMonth: "2023-09",
      isOngoing: false,
      role: "",
      tools: [],
      summary: "리뉴얼 TF에 참여해 회의 자료를 만들었다",
      bannedPhrases: [],
      roleClaims: [],
      scenes: [],
    },
  ],
  activities: [],
  more: false,
  ...over,
});

beforeEach(async () => {
  delete process.env.AI_MONTHLY_LIMIT_USD;
  db = await createTestDb();
  await db.insert(user).values([
    { id: "u1", name: "A", email: "u1@example.com" },
    { id: "u2", name: "B", email: "u2@example.com" },
  ]);
});

test("메뉴별로 나눈 답을 계획으로 만든다. 프로젝트는 같은 묶음의 경력을 가리킨다", async () => {
  const ai = createFakeAi([answer()]);
  const result = await requestRecordImport(db, ai, "u1", SOURCE, {}, now);
  expect(ai.requests[0]).toMatchObject({ purpose: "import_records" });
  // Anthropic SDK는 스트리밍 없이 답 길이를 크게 잡으면 보내기 전에 거절한다(2026-11-20 실서비스 옮기기 실패). 다른 기능처럼 16000 이하
  expect(ai.requests[0].maxTokens).toBeLessThanOrEqual(16000);
  expect(ai.requests[0].messages[0].text).toContain(SOURCE);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  const { plan } = result;
  expect(plan.education).toHaveLength(1);
  expect(plan.credentials).toHaveLength(1);
  expect(plan.jobs).toHaveLength(1);
  expect(plan.jobs[0].scenes).toHaveLength(2);
  expect(plan.projects).toHaveLength(1);
  expect(plan.projects[0].parentIndex).toEqual({ kind: "job", index: 0 });
  expect(plan.education[0]).toMatchObject({ schoolName: "한국대학교", location: null, gpa: null, gpaScale: null });
  expect(result.skipped).toBe(0);
  // 원본에 글자 그대로 있는 금지 표현만 남는다
  expect(plan.jobs[0].input.bannedPhrases).toEqual(["ERP 구축 주도"]);
  // 경력의 담당 업무에서 과장 낱말을 주장으로 잡는다
  expect(plan.jobs[0].claims.some((claim) => claim.quote === "SNS 채널 운영을 총괄")).toBe(true);
});

test("원본에 없던 숫자가 든 장면 구절은 처음부터 고쳐야 할 것으로 둔다", async () => {
  const invented = jobAnswer({
    scenes: [scene({ title: "캠페인", actions: "신규 고객 유입 캠페인을 주도하여 매출 50% 향상에 기여" })],
  });
  const result = await requestRecordImport(db, createFakeAi([answer({ jobs: [invented] })]), "u1", SOURCE, {}, now);
  if (!result.ok) throw new Error(result.reason);
  const claims = result.plan.jobs[0].scenes[0].claims;
  expect(claims.find((claim) => claim.quote.includes("50%"))?.status).toBe("needs_fix");
  // 원본에 있던 숫자는 그냥 확인할 것
  const fine = await requestRecordImport(db, createFakeAi([answer()]), "u1", SOURCE, {}, now);
  if (!fine.ok) throw new Error(fine.reason);
  expect(fine.plan.jobs[0].scenes[0].claims.find((claim) => claim.quote.includes("30%"))?.status).toBe("pending");
});

test("검사를 통과하지 못한 것은 건너뛰고, 그 경력을 가리키던 프로젝트는 개인으로 둔다", async () => {
  const result = await requestRecordImport(
    db,
    createFakeAi([answer({ education: [education({ schoolName: "" })], jobs: [jobAnswer({ company: "" })] })]),
    "u1",
    SOURCE,
    {},
    now,
  );
  if (!result.ok) throw new Error(result.reason);
  expect(result.skipped).toBe(2);
  expect(result.plan.education).toHaveLength(0);
  expect(result.plan.jobs).toHaveLength(0);
  expect(result.plan.projects[0].parentIndex).toBeNull();
});

test("머리·이력 사실은 30개, 머리마다 장면은 8개까지 받고 나머지가 있으면 more", async () => {
  const many = Array.from({ length: 31 }, () => education());
  const cut = await requestRecordImport(db, createFakeAi([answer({ education: many, credentials: [], jobs: [], projects: [] })]), "u1", SOURCE, {}, now);
  if (!cut.ok) throw new Error(cut.reason);
  expect(cut.plan.education).toHaveLength(30);
  expect(cut.more).toBe(true);
  const scenes = Array.from({ length: 9 }, (_, i) => scene({ title: `장면 ${i + 1}` }));
  const capped = await requestRecordImport(db, createFakeAi([answer({ jobs: [jobAnswer({ scenes })] })]), "u1", SOURCE, {}, now);
  if (!capped.ok) throw new Error(capped.reason);
  expect(capped.plan.jobs[0].scenes).toHaveLength(8);
  expect(capped.more).toBe(true);
});

test("아무것도 없으면 nothing_found, 옮기기면 목적과 구분 안내를 붙인다", async () => {
  const empty = answer({ education: [], credentials: [], jobs: [], projects: [] });
  expect(await requestRecordImport(db, createFakeAi([empty]), "u1", SOURCE, {}, now)).toEqual({ ok: false, reason: "nothing_found" });
  const ai = createFakeAi([answer()]);
  await requestRecordImport(db, ai, "u1", SOURCE, { purpose: "migrate", hint: "job" }, now);
  expect(ai.requests[0].purpose).toBe("migrate");
  // 첫 줄은 옮기기의 어떤 요청인지 적는다(로컬 미리보기의 가짜 AI가 고른다)
  expect(ai.requests[0].messages[0].text.startsWith("[옮기기: 나누기]\n이 글은 예전 기록의 '재직' 한 건입니다")).toBe(true);
  // 가져오기에는 붙이지 않는다
  const plain = createFakeAi([answer()]);
  await requestRecordImport(db, plain, "u1", SOURCE, {}, now);
  expect(plain.requests[0].messages[0].text.startsWith("[가져올 글]")).toBe(true);
});

test("저장하면 모두 미확인이고 출처는 가져오기, 주장은 장면과 경력에, 프로젝트는 만든 경력에 딸린다", async () => {
  const result = await requestRecordImport(db, createFakeAi([answer()]), "u1", SOURCE, {}, now);
  if (!result.ok) throw new Error(result.reason);
  const { created } = await saveImportPlan(db, "u1", result.plan, { source: "import" });
  expect(created.map((item) => item.kind).sort()).toEqual(["credential", "education", "job", "project", "scene", "scene"]);
  expect(created.find((item) => item.kind === "job")?.name).toBe("가나다커머스");

  const facts = await listFacts(db, "u1");
  const all = [...facts.education, ...facts.credential, ...facts.job, ...facts.project];
  expect(all).toHaveLength(4);
  expect(all.every((fact) => !fact.isConfirmed && fact.source === "import")).toBe(true);
  const jobId = facts.job[0].id;
  expect(facts.project[0].value.parent).toEqual({ kind: "job", id: jobId });
  expect((await listRecordClaims(db, "u1", { kind: "job", id: jobId })).length).toBeGreaterThan(0);

  const scenes = await listScenes(db, "u1");
  expect(scenes).toHaveLength(2);
  expect(scenes.every((s) => s.head.kind === "job" && s.head.id === jobId && s.source === "import" && s.state === "unconfirmed")).toBe(true);
  const campaign = scenes.find((s) => s.title === "신규 고객 캠페인")!;
  expect((await listRecordClaims(db, "u1", { kind: "scene", id: campaign.id })).some((claim) => claim.quote.includes("30%"))).toBe(true);
  // 다른 사용자에게는 보이지 않는다
  expect((await listFacts(db, "u2")).job).toEqual([]);
});

test("carry를 주면 모든 장면에 금지 표현을 합치고, 비어 있는 '하지 않은 것'을 채운다", async () => {
  const jobs = [jobAnswer({ scenes: [scene({ title: "가", notDone: "", bannedPhrases: [] }), scene({ title: "나", actions: "고객 설문을 설계하고 결과를 정리했다" })] })];
  const result = await requestRecordImport(db, createFakeAi([answer({ jobs })]), "u1", SOURCE, {}, now);
  if (!result.ok) throw new Error(result.reason);
  const { created } = await saveImportPlan(db, "u1", result.plan, {
    source: "migrate",
    movedFrom: "old-1",
    carry: { notDone: "발주는 하지 않았다", bannedPhrases: ["혼자 구축"] },
  });
  const sceneIds = created.filter((item) => item.kind === "scene").map((item) => item.id);
  expect(sceneIds).toHaveLength(2);
  for (const id of sceneIds) {
    const got = await getScene(db, "u1", id);
    expect(got?.bannedPhrases).toContain("혼자 구축");
    expect(got?.notDone).toBe("발주는 하지 않았다");
    expect(got?.source).toBe("migrate");
    expect(got?.movedFrom).toBe("old-1");
  }
});

test("importRecords: AI가 실패하면 그 사유를 돌려주고 아무것도 저장하지 않는다", async () => {
  expect(await importRecords(db, createFakeAi([{ fail: "unavailable" }]), "u1", SOURCE, now)).toEqual({ ok: false, reason: "unavailable" });
  const facts = await listFacts(db, "u1");
  expect(Object.values(facts).flat()).toEqual([]);
  expect(await listScenes(db, "u1")).toEqual([]);

  const ok = await importRecords(db, createFakeAi([answer()]), "u1", SOURCE, now);
  expect(ok).toMatchObject({ ok: true, skipped: 0, more: false });
  if (ok.ok) expect(ok.created).toHaveLength(6);
});

// ---- 검토에서 더한 것: 짧은 칸의 지어낸 숫자 ----
test("선택 칸에 원본에 없던 숫자가 있으면 그 칸을 비우고, 이름 칸이면 그 항목을 건너뛴다", async () => {
  const result = await requestRecordImport(
    db,
    createFakeAi([
      answer({
        gaps: [{ startMonth: "2022-03", endMonth: "2024-02", note: "7개월간 자격증 준비" }],
        credentials: [{ type: "language", name: "TOEIC 900", issuer: "", month: "", score: "" }],
        jobs: [jobAnswer({ department: "마케팅 5팀", scenes: [scene({ title: "캠페인", actions: "고객 설문을 설계하고 결과를 정리했다" })] })],
        projects: [
          {
            name: "리뉴얼 8기",
            parentIndex: null,
            startMonth: "",
            endMonth: "",
            isOngoing: false,
            role: "",
            tools: ["Figma", "GA4"],
            summary: "",
            bannedPhrases: [],
            roleClaims: [],
            scenes: [scene({ title: "회의 자료" })],
          },
        ],
        activities: [{ name: "학생회", organization: "", startMonth: "", endMonth: "", isOngoing: false, role: "총무 4년", scenes: [] }],
      }),
    ]),
    "u1",
    SOURCE,
    {},
    now,
  );
  if (!result.ok) throw new Error(result.reason);
  expect(result.plan.gaps).toEqual([{ startMonth: "2022-03", endMonth: "2024-02", note: null }]);
  expect(result.plan.credentials).toEqual([]); // TOEIC 900은 원본에 없다
  expect(result.plan.jobs[0].input.department).toBeNull();
  expect(result.plan.projects).toEqual([]); // 이름에 지어낸 숫자 → 건너뛰고 장면도 버린다
  expect(result.plan.activities[0].input.role).toBeNull();
  expect(result.skipped).toBe(2);
  expect(result.inventedDropped).toBe(5); // 메모, 자격 이름, 부서, 프로젝트 이름, 역할
});

test("원본에 있던 숫자는 짧은 칸에 그대로 두고 inventedDropped는 0이다", async () => {
  const result = await requestRecordImport(db, createFakeAi([answer()]), "u1", SOURCE, {}, now);
  if (!result.ok) throw new Error(result.reason);
  expect(result.inventedDropped).toBe(0);
  const tools = await requestRecordImport(
    db,
    createFakeAi([answer({ projects: [{ ...answer().projects[0], tools: ["Figma", "GA4"] }] })]),
    "u1",
    SOURCE,
    {},
    now,
  );
  if (!tools.ok) throw new Error(tools.reason);
  expect(tools.plan.projects[0].input.tools).toEqual(["Figma"]); // GA4의 4는 원본에 없다
  expect(tools.inventedDropped).toBe(1);
});

test("주장이 많아 30개로 자를 때도 고쳐야 할 주장(지어낸 숫자)은 남는다", async () => {
  const lines = Array.from({ length: 35 }, (_, i) => `항목 ${i + 1}을 처리했다`);
  const source = `${SOURCE}\n${lines.join("\n")}`;
  const actions = [...lines, "매출 77% 증가에 기여했다"].join("\n");
  const result = await requestRecordImport(
    db,
    createFakeAi([answer({ jobs: [jobAnswer({ scenes: [scene({ title: "많은 일", actions })] })] })]),
    "u1",
    source,
    {},
    now,
  );
  if (!result.ok) throw new Error(result.reason);
  const claims = result.plan.jobs[0].scenes[0].claims;
  expect(claims).toHaveLength(30);
  expect(claims.find((claim) => claim.quote.includes("77%"))?.status).toBe("needs_fix");
});
