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

// 판정 요청에는 판정 답을, 정리 요청에는 초안을 준다(요청 순서가 정해져 있지 않다)
const answering = (judgement: unknown, extraction: unknown) =>
  createFakeAi(
    Array.from({ length: JUDGE_SAMPLES.length + EXTRACT_SAMPLES.length }, () => (request: { purpose: string }) =>
      request.purpose === "judge" ? judgement : extraction,
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
  expect(await db.select().from(aiUsage)).toHaveLength(JUDGE_SAMPLES.length + EXTRACT_SAMPLES.length);
});
