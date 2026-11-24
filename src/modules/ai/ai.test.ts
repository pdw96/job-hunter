import { eq } from "drizzle-orm";
import { beforeEach, expect, test } from "vitest";
import { z } from "zod";
import { createTestDb } from "@/db/test-db";
import type { Db } from "@/db/types";
import { user } from "@/modules/auth/schema";
import { type AiRequest, runAi } from "./client";
import { createFakeAi, FAKE_USAGE } from "./fake-client";
import { costMicroUsd, WEB_SEARCH_MICRO_USD } from "./pricing";
import { redactContacts } from "./redact";
import { aiUsage } from "./schema";
import { checkBudget, monthlyCostMicroUsd, monthlyLimitMicroUsd, monthStart, recordUsage } from "./usage";

const M = 1_000_000;
const usage = (over: Partial<typeof FAKE_USAGE>) => ({
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  ...over,
});

test("Sonnet 5.5로 입력 100만·출력 100만 토큰이면 12달러다", () => {
  expect(costMicroUsd("claude-sonnet-5-5", usage({ inputTokens: M, outputTokens: M }))).toBe(12 * M);
});

test("캐시 읽기와 쓰기는 따로 계산된다", () => {
  expect(costMicroUsd("claude-sonnet-5-5", usage({ cacheReadTokens: M }))).toBe(0.1 * M);
  expect(costMicroUsd("claude-sonnet-5-5", usage({ cacheWriteTokens: M }))).toBe(2.5 * M);
});

test("표에 없는 모델은 가장 비싼 값으로 계산한다", () => {
  expect(costMicroUsd("claude-unknown-9", usage({ inputTokens: M, outputTokens: M }))).toBe(24 * M);
});

test("검색 3번이면 토큰 값에 3만 마이크로달러를 더한다", () => {
  expect(WEB_SEARCH_MICRO_USD).toBe(10_000);
  expect(costMicroUsd("claude-sonnet-5-5", usage({ inputTokens: M, webSearchRequests: 3 }))).toBe(2 * M + 30_000);
});

test("검색 횟수가 없으면 0으로 센다", () => {
  expect(costMicroUsd("claude-sonnet-5-5", usage({ inputTokens: M }))).toBe(2 * M);
  expect(costMicroUsd("claude-sonnet-5-5", usage({ inputTokens: M, webSearchRequests: 0 }))).toBe(2 * M);
});

test("전화번호·이메일·주민등록번호 형태를 가린다", () => {
  expect(redactContacts("연락처는 010-1234-5678입니다")).toBe("연락처는 [전화번호]입니다");
  expect(redactContacts("01012345678")).toBe("[전화번호]");
  expect(redactContacts("회사 02-123-4567, 해외 +82 10-1234-5678")).toBe("회사 [전화번호], 해외 [전화번호]");
  expect(redactContacts("메일 a.b@example.co.kr 로")).toBe("메일 [이메일] 로");
  expect(redactContacts("주민번호 900101-1234567")).toBe("주민번호 [주민등록번호]");
});

test("기간·건수·금액 같은 다른 숫자는 가리지 않는다", () => {
  const text = "2023년 3월부터 2023-11까지, 월 장애 5건에서 1건, 매출 4,000만원, 처리량 12000건, 30% 단축";
  expect(redactContacts(text)).toBe(text);
});

test("한 달의 시작은 한국 시간 기준이다", () => {
  // 한국 시간 11월 1일 08:00 = UTC 10월 31일 23:00
  expect(monthStart(new Date("2026-10-31T23:00:00Z")).toISOString()).toBe("2026-10-31T15:00:00.000Z");
  expect(monthStart(new Date("2026-11-17T03:00:00Z")).toISOString()).toBe("2026-10-31T15:00:00.000Z");
});

let db: Db;
const now = new Date("2026-11-17T03:00:00Z");
const schema = z.object({ answer: z.string() });
const request: AiRequest<{ answer: string }> = {
  purpose: "judge",
  system: "시스템",
  messages: [
    { role: "user", text: "제 번호는 010-1234-5678이고 메일은 me@example.com입니다" },
    { role: "assistant", text: "네" },
  ],
  schema,
  effort: "low",
  maxTokens: 1000,
};

beforeEach(async () => {
  delete process.env.AI_MONTHLY_LIMIT_USD;
  db = await createTestDb();
  await db.insert(user).values([
    { id: "u1", name: "A", email: "u1@example.com" },
    { id: "u2", name: "B", email: "u2@example.com" },
  ]);
});

test("월 한도의 기본값은 5달러이고 환경 변수로 바꿀 수 있다", () => {
  expect(monthlyLimitMicroUsd()).toBe(5 * M);
  process.env.AI_MONTHLY_LIMIT_USD = "0.5";
  expect(monthlyLimitMicroUsd()).toBe(0.5 * M);
  process.env.AI_MONTHLY_LIMIT_USD = "엉터리";
  expect(monthlyLimitMicroUsd()).toBe(5 * M);
});

