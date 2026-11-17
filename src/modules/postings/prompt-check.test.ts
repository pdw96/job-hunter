import { beforeEach, expect, test } from "vitest";
import { createTestDb } from "@/db/test-db";
import type { Db } from "@/db/types";
import { createFakeAi } from "@/modules/ai/fake-client";
import { user } from "@/modules/auth/schema";
import { runPostingCheck } from "./prompt-check";

let db: Db;

const full = {
  company: "(주)가나다테크",
  title: "백엔드 개발자",
  deadline: "2026-12-05",
  isRolling: false,
  locationText: "경기도 성남시 분당구 판교역로",
  regions: ["gyeonggi"],
  careerType: "experienced",
  minYears: 3,
  employmentType: "regular",
};
const sparse = {
  company: "다라마 스튜디오",
  title: "콘텐츠 마케터",
  deadline: "",
  isRolling: true,
  locationText: "",
  regions: [],
  careerType: "any",
  minYears: -1,
  employmentType: "unknown",
};
// 어느 예시의 요청인지 보고 답한다(요청 순서가 정해져 있지 않다)
const answering = (fullAnswer: unknown, sparseAnswer: unknown) =>
  createFakeAi(
    Array.from({ length: 2 }, () => (request: { messages: { text: string }[] }) =>
      request.messages[0].text.includes("가나다테크") ? fullAnswer : sparseAnswer,
    ),
  );

beforeEach(async () => {
  delete process.env.AI_MONTHLY_LIMIT_USD;
  db = await createTestDb();
  await db.insert(user).values({ id: "admin", name: "A", email: "a@example.com" });
});

test("값을 맞게 뽑고 없는 값을 비워 두면 모두 통과한다", async () => {
  const rows = await runPostingCheck(db, answering(full, sparse), "admin");
  expect(rows).toHaveLength(16);
  expect(rows.filter((row) => !row.pass)).toEqual([]);
});

test("본사를 근무지로 잡거나 없는 값을 지어내면 잡아낸다", async () => {
  const rows = await runPostingCheck(
    db,
    answering(
      { ...full, company: "잡코리아", regions: ["seoul"], minYears: 5, deadline: "2025-12-05" },
      { ...sparse, deadline: "2026-12-31", isRolling: false, regions: ["seoul"], minYears: 0, careerType: "new", employmentType: "regular" },
    ),
    "admin",
  );
  expect(rows.filter((row) => !row.pass).map((row) => row.check)).toEqual([
    "회사명",
    "마감일 (연도가 없어도 올해로)",
    "근무지의 시·도 (본사가 아니라 근무지)",
    "요구 경력 (3~5년이면 3)",
    "마감일을 지어내지 않는다",
    "채용 시 마감을 상시 채용으로 본다",
    "근무지를 지어내지 않는다",
    "경력 연수를 지어내지 않는다",
    "신입·경력 구분을 지어내지 않는다",
    "고용 형태를 지어내지 않는다",
  ]);
});

test("AI 호출이 실패하면 실패 줄로 나온다", async () => {
  const rows = await runPostingCheck(db, answering({ fail: "refused" }, sparse), "admin");
  expect(rows.filter((row) => row.check === "AI 호출")).toHaveLength(1);
});
