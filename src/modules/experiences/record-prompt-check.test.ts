import { beforeEach, expect, test } from "vitest";
import { createTestDb } from "@/db/test-db";
import type { Db } from "@/db/types";
import type { AiRequest } from "@/modules/ai/client";
import { createFakeAi } from "@/modules/ai/fake-client";
import { user } from "@/modules/auth/schema";
import { describeScene, JUDGE_SYSTEM } from "./prompts";
import { AFFILIATE_SAMPLE, MOVE_SPLIT_SAMPLE, RECORD_IMPORT_SAMPLE, runRecordCheck, SCENE_JUDGE_SAMPLES, SCENE_SAMPLES } from "./record-prompt-check";

let db: Db;

beforeEach(async () => {
  delete process.env.AI_MONTHLY_LIMIT_USD;
  db = await createTestDb();
  await db.insert(user).values({ id: "admin", name: "A", email: "a@example.com" });
});

const blankScene = {
  title: "",
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
};

// 첫 예시(장면 둘을 말한 대화): 배송 지연 장면만 정리한다
const delayScene = {
  ...blankScene,
  title: "배송 지연 문의 대응",
  situation: "배송 지연 문의가 몰렸다",
  actions: "지연된 주문을 지역별로 묶어 고객에게 안내 문자를 보냈다",
  result: "문의가 줄었다",
  notDone: "보상 기준은 팀장이 정했다",
};

// 둘째 예시(수치를 말한 대화)
const tutoringScene = {
  ...blankScene,
  title: "초등학생 수학 학습 지도",
  startMonth: "2023-03",
  endMonth: "2023-12",
  actions: "매주 토요일 4명을 맡아 문제집 풀이를 도왔다",
  result: "4명 중 3명의 단원평가 점수가 올랐다",
  notDone: "교재는 센터에서 정했다",
};

const sceneOf = (over: Record<string, unknown>) => ({ ...blankScene, roleClaims: [], bannedPhrases: [], ...over });

const importAnswer = (educationOver: Record<string, unknown> = {}) => ({
  education: [
    {
      schoolName: "한국대학교",
      location: "",
      degree: "bachelor",
      major: "경영학과",
      startMonth: "2016-03",
      endMonth: "2022-02",
      status: "graduated",
      gpa: "",
      gpaScale: "",
      ...educationOver,
    },
  ],
  courses: [],
  credentials: [{ type: "license", name: "정보처리기사", issuer: "", month: "2021-11", score: "" }],
  gaps: [],
  jobs: [
    {
      company: "가나다커머스",
      department: "마케팅팀",
      title: "",
      employment: "regular",
      startMonth: "2022-03",
      endMonth: "2024-02",
      isOngoing: false,
      duties: ["SNS 채널 운영", "캠페인 집행"],
      bannedPhrases: [],
      roleClaims: [],
      scenes: [
        sceneOf({ title: "재방문 쿠폰 캠페인", actions: "재방문 쿠폰 캠페인을 기획하고 문구를 직접 썼다", result: "재방문율이 12%에서 15%로 올랐다" }),
        sceneOf({ title: "고객 설문 개편", actions: "응답률이 낮던 설문을 문항 수를 줄여 다시 만들었다", notDone: "설문 도구 선정은 팀장이 했다" }),
      ],
    },
  ],
  projects: [
    {
      name: "브랜드 리뉴얼 TF",
      parentIndex: { kind: "job", index: 0 },
      startMonth: "2023-06",
      endMonth: "2023-09",
      isOngoing: false,
      role: "",
      tools: [],
      summary: "고객 설문 결과를 정리해 TF 회의 자료로 만들었다",
      bannedPhrases: [],
      roleClaims: [],
      scenes: [],
    },
  ],
  activities: [],
  more: false,
});

// 옮기기 예시(재직 기록 하나): 경력 하나와 장면 둘
const moveAnswer = () => ({
  education: [],
  courses: [],
  credentials: [],
  gaps: [],
  jobs: [
    {
      company: "나라물산",
      department: "구매팀",
      title: "사원",
      employment: "regular",
      startMonth: "2019-01",
      endMonth: "2021-06",
      isOngoing: false,
      duties: [],
      bannedPhrases: [],
      roleClaims: [],
      scenes: [
        sceneOf({ title: "납품 일정 조율", actions: "협력사 납품 일정을 매주 표로 정리해 생산팀과 맞췄다" }),
        sceneOf({ title: "단가 비교표", actions: "부품 단가 비교표를 만들어 팀장에게 올렸다", result: "견적 비교에 쓰였다" }),
      ],
    },
  ],
  projects: [],
  activities: [],
  more: false,
});

// 보낸 글에서 이름으로 별명(P1, J1 …)을 찾는다
const aliasOf = (text: string, name: string) => text.match(new RegExp(`^([PJSC]\\d+) \\| 이름: ${name}`, "m"))?.[1] ?? "";

