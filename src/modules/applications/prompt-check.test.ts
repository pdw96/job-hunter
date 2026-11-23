import { beforeEach, expect, test } from "vitest";
import { createTestDb } from "@/db/test-db";
import type { Db } from "@/db/types";
import { createFakeAi } from "@/modules/ai/fake-client";
import { user } from "@/modules/auth/schema";
import { runApplicationCheck } from "./prompt-check";

let db: Db;

const select = {
  picks: [{ exp: "E1", overlap: "Kotlin API 개발 경험이 공고의 Java·Kotlin 요건과 겹친다", role: "주문 조회 API의 쿼리를 고쳤다" }],
  passed: [{ exp: "E2", whyNot: "백엔드 직무와 거리가 멀다" }],
  kinds: ["experience", "motive"],
  topics: ["motive"],
};
const write = {
  paragraphs: [
    { text: "주문 조회가 느리다는 문의를 보고 Kotlin으로 API 쿼리를 분석해 고쳤습니다. 응답 시간을 1.2초에서 0.4초로 줄였습니다.", sources: ["E1"] },
    { text: "이 경험으로 병목을 찾아 고치는 방법을 익혔고, 귀사의 주문·결제 API 운영에 보태고 싶습니다.", sources: ["E1"] },
  ],
  shortage: "",
};

const ask = {
  items: [
    {
      topic: "motive",
      link: "공고의 주문·결제 서비스 API 개발 ↔ 교육 Kotlin 백엔드 개발 과정",
      question: "Kotlin 교육이 이 직무를 고른 이유와 이어지나요?",
      options: ["교육에서 만든 주문 API를 실무로 키우고 싶다", "Java·Kotlin을 계속 쓰고 싶다", "교육과는 이어지지 않는다"],
    },
    {
      topic: "motive",
      link: "",
      question: "공고에서 가장 끌린 점은 무엇인가요?",
      options: ["대용량 트래픽을 다뤄 보고 싶다", "많은 사람이 매일 쓰는 주문·결제 서비스라서", "아직 잘 모르겠다"],
    },
  ],
};

const answering = (selectAnswer: unknown = select, writeAnswer: unknown = write, askAnswer: unknown = ask) =>
  createFakeAi(
    Array.from({ length: 3 }, () => (request: { purpose: string }) =>
      request.purpose === "application_select" ? selectAnswer : request.purpose === "application_ask" ? askAnswer : writeAnswer,
    ),
  );
const ASK_ROWS = 6;

beforeEach(async () => {
  delete process.env.AI_MONTHLY_LIMIT_USD;
  db = await createTestDb();
  await db.insert(user).values({ id: "admin", name: "A", email: "a@example.com" });
});

test("맞는 답이면 모든 줄이 통과한다", async () => {
  const ai = answering();
  const rows = await runApplicationCheck(db, ai, "admin");
  expect(rows).toHaveLength(12 + ASK_ROWS);
  expect(rows.filter((row) => !row.pass)).toEqual([]);
  expect(ai.requests).toHaveLength(3);
});

test("쓰기에는 ①의 내용만 보내고 ②와 내부 id는 보내지 않는다", async () => {
  const ai = answering();
  await runApplicationCheck(db, ai, "admin");
  const writeRequest = ai.requests.find((r) => r.purpose === "application_write");
  const text = writeRequest?.messages[0].text ?? "";
  expect(text).toContain("주문 조회 API 개선");
  expect(text).not.toContain("바리스타");
  expect(text).not.toContain("sample-app");
});

test("금지 표현 '주도'를 쓴 답이면 그 줄만 실패한다", async () => {
  const bad = { ...write, paragraphs: [{ text: "주문 조회 개선을 주도했습니다. 응답 시간을 1.2초에서 0.4초로 줄였습니다.", sources: ["E1"] }] };
  const rows = await runApplicationCheck(db, answering(select, bad), "admin");
  expect(rows.filter((row) => !row.pass).map((row) => row.check)).toEqual(["쓰면 안 되는 표현이 없다"]);
});

test("②를 고른 답이면 그 줄만 실패한다", async () => {
  const bad = { ...select, picks: [...select.picks, { exp: "E2", overlap: "카페 경험", role: "음료를 만들었다" }], passed: [] };
  const rows = await runApplicationCheck(db, answering(bad), "admin");
  expect(rows.filter((row) => !row.pass).map((row) => row.check)).toEqual(["②를 고르지 않는다"]);
});

