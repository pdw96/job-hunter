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
  hasDetails: true,
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
  hasDetails: true,
};
const chrome = { ...sparse, company: "가나다(주)", title: "조립 신입 채용", isRolling: false, hasDetails: false };
// 맞대기 예시의 맞는 답. ①(E1)은 Java·Kotlin 요구 사항의 근거이고, ②(E2)는 어디에도 쓰이지 않는다.
// "경력 3~5년"은 코드가 따로 점수를 매기므로, 입사 가능 시기·병역은 어떤 경험으로도 채울 수 없으므로 뽑지 않는다.
// 담당 업무는 우대로 뽑는다
const match = {
  field: { level: "same_job", reason: "같은 백엔드 직무" },
  requirements: [
    { kind: "required", text: "Java 또는 Kotlin 개발 경험", quote: "Java 또는 Kotlin 개발 경험", evidence: [{ exp: "E1", level: "full", why: "Kotlin으로 주문 API를 만들었다" }] },
    { kind: "preferred", text: "대용량 트래픽 처리 경험", quote: "대용량 트래픽 처리 경험", evidence: [] },
    { kind: "preferred", text: "주문·결제 서비스 API 개발 및 운영", quote: "주문·결제 서비스 API 개발 및 운영", evidence: [] },
  ],
};
// 어느 예시의 요청인지 보고 답한다(요청 순서가 정해져 있지 않다)
const answering = (fullAnswer: unknown, sparseAnswer: unknown, chromeAnswer: unknown = chrome, matchAnswer: unknown = match) =>
  createFakeAi(
    Array.from({ length: 4 }, () => (request: { messages: { text: string }[] }) => {
      const text = request.messages[0].text;
      return text.includes("[경험 기록]")
        ? matchAnswer
        : text.includes("가나다테크") ? fullAnswer : text.includes("다라마 스튜디오") ? sparseAnswer : chromeAnswer;
    }),
  );

beforeEach(async () => {
  delete process.env.AI_MONTHLY_LIMIT_USD;
  db = await createTestDb();
  await db.insert(user).values({ id: "admin", name: "A", email: "a@example.com" });
});

