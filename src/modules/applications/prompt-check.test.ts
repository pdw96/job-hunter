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
};
const write = {
  paragraphs: [
    { text: "주문 조회가 느리다는 문의를 보고 Kotlin으로 API 쿼리를 분석해 고쳤습니다. 응답 시간을 1.2초에서 0.4초로 줄였습니다.", sources: ["E1"] },
    { text: "이 경험으로 병목을 찾아 고치는 방법을 익혔고, 귀사의 주문·결제 API 운영에 보태고 싶습니다.", sources: ["E1"] },
  ],
  shortage: "",
};

const answering = (selectAnswer: unknown = select, writeAnswer: unknown = write) =>
  createFakeAi(
    Array.from({ length: 2 }, () => (request: { purpose: string }) => (request.purpose === "application_select" ? selectAnswer : writeAnswer)),
  );

beforeEach(async () => {
  delete process.env.AI_MONTHLY_LIMIT_USD;
  db = await createTestDb();
  await db.insert(user).values({ id: "admin", name: "A", email: "a@example.com" });
});

test("맞는 답이면 모든 줄이 통과한다", async () => {
  const ai = answering();
  const rows = await runApplicationCheck(db, ai, "admin");
  expect(rows).toHaveLength(9);
  expect(rows.filter((row) => !row.pass)).toEqual([]);
  expect(ai.requests).toHaveLength(2);
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
  const bad = { picks: [...select.picks, { exp: "E2", overlap: "카페 경험", role: "음료를 만들었다" }], passed: [] };
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

test("고르기 호출이 실패하면 고르기 3줄만 실패로 나온다", async () => {
  const rows = await runApplicationCheck(db, answering({ fail: "invalid" }), "admin");
  expect(rows).toHaveLength(9);
  expect(rows.filter((row) => !row.pass)).toHaveLength(3);
  expect(rows.filter((row) => !row.pass).every((row) => row.actual === "실패: invalid")).toBe(true);
});

test("쓰기 호출이 실패하면 쓰기 6줄만 실패로 나오고 고르기 줄은 그대로다", async () => {
  const rows = await runApplicationCheck(db, answering(select, { fail: "refused" }), "admin");
  expect(rows).toHaveLength(9);
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
