import { beforeEach, expect, test } from "vitest";
import { createTestDb } from "@/db/test-db";
import type { Db } from "@/db/types";
import { createFakeAi } from "@/modules/ai/fake-client";
import { user } from "@/modules/auth/schema";
import { runResumeCheck } from "./resume-prompt-check";

let db: Db;

const write = {
  entries: [
    { exp: "E1", lines: ["Kotlin으로 주문 조회 API의 쿼리를 분석해 고쳤다", "응답 시간을 1.2초에서 0.4초로 줄였다"] },
    { exp: "E2", lines: ["주말 손님이 몰리는 동네 카페에서 음료 제조와 마감 정리를 맡았다"] },
    { exp: "E3", lines: [] },
  ],
};
const emphasis = { picks: [{ exp: "E1", why: "Kotlin API 개발 경험이 공고의 Java·Kotlin 요건과 겹친다" }] };

const answering = (writeAnswer: unknown = write, emphasisAnswer: unknown = emphasis) =>
  createFakeAi(
    Array.from({ length: 2 }, () => (request: { purpose: string }) => (request.purpose === "resume_write" ? writeAnswer : emphasisAnswer)),
  );
const failedChecks = (rows: { pass: boolean; check: string }[]) => rows.filter((row) => !row.pass).map((row) => row.check);

beforeEach(async () => {
  delete process.env.AI_MONTHLY_LIMIT_USD;
  db = await createTestDb();
  await db.insert(user).values({ id: "admin", name: "A", email: "a@example.com" });
});

test("맞는 답이면 모든 줄이 통과한다", async () => {
  const ai = answering();
  const rows = await runResumeCheck(db, ai, "admin");
  expect(rows).toHaveLength(8);
  expect(failedChecks(rows)).toEqual([]);
  expect(ai.requests).toHaveLength(2);
});

test("쓰기에는 ①②③을 보내고 내부 id는 보내지 않는다", async () => {
  const ai = answering();
  await runResumeCheck(db, ai, "admin");
  const text = ai.requests.find((r) => r.purpose === "resume_write")?.messages[0].text ?? "";
  expect(text).toContain("주문 조회 API 개선");
  expect(text).toContain("정보처리기사");
  expect(text).not.toContain("sample-resume");
});

test("강조 후보는 사용 경험(①②)만이다", async () => {
  const ai = answering();
  await runResumeCheck(db, ai, "admin");
  const text = ai.requests.find((r) => r.purpose === "resume_emphasis")?.messages[0].text ?? "";
  expect(text).toContain("카페 바리스타");
  expect(text).not.toContain("정보처리기사");
});

test("①에 '주도'를 쓴 답이면 그 줄만 실패한다", async () => {
  const bad = { entries: [{ exp: "E1", lines: ["주문 조회 개선을 주도했다"] }, write.entries[1], write.entries[2]] };
  const rows = await runResumeCheck(db, answering(bad), "admin");
  expect(failedChecks(rows)).toEqual(["①에 쓰면 안 되는 표현이 없다"]);
});

test("②를 강조한 답이면 그 줄만 실패한다", async () => {
  const bad = { picks: [...emphasis.picks, { exp: "E2", why: "고객 응대 경험이 있다" }] };
  const rows = await runResumeCheck(db, answering(write, bad), "admin");
  expect(failedChecks(rows)).toEqual(["②를 강조하지 않는다"]);
});

test("①의 줄이 비면 그 줄만 실패한다", async () => {
  const bad = { entries: [{ exp: "E1", lines: [] }, write.entries[1], write.entries[2]] };
  const rows = await runResumeCheck(db, answering(bad), "admin");
  expect(failedChecks(rows)).toEqual(["①의 줄이 비지 않는다"]);
});

test("지어낸 숫자·인프라 설계·②의 Kotlin이 있으면 각 줄이 실패한다", async () => {
  const bad = {
    entries: [
      { exp: "E1", lines: ["인프라 설계를 맡아 응답 시간을 90% 줄였다"] },
      { exp: "E2", lines: ["Kotlin API로 주문을 받았다"] },
      write.entries[2],
    ],
  };
  const rows = await runResumeCheck(db, answering(bad), "admin");
  expect(failedChecks(rows)).toEqual([
    "기록에 없는 숫자가 없다",
    "인프라 설계를 했다고 쓰지 않는다",
    "②의 줄에 ①의 내용(Kotlin, API)이 섞이지 않는다",
  ]);
});

test("③에 지어낸 숫자가 있어도 숫자 줄이 실패한다", async () => {
  const bad = { entries: [write.entries[0], write.entries[1], { exp: "E3", lines: ["상위 5%로 합격했다"] }] };
  const rows = await runResumeCheck(db, answering(bad), "admin");
  expect(failedChecks(rows)).toEqual(["기록에 없는 숫자가 없다"]);
});

test("강조의 이유가 비면 그 줄만 실패한다", async () => {
  const bad = { picks: [{ exp: "E1", why: "응답 시간을 90% 줄인 경험이 공고와 겹친다" }] };
  const rows = await runResumeCheck(db, answering(write, bad), "admin");
  expect(failedChecks(rows)).toEqual(["①의 이유가 비지 않는다"]);
});

test("쓰기 호출이 실패하면 쓰기 5줄만 실패로 나온다", async () => {
  const rows = await runResumeCheck(db, answering({ fail: "refused" }), "admin");
  expect(rows).toHaveLength(8);
  const bad = rows.filter((row) => !row.pass);
  expect(bad).toHaveLength(5);
  expect(bad.every((row) => row.actual === "실패: refused")).toBe(true);
});

test("강조 호출이 실패하면 강조 3줄만 실패로 나온다", async () => {
  const rows = await runResumeCheck(db, answering(write, { fail: "invalid" }), "admin");
  expect(rows).toHaveLength(8);
  const bad = rows.filter((row) => !row.pass);
  expect(bad).toHaveLength(3);
  expect(bad.every((row) => row.actual === "실패: invalid")).toBe(true);
});

test("①을 강조하지 않았으면 AI가 고른 것을 보여 준다", async () => {
  const rows = await runResumeCheck(db, answering(write, { picks: [] }), "admin");
  expect(rows.find((r) => r.check === "①을 강조한다")?.actual).toBe("강조하지 않음 · 고른 것: 없음");
});
