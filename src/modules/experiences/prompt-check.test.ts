import { beforeEach, expect, test } from "vitest";
import { createTestDb } from "@/db/test-db";
import type { Db } from "@/db/types";
import { createFakeAi } from "@/modules/ai/fake-client";
import { aiUsage } from "@/modules/ai/schema";
import { user } from "@/modules/auth/schema";
import { EXTRACT_SAMPLES, JUDGE_SAMPLES, runPromptCheck } from "./prompt-check";

let db: Db;
const met = { status: "met", note: "" };
const allMet = { role: met, level: met, metrics: met, evidence: met, phraseCandidates: ["설계부터 구현까지"] };
const draft = {
  name: "기록",
  kind: "project",
  organization: "",
  role: "",
  startMonth: "2024-02",
  endMonth: "2024-04",
  isOngoing: false,
  situation: "",
  actions: "문서 목록을 만들었다",
  result: "",
  metrics: [],
  notDone: "삭제 결정은 팀장이 했다",
  evidenceNote: "",
  tags: [],
};

beforeEach(async () => {
  delete process.env.AI_MONTHLY_LIMIT_USD;
  db = await createTestDb();
  await db.insert(user).values({ id: "admin", name: "A", email: "a@example.com" });
});

const CALLS = JUDGE_SAMPLES.length + EXTRACT_SAMPLES.length + 2; // +2는 가져오기 예시 둘

// 가져오기 예시를 원본 그대로 세 건으로 나눈 답
const imported = {
  records: [
    {
      ...draft,
      bannedPhrases: [],
      name: "가나다커머스 마케팅팀",
      kind: "job",
      startMonth: "2022-03",
      endMonth: "2024-02",
      actions:
        "신규 고객 유입 캠페인을 주도하여 매출 30% 향상에 기여\n데이터 기반 의사결정 문화를 정착시키며 핵심 역할을 수행\nSNS 채널 운영을 총괄하고 팔로워를 2만 명까지 성장시킴",
      notDone: "",
      roleClaims: ["핵심 역할을 수행"],
    },
    {
      ...draft,
      bannedPhrases: [],
      name: "브랜드 리뉴얼 프로젝트",
      startMonth: "2023-06",
      endMonth: "2023-09",
      actions: "리뉴얼 TF에 참여하여 고객 설문을 설계하고 결과를 정리\n성공적인 리뉴얼 론칭을 이끌며 브랜드 인지도 제고에 크게 기여",
      notDone: "",
      roleClaims: [],
    },
    { ...draft, bannedPhrases: [], name: "한국대학교 경영학과", kind: "school", startMonth: "2016-03", endMonth: "2022-02", actions: "", notDone: "", roleClaims: [] },
  ],
  more: false,
};

// 판정 요청에는 판정 답을, 정리 요청에는 초안을, 가져오기 요청에는 나눈 기록을 준다(요청 순서가 정해져 있지 않다)
const answering = (judgement: unknown, extraction: unknown, importing: unknown = imported) =>
  createFakeAi(
    Array.from({ length: CALLS }, () => (request: { purpose: string }) =>
      request.purpose === "judge" ? judgement : request.purpose === "import" ? importing : extraction,
    ),
  );

test("예시마다 기대와 실제를 비교해 통과 여부를 낸다", async () => {
  const rows = await runPromptCheck(db, answering(allMet, draft), "admin");
  // 모두 충족이라고 답했으므로, 미달을 기대한 줄은 실패여야 한다
  const roleVague = rows.find((r) => r.sample === "본인 역할이 흐린 기록" && r.check === "본인 역할");
  expect(roleVague).toMatchObject({ expected: "미달", actual: "충족", pass: false });
  const good = rows.filter((r) => r.sample === "구체적인 기록");
  expect(good.every((r) => r.pass)).toBe(true);
  // 수치를 말한 대화인데 초안에 40이 없으므로 실패
  expect(rows.find((r) => r.check === "말한 수치를 적는다")).toMatchObject({ pass: false });
  expect(rows.find((r) => r.sample === "수치·증빙을 말하지 않은 대화" && r.check === "수치를 만들지 않는다")?.pass).toBe(true);
});

test("초안이 내용을 키우거나 없는 숫자를 넣으면 잡아낸다", async () => {
  const inflated = { ...draft, actions: "위키 정리를 주도했다", result: "문서 80%를 정리했다", evidenceNote: "보고서" };
  const rows = (await runPromptCheck(db, answering(allMet, inflated), "admin")).filter(
    (r) => r.sample === "수치·증빙을 말하지 않은 대화",
  );
  expect(rows.find((r) => r.check === "참여를 주도로 키우지 않는다")).toMatchObject({ actual: "주도", pass: false });
  expect(rows.find((r) => r.check === "증빙을 만들지 않는다")?.pass).toBe(false);
  expect(rows.find((r) => r.check === "대화에 없던 숫자")).toMatchObject({ pass: false });
});