test("지어낸 숫자·②의 내용·인프라 설계를 쓰면 각 줄이 실패한다", async () => {
  const bad = {
    ...write,
    paragraphs: [{ text: "카페 바리스타 경험으로 인프라 설계를 맡아 응답 시간을 90% 줄였습니다.", sources: ["E1"] }],
  };
  const rows = await runApplicationCheck(db, answering(select, bad), "admin");
  expect(rows.filter((row) => !row.pass).map((row) => row.check)).toEqual([
    "기록에 없는 숫자가 없다",
    "②의 내용(바리스타·카페)을 쓰지 않는다",
    "인프라 설계를 했다고 쓰지 않는다",
  ]);
});

test("500자를 넘으면 글자 수 줄이 실패한다", async () => {
  const bad = { ...write, paragraphs: [{ text: "가".repeat(501), sources: ["E1"] }] };
  const rows = await runApplicationCheck(db, answering(select, bad), "admin");
  expect(rows.filter((row) => !row.pass).map((row) => row.check)).toEqual(["500자(공백 포함)를 넘지 않는다"]);
});

test("근거 없는 문단이 있으면 그 줄이 실패한다", async () => {
  const bad = { ...write, paragraphs: [{ text: "열심히 하겠습니다.", sources: [] }] };
  const rows = await runApplicationCheck(db, answering(select, bad), "admin");
  expect(rows.filter((row) => !row.pass).map((row) => row.check)).toEqual(["모든 문단에 근거가 있다"]);
});

test("고르기 호출이 실패하면 고르기 5줄만 실패로 나온다", async () => {
  const rows = await runApplicationCheck(db, answering({ fail: "invalid" }), "admin");
  expect(rows).toHaveLength(12 + ASK_ROWS);
  expect(rows.filter((row) => !row.pass)).toHaveLength(5);
  expect(rows.filter((row) => !row.pass).every((row) => row.actual === "실패: invalid")).toBe(true);
});

test("쓰기 호출이 실패하면 쓰기 6줄만 실패로 나오고 고르기 줄은 그대로다", async () => {
  const rows = await runApplicationCheck(db, answering(select, { fail: "refused" }), "admin");
  expect(rows).toHaveLength(12 + ASK_ROWS);
  const bad = rows.filter((row) => !row.pass);
  expect(bad).toHaveLength(6);
  expect(bad.every((row) => row.actual === "실패: refused")).toBe(true);
  expect(rows.slice(0, 3).every((row) => row.pass)).toBe(true);
});

test("추천 근거에 지어낸 숫자가 있어 비워지면 그 줄만 실패한다", async () => {
  const bad = { ...select, picks: [{ ...select.picks[0], overlap: "응답 시간을 90% 줄인 경험이 공고와 겹친다" }] };
  const rows = await runApplicationCheck(db, answering(bad), "admin");
  const failedRows = rows.filter((row) => !row.pass);
  expect(failedRows.map((row) => row.check)).toEqual(["추천 근거가 비지 않는다(기록에 없는 숫자나 빈 답으로 지워지지 않음)"]);
  expect(failedRows[0].actual).toBe("비워짐: 주문 조회 API 개선 overlap");
});

test("①을 못 골랐으면 AI가 고른 것과 밀어낸 것을 보여 준다", async () => {
  const bad = {
    ...select,
    picks: [{ exp: "E2", overlap: "카페 경험", role: "음료를 만들었다" }],
    passed: [{ exp: "E1", whyNot: "직무와 덜 맞는다" }],
  };
  const rows = await runApplicationCheck(db, answering(bad), "admin");
  const row = rows.find((r) => r.check === "①을 고른다");
  expect(row?.pass).toBe(false);
  expect(row?.actual).toBe("고르지 않음 · 고른 것: 카페 바리스타 아르바이트 · 밀린 것: 주문 조회 API 개선(직무와 덜 맞는다)");
});

test("아무것도 고르지 않았으면 고른 것·밀린 것이 없음으로 나온다", async () => {
  const rows = await runApplicationCheck(db, answering({ ...select, picks: [], passed: [] }), "admin");
  expect(rows.find((r) => r.check === "①을 고른다")?.actual).toBe("고르지 않음 · 고른 것: 없음 · 밀린 것: 없음");
});

test("AI가 보낸 원래 답을 진단용 줄로 보이고, 늘 통과한다", async () => {
  const rows = await runApplicationCheck(db, answering(), "admin");
  const diag = rows.find((r) => r.check === "AI가 보낸 답(진단용)");
  expect(diag?.pass).toBe(true);
  expect(diag?.actual).toContain(JSON.stringify(select).slice(0, 80));
});