test("이번 달 사용량은 본인 것만, 이번 달 것만 센다", async () => {
  const entry = { purpose: "judge", model: "claude-sonnet-5-5", usage: usage({ outputTokens: 100_000 }) }; // 1달러
  await recordUsage(db, "u1", { ...entry, at: now });
  await recordUsage(db, "u1", { ...entry, at: new Date("2026-10-20T00:00:00Z") }); // 지난달
  await recordUsage(db, "u2", { ...entry, at: now }); // 다른 사용자
  expect(await monthlyCostMicroUsd(db, "u1", now)).toBe(1 * M);
});

test("한도에 닿으면 over_limit이고 AI를 부르지 않는다", async () => {
  process.env.AI_MONTHLY_LIMIT_USD = "1";
  await recordUsage(db, "u1", { purpose: "judge", model: "claude-sonnet-5-5", usage: usage({ outputTokens: 100_000 }), at: now });
  expect(await checkBudget(db, "u1", now)).toEqual({ ok: false, reason: "over_limit" });

  const ai = createFakeAi([{ answer: "x" }]);
  expect(await runAi(db, ai, "u1", request, now)).toEqual({ ok: false, reason: "over_limit" });
  expect(ai.requests).toHaveLength(0);
  // 다른 사용자는 영향이 없다
  expect(await checkBudget(db, "u2", now)).toEqual({ ok: true });
});

test("AI에게 보내는 사용자 글에서 연락처가 가려지고, 호출 뒤 사용량이 기록된다", async () => {
  const ai = createFakeAi([{ answer: "좋아요" }]);
  const result = await runAi(db, ai, "u1", request, now);
  expect(result).toMatchObject({ ok: true, value: { answer: "좋아요" } });
  expect(ai.requests[0].messages[0].text).toBe("제 번호는 [전화번호]이고 메일은 [이메일]입니다");

  const rows = await db.select().from(aiUsage);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ userId: "u1", purpose: "judge", model: "claude-sonnet-5-5", inputTokens: 1000 });
  expect(rows[0].costMicroUsd).toBe(costMicroUsd("claude-sonnet-5-5", FAKE_USAGE));
});

test("AI가 거절하거나 답이 스키마에 맞지 않아도 쓴 만큼 사용량이 기록된다", async () => {
  const ai = createFakeAi([{ fail: "refused" }, { wrong: 1 }]);
  expect(await runAi(db, ai, "u1", request, now)).toMatchObject({ ok: false, reason: "refused" });
  expect(await runAi(db, ai, "u1", request, now)).toMatchObject({ ok: false, reason: "invalid" });
  expect(await db.select().from(aiUsage)).toHaveLength(2);
});

test("recordUsage가 검색 횟수를 남긴다", async () => {
  const entry = { purpose: "company_research", model: "claude-sonnet-5-5", at: now };
  await recordUsage(db, "u1", { ...entry, usage: usage({ outputTokens: 100, webSearchRequests: 4 }) });
  await recordUsage(db, "u1", { ...entry, usage: usage({ outputTokens: 100 }) }); // 검색 없음
  const rows = await db.select().from(aiUsage).orderBy(aiUsage.webSearchRequests);
  expect(rows.map((row) => row.webSearchRequests)).toEqual([0, 4]);
  expect(rows[1].costMicroUsd).toBe(1_000 + 40_000);
});

test("웹 검색 요청도 runAi가 한도를 먼저 보고 사용량에 검색 요금까지 센다", async () => {
  const webRequest: AiRequest<{ answer: string }> = {
    ...request,
    purpose: "company_research",
    webSearch: { maxUses: 5, allowedDomains: ["example.com"] },
  };
  const sources = [{ url: "https://example.com/a", title: "A", pageAge: null }];

  // 한도에 닿았으면 부르지 않는다
  process.env.AI_MONTHLY_LIMIT_USD = "0";
  const blocked = createFakeAi([{ web: { answer: { answer: "x" }, sources, searches: 2 } }]);
  expect(await runAi(db, blocked, "u1", webRequest, now)).toEqual({ ok: false, reason: "over_limit" });
  expect(blocked.requests).toHaveLength(0);
  delete process.env.AI_MONTHLY_LIMIT_USD;

  const ai = createFakeAi([{ web: { answer: { answer: "회사 소개" }, sources, searches: 2 } }]);
  const result = await runAi(db, ai, "u1", webRequest, now);
  expect(result).toMatchObject({ ok: true, value: { answer: "회사 소개" }, sources });
  expect(ai.requests[0].webSearch).toEqual({ maxUses: 5, allowedDomains: ["example.com"] });

  const [row] = await db.select().from(aiUsage);
  expect(row).toMatchObject({ purpose: "company_research", webSearchRequests: 2 });
  expect(row.costMicroUsd).toBe(costMicroUsd("claude-sonnet-5-5", FAKE_USAGE) + 20_000);
});

test("사용자를 지우면 사용량도 지워진다", async () => {
  await runAi(db, createFakeAi([{ answer: "x" }]), "u1", request, now);
  await db.delete(user).where(eq(user.id, "u1"));
  expect(await db.select().from(aiUsage)).toEqual([]);
});
