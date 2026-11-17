import { beforeEach, expect, test } from "vitest";
import { createTestDb } from "@/db/test-db";
import type { Db } from "@/db/types";
import { createFakeAi } from "@/modules/ai/fake-client";
import { aiUsage } from "@/modules/ai/schema";
import { user } from "@/modules/auth/schema";
import { extractPosting } from "./extract";

let db: Db;
const today = "2026-11-17";
const now = new Date("2026-11-17T03:00:00Z");

const rawText = `(주)가나다테크 백엔드 개발자 채용
근무지: 서울 강남구 테헤란로
경력 3년 이상, 정규직
접수 마감: 11월 30일
문의 02-1234-5678 hr@ganada.example`;

const answer = (over: Record<string, unknown> = {}) => ({
  company: "(주)가나다테크",
  title: "백엔드 개발자",
  deadline: "2026-11-30",
  isRolling: false,
  locationText: "서울 강남구 테헤란로",
  regions: ["seoul"],
  careerType: "experienced",
  minYears: 3,
  employmentType: "regular",
  hasDetails: true,
  ...over,
});

beforeEach(async () => {
  delete process.env.AI_MONTHLY_LIMIT_USD;
  db = await createTestDb();
  await db.insert(user).values({ id: "u1", name: "홍길동", email: "u1@example.com" });
});

test("AI가 뽑은 값을 그대로 돌려주고, 사용량을 posting으로 기록한다", async () => {
  const result = await extractPosting(db, createFakeAi([answer()]), "u1", rawText, today, now);
  expect(result).toEqual({
    ok: true,
    value: {
      company: "(주)가나다테크",
      title: "백엔드 개발자",
      deadline: "2026-11-30",
      isRolling: false,
      locationText: "서울 강남구 테헤란로",
      regions: ["seoul"],
      careerType: "experienced",
      minYears: 3,
      employmentType: "regular",
      hasDetails: true,
      unverified: [],
    },
  });
  expect((await db.select().from(aiUsage)).map((row) => row.purpose)).toEqual(["posting"]);
});

test("오늘 날짜를 함께 보내고, 연락처는 가려서 보낸다", async () => {
  const ai = createFakeAi([answer()]);
  await extractPosting(db, ai, "u1", rawText, today, now);
  const sent = ai.requests[0].messages[0].text;
  expect(sent).toContain("오늘 날짜: 2026-11-17");
  expect(sent).not.toContain("02-1234-5678");
  expect(sent).not.toContain("hr@ganada.example");
  expect(sent).not.toContain("홍길동");
});

test("목록에 없는 지역, 틀린 날짜, 범위 밖의 연차는 버린다", async () => {
  const wrong = answer({ regions: ["seoul", "mars", "anywhere", "seoul"], deadline: "11월 30일", minYears: -1, locationText: "" });
  const result = await extractPosting(db, createFakeAi([wrong]), "u1", rawText, today, now);
  expect(result.ok && result.value).toMatchObject({ regions: ["seoul"], deadline: null, minYears: null, locationText: null });
});

test("상시 채용이면 마감일을 비운다", async () => {
  const result = await extractPosting(db, createFakeAi([answer({ isRolling: true })]), "u1", rawText, today, now);
  expect(result.ok && result.value).toMatchObject({ isRolling: true, deadline: null });
});

test("원문에 글자 그대로 없는 회사명과 직무명은 다시 보라고 표시한다", async () => {
  const guessed = answer({ company: "가나다 그룹", title: "백엔드  개발자" });
  const result = await extractPosting(db, createFakeAi([guessed]), "u1", rawText, today, now);
  // 직무명은 띄어쓰기만 다르므로 원문에 있는 것으로 본다
  expect(result.ok && result.value.unverified).toEqual(["company"]);
});

test("찾지 못해 비워 둔 값은 표시하지 않는다", async () => {
  const result = await extractPosting(db, createFakeAi([answer({ company: "", title: "" })]), "u1", rawText, today, now);
  expect(result.ok && result.value).toMatchObject({ company: "", title: "", unverified: [] });
});

test("AI가 거절하거나 한도를 넘으면 실패를 돌려준다", async () => {
  expect(await extractPosting(db, createFakeAi([{ fail: "refused" }]), "u1", rawText, today, now)).toEqual({ ok: false, reason: "refused" });
  process.env.AI_MONTHLY_LIMIT_USD = "0";
  expect(await extractPosting(db, createFakeAi([]), "u1", rawText, today, now)).toEqual({ ok: false, reason: "over_limit" });
});

test("공고 내용이 없는 글이면 hasDetails가 false로 온다", async () => {
  const result = await extractPosting(db, createFakeAi([answer({ hasDetails: false })]), "u1", "채용사이트 로그인 회원가입", today, now);
  expect(result.ok && result.value.hasDetails).toBe(false);
});