test("AI가 모르는 별명만 골랐으면 그 별명을 보여 준다", async () => {
  const rows = await runApplicationCheck(db, answering({ ...select, picks: [{ exp: "X9", overlap: "a", role: "b" }], passed: [] }), "admin");
  expect(rows.find((r) => r.check === "①을 고른다")?.actual).toContain("AI가 고른 별명: X9");
  expect(rows.find((r) => r.check === "AI가 보낸 답(진단용)")?.actual).toContain("X9");
});

test("고르기 호출이 실패하면 진단용 줄은 AI 호출 실패로 나온다", async () => {
  const rows = await runApplicationCheck(db, answering({ fail: "invalid" }), "admin");
  expect(rows.find((r) => r.check === "AI가 보낸 답(진단용)")?.actual).toBe("AI 호출 실패");
});

test("유형을 경험형·동기포부형으로 보지 않거나 주제에 지원동기가 없으면 그 줄이 실패한다", async () => {
  const bad = { ...select, kinds: ["experience"], topics: [] };
  const rows = await runApplicationCheck(db, answering(bad), "admin");
  expect(rows.filter((row) => !row.pass).map((row) => row.check)).toEqual([
    "지원 동기와 직무 역량 문항을 경험형과 동기포부형으로 본다",
    "주제에 지원동기가 있다",
  ]);
});

// 묻기

test("묻기에는 확인된 교육과 바리스타 사례를 [내 기록]으로 보낸다", async () => {
  const ai = answering();
  await runApplicationCheck(db, ai, "admin");
  const text = ai.requests.find((r) => r.purpose === "application_ask")?.messages[0].text ?? "";
  expect(text).toContain("[내 기록]");
  expect(text).toContain("Kotlin 백엔드 개발 과정");
  expect(text).toContain("카페 바리스타 아르바이트");
  expect(text).toContain("지원 동기를 적어 주세요");
});

test("질문이 하나뿐이고 선택지가 둘이면 그 두 줄이 실패한다", async () => {
  const bad = { items: [{ ...ask.items[0], options: ask.items[0].options.slice(0, 2) }] };
  const rows = await runApplicationCheck(db, answering(select, write, bad), "admin");
  expect(rows.filter((row) => !row.pass).map((row) => row.check)).toEqual(["질문 2~3개", "질문마다 선택지 3~5개"]);
});

test("지원동기가 아닌 주제가 있으면 그 줄이 실패한다", async () => {
  const bad = { items: [ask.items[0], { ...ask.items[1], topic: "aspiration" }] };
  const rows = await runApplicationCheck(db, answering(select, write, bad), "admin");
  expect(rows.filter((row) => !row.pass).map((row) => row.check)).toEqual(["주제가 모두 지원동기"]);
});

test("연결고리에 Kotlin이 없고 바리스타를 쓰면 두 줄이 실패한다", async () => {
  const bad = { items: [{ ...ask.items[0], link: "카페 바리스타 아르바이트 ↔ 고객 응대" }, ask.items[1]] };
  const rows = await runApplicationCheck(db, answering(select, write, bad), "admin");
  expect(rows.filter((row) => !row.pass).map((row) => row.check)).toEqual(["연결고리에 Kotlin 교육이 나온다", "바리스타를 연결고리로 쓰지 않는다"]);
});

test("선택지에 공고·기록에 없는 숫자가 있으면 그 줄이 실패한다", async () => {
  const bad = { items: [ask.items[0], { ...ask.items[1], options: [...ask.items[1].options.slice(0, 2), "매출 300억 회사라서"] }] };
  const rows = await runApplicationCheck(db, answering(select, write, bad), "admin");
  const failedRows = rows.filter((row) => !row.pass);
  expect(failedRows.map((row) => row.check)).toEqual(["선택지에 공고·기록에 없는 숫자가 없다"]);
  expect(failedRows[0].actual).toContain("300");
});

test("묻기 호출이 실패하면 묻기 6줄만 실패로 나온다", async () => {
  const rows = await runApplicationCheck(db, answering(select, write, { fail: "invalid" }), "admin");
  const bad = rows.filter((row) => !row.pass);
  expect(bad).toHaveLength(ASK_ROWS);
  expect(bad.every((row) => row.actual === "실패: invalid")).toBe(true);
});