const affiliateAnswer = (text: string) => ({
  links: [
    { project: aliasOf(text, "물류 대시보드"), parent: aliasOf(text, "나라물산") },
    { project: aliasOf(text, "졸업 작품"), parent: aliasOf(text, "한국대학교") },
  ],
});

const CALLS = SCENE_JUDGE_SAMPLES.length + SCENE_SAMPLES.length + 3;

// 판정 예시마다 기대한 판정을 돌려준다(기대에 없는 항목은 충족). wrong이 주어지면 그 예시의 판정을 바꾼다
const judgeAnswer = (text: string, wrong: Record<string, Record<string, "met" | "unmet">> = {}) => {
  const sample = SCENE_JUDGE_SAMPLES.find((s) => describeScene(s.scene, s.head) === text);
  if (!sample) throw new Error("모르는 판정 예시");
  const verdict = { ...sample.expect, ...wrong[sample.name] };
  const item = (key: "role" | "level" | "metrics" | "evidence") => ({ status: verdict[key] ?? "met", note: "" });
  return {
    role: item("role"),
    level: item("level"),
    metrics: item("metrics"),
    evidence: item("evidence"),
    phraseCandidates: sample.candidates === "some" ? ["설계를 주도"] : [],
  };
};

const answering = (
  importing: unknown,
  moving: unknown = moveAnswer(),
  affiliating = affiliateAnswer,
  wrongVerdicts: Record<string, Record<string, "met" | "unmet">> = {},
) =>
  createFakeAi(
    Array.from({ length: CALLS }, () => (request: AiRequest<unknown>) => {
      if (request.purpose === "judge") return judgeAnswer(request.messages[0].text, wrongVerdicts);
      if (request.purpose === "import_records") return importing;
      if (request.purpose === "migrate") {
        const text = request.messages[0].text;
        return text.startsWith("[옮기기: 소속]") ? affiliating(text) : moving;
      }
      return request.messages[0].text.includes("가나다물류") ? delayScene : tutoringScene;
    }),
  );

test("기대대로 답하는 AI면 모든 줄이 통과한다", async () => {
  const ai = answering(importAnswer());
  const rows = await runRecordCheck(db, ai, "admin");
  expect(ai.requests).toHaveLength(CALLS);
  expect(ai.requests.filter((r) => r.purpose === "extract_scene")).toHaveLength(SCENE_SAMPLES.length);
  expect(ai.requests.filter((r) => r.purpose === "judge")).toHaveLength(SCENE_JUDGE_SAMPLES.length);
  expect(rows.length).toBeGreaterThan(6);
  expect(rows.filter((row) => !row.pass)).toEqual([]);
  // 예시마다 줄이 있다
  expect(ai.requests.filter((r) => r.purpose === "migrate")).toHaveLength(2);
  for (const sample of [...SCENE_JUDGE_SAMPLES.map((s) => s.name), ...SCENE_SAMPLES.map((s) => s.name), RECORD_IMPORT_SAMPLE.name, MOVE_SPLIT_SAMPLE.name, AFFILIATE_SAMPLE.name]) {
    expect(rows.some((row) => row.sample === sample)).toBe(true);
  }
});

test("장면 판정 예시: judgeScene과 같은 요청을 보내고, 기대와 다른 판정은 그 줄만 실패한다", async () => {
  const ai = answering(importAnswer(), moveAnswer(), affiliateAnswer, { "본인 역할이 흐린 기록": { role: "met" } });
  const rows = await runRecordCheck(db, ai, "admin");
  const judge = ai.requests.filter((r) => r.purpose === "judge");
  expect(judge.every((r) => r.system === JUDGE_SYSTEM && r.effort === "medium")).toBe(true);
  expect(judge[0].messages[0].text).toContain("[장면 제목]\n주문 조회 API 개선");
  const failed = rows.filter((row) => !row.pass);
  expect(failed).toHaveLength(1);
  expect(failed[0]).toMatchObject({ sample: "본인 역할이 흐린 기록", check: "본인 역할", expected: "미달", actual: "충족" });
});

test("장면 판정 예시: 과장 후보가 나와야 하는 예시에서 없으면 실패한다", async () => {
  const ai = createFakeAi(
    Array.from({ length: CALLS }, () => (request: AiRequest<unknown>) => {
      if (request.purpose === "judge") return { ...judgeAnswer(request.messages[0].text), phraseCandidates: [] };
      if (request.purpose === "import_records") return importAnswer();
      if (request.purpose === "migrate") {
        const text = request.messages[0].text;
        return text.startsWith("[옮기기: 소속]") ? affiliateAnswer(text) : moveAnswer();
      }
      return request.messages[0].text.includes("가나다물류") ? delayScene : tutoringScene;
    }),
  );
  const failed = (await runRecordCheck(db, ai, "admin")).filter((row) => !row.pass);
  expect(failed.map((row) => [row.sample, row.check])).toEqual([
    ["구체적인 기록", "과장 표현 후보"],
    ["평범하지만 분명한 기록", "과장 표현 후보"],
  ]);
});

