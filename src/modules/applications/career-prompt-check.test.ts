import { beforeEach, expect, test } from "vitest";
import { createTestDb } from "@/db/test-db";
import type { Db } from "@/db/types";
import { createFakeAi } from "@/modules/ai/fake-client";
import { user } from "@/modules/auth/schema";
import { runCareerCheck } from "./career-prompt-check";

let db: Db;

const good = {
  items: [
    { exp: "E1", done: ["주문 API의 쿼리를 분석해 고치고 인덱스를 추가했다"], results: ["응답 시간을 1.2초에서 0.4초로 줄였다"] },
    { exp: "E2", done: ["Kotlin과 Spring으로 정산 내역 조회 화면을 만들었다"], results: ["담당자가 화면에서 바로 확인하게 되었다"] },
  ],
};
const answering = (answer: unknown = good) => createFakeAi([() => answer]);
const withItems = (items: unknown[]) => ({ items });
const failedChecks = (rows: { pass: boolean; check: string }[]) => rows.filter((r) => !r.pass).map((r) => r.check);

beforeEach(async () => {
  delete process.env.AI_MONTHLY_LIMIT_USD;
  db = await createTestDb();
  await db.insert(user).values({ id: "admin", name: "A", email: "a@example.com" });
});

test("좋은 답이면 모든 줄이 통과한다", async () => {
  const ai = answering();
  const rows = await runCareerCheck(db, ai, "admin");
  expect(rows).toHaveLength(7);
  expect(failedChecks(rows)).toEqual([]);
  expect(ai.requests).toHaveLength(1);
});

test("항목에는 내부 id 대신 별명을 보낸다", async () => {
  const ai = answering();
  await runCareerCheck(db, ai, "admin");
  const text = ai.requests[0].messages[0].text;
  expect(text).toContain("주문 API 응답 시간 개선");
  expect(text).toContain("사내 정산 시스템");
  expect(text).not.toContain("sample-career");
});

test("②의 성과에 숫자가 있으면 그 줄만 실패한다", async () => {
  const bad = withItems([good.items[0], { exp: "E2", done: good.items[1].done, results: ["정산 시간을 30% 줄였다"] }]);
  const rows = await runCareerCheck(db, answering(bad), "admin");
  expect(failedChecks(rows)).toEqual(["②의 성과에 숫자가 없다"]);
});

test("①에 지어낸 숫자·'주도'·인프라 설계가 있으면 각 줄이 실패한다", async () => {
  const bad = withItems([{ exp: "E1", done: ["인프라 설계를 주도했다"], results: ["응답 시간을 90% 줄였다"] }, good.items[1]]);
  const rows = await runCareerCheck(db, answering(bad), "admin");
  expect(failedChecks(rows)).toEqual([
    "①의 성과에 1.2초·0.4초 말고 다른 숫자가 없다",
    "쓰면 안 되는 표현(주도)이 없다",
    "인프라 설계를 했다고 쓰지 않는다",
  ]);
});

test("①의 한 일이 비면 그 줄만 실패한다", async () => {
  const bad = withItems([{ exp: "E1", done: [], results: good.items[0].results }, good.items[1]]);
  expect(failedChecks(await runCareerCheck(db, answering(bad), "admin"))).toEqual(["①의 한 일이 비지 않는다"]);
});

test("②의 줄에 응답 시간이 섞이면 그 줄만 실패한다", async () => {
  const bad = withItems([good.items[0], { exp: "E2", done: ["응답 시간을 줄이는 화면을 만들었다"], results: [] }]);
  expect(failedChecks(await runCareerCheck(db, answering(bad), "admin"))).toEqual(["②의 줄에 ①의 내용(응답 시간)이 섞이지 않는다"]);
});

test("AI 호출이 실패하면 점검 줄마다 '실패: (사유)'로 나오고 진단 줄은 통과한다", async () => {
  const rows = await runCareerCheck(db, answering({ fail: "refused" }), "admin");
  expect(rows).toHaveLength(7);
  const bad = rows.filter((r) => !r.pass);
  expect(bad).toHaveLength(6);
  expect(bad.every((r) => r.actual === "실패: refused")).toBe(true);
  expect(rows.find((r) => r.check === "AI가 보낸 답(진단용)")?.actual).toBe("AI 호출 실패");
});

test("AI가 보낸 원래 답을 진단용 줄로 보이고, 늘 통과한다", async () => {
  const rows = await runCareerCheck(db, answering(), "admin");
  const diag = rows.find((r) => r.check === "AI가 보낸 답(진단용)");
  expect(diag?.pass).toBe(true);
  expect(diag?.actual).toContain(JSON.stringify(good).slice(0, 40));
});