test("값을 맞게 뽑고 없는 값을 비워 두면 모두 통과한다", async () => {
  const rows = await runPostingCheck(db, answering(full, sparse), "admin");
  expect(rows).toHaveLength(27);
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

test("사이트 안내 글만 있는 글을 공고 내용이 있다고 하면 잡아낸다", async () => {
  const rows = await runPostingCheck(db, answering(full, sparse, { ...chrome, hasDetails: true }), "admin");
  expect(rows.filter((row) => !row.pass).map((row) => row.check)).toEqual(["공고 내용이 없는 글을 가려낸다"]);
});

const matchChecks = [
  "Java·Kotlin 요구 사항의 근거로 ①을 짚는다",
  "②를 어느 요구 사항의 근거로도 짚지 않는다",
  "대용량 트래픽 우대는 부족한 점으로 남긴다",
  "경력 연수만 적힌 요건(경력 3~5년)은 요구 사항으로 뽑지 않는다",
  "입사 가능 시기·병역 같은 조건은 요구 사항으로 뽑지 않는다",
  "담당 업무(주문·결제 서비스 API 개발)는 필수로 뽑지 않는다",
  "인용한 구절이 모두 원문에 있다",
  "분야를 same_job으로 본다",
];

test("맞대기 예시는 여덟 줄로 나온다", async () => {
  const rows = await runPostingCheck(db, answering(full, sparse), "admin");
  expect(rows.filter((row) => row.sample === "요구 사항 맞대기").map((row) => row.check)).toEqual(matchChecks);
});

test("②를 근거로 짚거나 없는 구절을 인용하면 잡아낸다", async () => {
  const [kotlin, highTraffic] = match.requirements;
  const wrong = {
    field: { level: "other", reason: "" },
    requirements: [
      { ...kotlin, quote: "원문에 없는 구절" },
      { ...highTraffic, evidence: [{ exp: "E2", level: "partial", why: "" }] },
    ],
  };
  const rows = await runPostingCheck(db, answering(full, sparse, chrome, wrong), "admin");
  expect(rows.filter((row) => !row.pass).map((row) => row.check)).toEqual([
    "②를 어느 요구 사항의 근거로도 짚지 않는다",
    "대용량 트래픽 우대는 부족한 점으로 남긴다",
    "인용한 구절이 모두 원문에 있다",
    "분야를 same_job으로 본다",
  ]);
});

test("①을 짚지 않으면 Java·Kotlin 줄이 실패한다", async () => {
  const noEvidence = { ...match, requirements: [{ ...match.requirements[0], evidence: [] }, ...match.requirements.slice(1)] };
  const rows = await runPostingCheck(db, answering(full, sparse, chrome, noEvidence), "admin");
  expect(rows.filter((row) => !row.pass).map((row) => row.check)).toEqual(["Java·Kotlin 요구 사항의 근거로 ①을 짚는다"]);
});

test("경력 연수만 적힌 요건을 요구 사항으로 뽑으면 잡아낸다", async () => {
  const withYears = {
    ...match,
    requirements: [...match.requirements, { kind: "required", text: "경력 3~5년", quote: "경력 3~5년", evidence: [] }],
  };
  const rows = await runPostingCheck(db, answering(full, sparse, chrome, withYears), "admin");
  expect(rows.filter((row) => !row.pass).map((row) => row.check)).toEqual(["경력 연수만 적힌 요건(경력 3~5년)은 요구 사항으로 뽑지 않는다"]);
});

test("연수를 다르게 띄어 써도 경력 연수 요건으로 본다", async () => {
  const withYears = {
    ...match,
    requirements: [...match.requirements, { kind: "required", text: "3 ~ 5년의 경력", quote: "경력 3~5년", evidence: [] }],
  };
  const rows = await runPostingCheck(db, answering(full, sparse, chrome, withYears), "admin");
  expect(rows.filter((row) => !row.pass).map((row) => row.check)).toEqual(["경력 연수만 적힌 요건(경력 3~5년)은 요구 사항으로 뽑지 않는다"]);
});

test("입사 가능 시기나 병역을 요구 사항으로 뽑으면 우대여도 잡아낸다", async () => {
  for (const extra of [
    { kind: "required", text: "2027년 1월 입사 가능", quote: "2027년 1월 입사 가능한 자", evidence: [] },
    { kind: "preferred", text: "병역필 또는 면제", quote: "병역필 또는 면제자", evidence: [] },
  ]) {
    const withCondition = { ...match, requirements: [...match.requirements, extra] };
    const rows = await runPostingCheck(db, answering(full, sparse, chrome, withCondition), "admin");
    expect(rows.filter((row) => !row.pass).map((row) => row.check)).toEqual(["입사 가능 시기·병역 같은 조건은 요구 사항으로 뽑지 않는다"]);
  }
});

test("담당 업무를 필수로 뽑으면 잡아내고, 우대로 뽑거나 뽑지 않으면 통과한다", async () => {
  const [kotlin, highTraffic, duty] = match.requirements;
  const required = { ...match, requirements: [kotlin, highTraffic, { ...duty, kind: "required" }] };
  const rows = await runPostingCheck(db, answering(full, sparse, chrome, required), "admin");
  expect(rows.filter((row) => !row.pass).map((row) => row.check)).toEqual(["담당 업무(주문·결제 서비스 API 개발)는 필수로 뽑지 않는다"]);

  const absent = { ...match, requirements: [kotlin, highTraffic] };
  const absentRows = await runPostingCheck(db, answering(full, sparse, chrome, absent), "admin");
  expect(absentRows.filter((row) => !row.pass)).toEqual([]);
});

test("맞대기 예시에 입사 가능 시기와 병역 조건이 담긴 인재상 글을 함께 보낸다", async () => {
  const ai = answering(full, sparse);
  await runPostingCheck(db, ai, "admin");
  const texts = ai.requests.map((request) => request.messages[0].text).filter((text) => text.includes("[경험 기록]"));
  expect(texts).toHaveLength(1);
  expect(texts[0]).toContain("2027년 1월 입사 가능한 자");
  expect(texts[0]).toContain("병역필 또는 면제자");
});