test("학력에 서술을 넣은 답이면 그 줄이 실패한다", async () => {
  const rows = await runRecordCheck(db, answering(importAnswer({ major: "경영학과. 학생회 총무로 축제 예산을 정리했다" })), "admin");
  const failed = rows.filter((row) => !row.pass);
  expect(failed).toHaveLength(1);
  expect(failed[0]).toMatchObject({ sample: RECORD_IMPORT_SAMPLE.name, check: "학력에 서술을 넣지 않는다" });
});

test("원본에 없던 숫자 때문에 칸을 비웠으면 숫자 줄이 실패한다", async () => {
  const answer = importAnswer();
  answer.jobs[0].department = "마케팅 5팀";
  const rows = await runRecordCheck(db, answering(answer), "admin");
  const failed = rows.filter((row) => !row.pass);
  expect(failed).toHaveLength(1);
  expect(failed[0]).toMatchObject({ sample: RECORD_IMPORT_SAMPLE.name, check: "원본에 없던 숫자를 넣지 않는다" });
});

test("다른 장면을 섞거나 대화에 없던 숫자를 넣으면 그 줄이 실패한다", async () => {
  const ai = createFakeAi(
    Array.from({ length: CALLS }, () => (request: AiRequest<unknown>) => {
      if (request.purpose === "judge") return judgeAnswer(request.messages[0].text);
      if (request.purpose === "import_records") return importAnswer();
      if (request.purpose === "migrate") {
        const text = request.messages[0].text;
        return text.startsWith("[옮기기: 소속]") ? affiliateAnswer(text) : moveAnswer();
      }
      return request.messages[0].text.includes("가나다물류")
        ? { ...delayScene, lessons: "창고 재고 실사도 했다" }
        : { ...tutoringScene, result: "4명 중 3명의 점수가 20점 올랐다" };
    }),
  );
  const rows = await runRecordCheck(db, ai, "admin");
  const failed = rows.filter((row) => !row.pass).map((row) => row.check);
  expect(failed).toContain("장면 하나만 정리한다");
  expect(failed).toContain("대화에 없던 숫자");
});

test("AI 호출이 실패하면 그 예시는 실패 한 줄로 남는다", async () => {
  const ai = createFakeAi(Array.from({ length: CALLS }, () => ({ fail: "unavailable" })));
  const rows = await runRecordCheck(db, ai, "admin");
  expect(rows).toHaveLength(CALLS);
  expect(rows.every((row) => !row.pass && row.check === "AI 호출")).toBe(true);
});

test("옮기기 예시: 재직 기록을 장면 하나로만 나누거나 숫자를 지어내면 그 줄이 실패한다", async () => {
  const answer = moveAnswer();
  answer.jobs[0].scenes = [sceneOf({ title: "구매 업무", actions: "협력사 납품 일정을 매주 표로 정리해 생산팀과 맞췄다" })];
  answer.jobs[0].department = "구매 3팀";
  const rows = await runRecordCheck(db, answering(importAnswer(), answer), "admin");
  const failed = rows.filter((row) => !row.pass);
  expect(failed.map((row) => row.sample)).toEqual([MOVE_SPLIT_SAMPLE.name, MOVE_SPLIT_SAMPLE.name]);
  expect(failed.map((row) => row.check).sort()).toEqual(["원본에 없던 숫자를 넣지 않는다", "장면을 둘 이상으로 나눈다"].sort());
});

test("옮기기 예시: 소속 짝이 틀리면 그 줄이 실패한다", async () => {
  // 졸업 작품을 회사에 잇는다(기간 밖이라 버려진다)
  const wrong = (text: string) => ({
    links: [
      { project: aliasOf(text, "물류 대시보드"), parent: aliasOf(text, "나라물산") },
      { project: aliasOf(text, "졸업 작품"), parent: aliasOf(text, "나라물산") },
    ],
  });
  const ai = answering(importAnswer(), moveAnswer(), wrong);
  const rows = await runRecordCheck(db, ai, "admin");
  const failed = rows.filter((row) => !row.pass);
  expect(failed).toHaveLength(1);
  expect(failed[0]).toMatchObject({ sample: AFFILIATE_SAMPLE.name, check: "학교에서 한 프로젝트를 학교에 잇는다" });
  const affiliate = ai.requests.find((r) => r.messages[0].text.startsWith("[옮기기: 소속]"));
  expect(affiliate?.messages[0].text).toContain("P2");
});