test("AI 호출이 실패한 예시는 실패 줄로 나오고, 쓴 만큼 사용량이 기록된다", async () => {
  const rows = await runPromptCheck(db, answering({ fail: "refused" }, draft), "admin");
  expect(rows.filter((r) => r.check === "AI 호출")).toHaveLength(JUDGE_SAMPLES.length);
  expect(await db.select().from(aiUsage)).toHaveLength(CALLS);
});

test("가져오기 예시: 원본 그대로 세 건으로 나누면 모두 통과한다", async () => {
  const rows = (await runPromptCheck(db, answering(allMet, draft), "admin")).filter((r) => r.sample === "부풀려진 이력서 가져오기");
  expect(rows).toHaveLength(7);
  expect(rows.filter((r) => !r.pass)).toEqual([]);
});

test("가져오기 예시: 내용을 키우거나 없는 숫자·칸을 채우면 잡아낸다", async () => {
  const inflated = {
    ...imported,
    records: [
      {
        ...imported.records[0],
        actions: "신규 고객 유입 캠페인을 주도하여 매출을 45% 끌어올림\nSNS 채널 운영을 총괄하고 팔로워를 2만 명까지 성장시킴",
        evidenceNote: "성과 보고서",
        roleClaims: [],
      },
      { ...imported.records[1], actions: "리뉴얼 TF를 주도하여 론칭을 이끎" },
    ],
  };
  const rows = (await runPromptCheck(db, answering(allMet, draft, inflated), "admin")).filter(
    (r) => r.sample === "부풀려진 이력서 가져오기",
  );
  const failed = rows.filter((r) => !r.pass).map((r) => r.check);
  expect(failed).toEqual([
    "경험 단위로 나눈다",
    "원본에 없던 숫자를 넣지 않는다",
    "원본의 표현을 그대로 둔다",
    "더 키우지 않는다",
    "원본에 없는 칸을 채우지 않는다",
    "코드가 숫자와 과장 낱말을 주장으로 잡는다",
    "AI가 부풀린 표현을 더 짚는다",
  ]);
});

// 노션 묶음 요청에만 다른 답을 준다
const notionAnswering = (notion: unknown) =>
  createFakeAi(
    Array.from({ length: CALLS }, () => (request: { purpose: string; messages: { text: string }[] }) =>
      request.purpose === "judge"
        ? allMet
        : request.purpose !== "import"
          ? draft
          : request.messages[0].text.includes("[하위 페이지]")
            ? notion
            : imported,
    ),
  );

const notionRecord = {
  ...draft,
  name: "생산관리 전담",
  kind: "job",
  organization: "가나다화학",
  startMonth: "2023-04",
  endMonth: "2024-10",
  situation: "",
  actions: "6~15개 품목의 생산계획과 자재 수급을 담당\n원인 가설을 세우고 분석 시험을 의뢰",
  result: "납기 지연 0건 (전 기간, 고객 요청일 기준)",
  metrics: [],
  notDone: "로트 이력 역추적은 품질팀이 주도",
  evidenceNote: "재직증명서로 기간 확인",
  roleClaims: [],
  bannedPhrases: ["전 품목", "ERP 구축 주도"],
};

test("노션 묶음 예시: 금지 표현을 옮기고 제외한 수치와 남이 한 일을 넣지 않으면 모두 통과한다", async () => {
  const rows = (await runPromptCheck(db, notionAnswering({ records: [notionRecord], more: false }), "admin")).filter(
    (r) => r.sample === "노션 묶음 가져오기",
  );
  expect(rows).toHaveLength(6);
  expect(rows.filter((r) => !r.pass)).toEqual([]);
});

test("노션 묶음 예시: 제외한 수치를 넣거나 금지 표현을 빠뜨리면 잡아낸다", async () => {
  const wrong = {
    ...notionRecord,
    actions: "로트 이력 역추적을 주도",
    result: "공정 지연 20% 감소",
    evidenceNote: "",
    bannedPhrases: [],
  };
  const rows = (await runPromptCheck(db, notionAnswering({ records: [wrong, notionRecord], more: false }), "admin")).filter(
    (r) => r.sample === "노션 묶음 가져오기",
  );
  expect(rows.filter((r) => !r.pass).map((r) => r.check)).toEqual([
    "쓰지 말라는 수치를 넣지 않는다",
    "남이 한 일을 본인이 한 일로 적지 않는다",
  ]);
});
