import { beforeEach, expect, test } from "vitest";
import { createTestDb } from "@/db/test-db";
import type { Db } from "@/db/types";
import { createFakeAi } from "@/modules/ai/fake-client";
import { user } from "@/modules/auth/schema";
import { runPostingCheck } from "./prompt-check";
import { todayInKorea } from "./today";

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
  documents: [],
  questions: [],
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
  documents: [{ kind: "resume", label: "이력서" }, { kind: "portfolio", label: "포트폴리오" }],
  questions: [],
};
const docs = {
  ...sparse,
  company: "마바사소프트",
  title: "서비스 기획자",
  careerType: "new",
  documents: [
    { kind: "resume", label: "이력서" },
    { kind: "cover_letter", label: "자기소개서" },
    { kind: "portfolio", label: "포트폴리오(선택)" },
  ],
  questions: [
    { prompt: "지원 동기", charLimit: 500, countSpaces: null },
    { prompt: "입사 후 포부", charLimit: 300, countSpaces: false },
  ],
};
const chrome = { ...sparse, documents: [], company: "가나다(주)", title: "조립 신입 채용", isRolling: false, hasDetails: false };
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
// 회사 조사 예시의 맞는 답. 인재상은 samsung.com에서, 소식은 검색 결과에 있는 주소로 1년 안의 것
const today = todayInKorea(new Date());
const TALENT_URL = "https://www.samsung.com/sec/about-us/careers/";
const NEWS_URL = "https://news.example.com/s1";
const webAnswer = (answer: unknown, urls: string[]) => ({ web: { answer, sources: urls.map((url) => ({ url, title: "제목", pageAge: null })), searches: 2 } });
const talentResearch = webAnswer({ talent: { text: "열정과 몰입으로 미래에 도전하는 인재", url: TALENT_URL }, news: [] }, [TALENT_URL]);
const newsResearch = webAnswer({ talent: null, news: [{ summary: "삼성전자가 새 반도체 생산 라인을 가동했다", date: today, url: NEWS_URL }] }, [NEWS_URL]);
type Request = { purpose: string; messages: { text: string }[]; webSearch?: { allowedDomains?: string[] } };
// 어느 예시의 요청인지 보고 답한다(요청 순서가 정해져 있지 않다)
const answering = (
  fullAnswer: unknown,
  sparseAnswer: unknown,
  chromeAnswer: unknown = chrome,
  matchAnswer: unknown = match,
  docsAnswer: unknown = docs,
  research: { talent: unknown; news: unknown } = { talent: talentResearch, news: newsResearch },
) =>
  createFakeAi(
    Array.from({ length: 7 }, () => (request: Request) => {
      const text = request.messages[0].text;
      if (request.purpose === "company_research") return request.webSearch?.allowedDomains ? research.talent : research.news;
      return text.includes("[경험 기록]")
        ? matchAnswer
        : text.includes("마바사소프트") ? docsAnswer
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
  expect(rows).toHaveLength(40);
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

test("서류와 문항을 지어내거나 놓치면 잡아낸다", async () => {
  const wrongFull = { ...full, documents: [{ kind: "resume", label: "이력서" }], questions: [{ prompt: "Java 또는 Kotlin 개발 경험", charLimit: 500, countSpaces: true }] };
  const wrongSparse = { ...sparse, documents: [{ kind: "resume", label: "이력서" }] };
  const wrongDocs = { ...docs, documents: docs.documents.slice(0, 2), questions: [{ prompt: "지원 동기", charLimit: 500, countSpaces: true }, { prompt: "입사 후 포부", charLimit: 300, countSpaces: true }] };
  const rows = await runPostingCheck(db, answering(wrongFull, wrongSparse, chrome, match, wrongDocs), "admin");
  expect(rows.filter((row) => !row.pass).map((row) => row.check)).toEqual([
    "제출 서류를 지어내지 않는다",
    "자소서 문항을 지어내지 않는다",
    "제출 서류는 이력서와 포트폴리오",
    "서류 종류에 이력서·자기소개서·포트폴리오",
    "둘째 문항은 공백 제외",
  ]);
});

const researchChecks = [
  "인재상을 찾았다",
  "인재상 출처가 samsung.com이다",
  "소식 1~8개",
  "검사로 버린 항목이 2개 이하",
  "사건·사고 소식이 없다",
  "날짜가 있으면 1년 안",
];

test("회사 조사 예시는 삼성전자를 두 번 나눠 조사하고 여섯 줄로 나온다", async () => {
  const ai = answering(full, sparse);
  const rows = await runPostingCheck(db, ai, "admin");
  expect(rows.filter((row) => row.sample === "회사 조사").map((row) => row.check)).toEqual(researchChecks);

  const research = ai.requests.filter((request) => request.purpose === "company_research");
  expect(research).toHaveLength(2);
  for (const request of research) {
    expect(request.messages[0].text).toContain("[회사]\n삼성전자");
    expect(request.messages[0].text).toContain("[지원 직무]\nSW 개발 신입");
    expect(request.messages[0].text).toContain("[홈페이지]\nsamsung.com");
  }
  expect(research.map((request) => request.webSearch)).toEqual(
    expect.arrayContaining([{ maxUses: 2, allowedDomains: ["samsung.com"] }, { maxUses: 3 }]),
  );
});

test("인재상을 못 찾거나 지어낸 주소·사건·오래된 소식이 있으면 잡아내고 진단용 줄을 남긴다", async () => {
  const [y, m, d] = today.split("-");
  const old = `${Number(y) - 2}-${m}-${d}`;
  const made = (n: number) => ({ summary: `지어낸 소식 ${n}`, date: null, url: `https://made-up.example.com/${n}` });
  const badNews = webAnswer(
    {
      talent: null,
      news: [
        { summary: "삼성전자 공장에서 화재가 났다", date: today, url: NEWS_URL },
        { summary: "삼성전자가 새 제품을 내놓았다", date: old, url: "https://news.example.com/s2" },
        made(1),
        made(2),
        made(3),
      ],
    },
    [NEWS_URL, "https://news.example.com/s2"],
  );
  const noTalent = webAnswer({ talent: null, news: [] }, [TALENT_URL]);
  const rows = await runPostingCheck(db, answering(full, sparse, chrome, match, docs, { talent: noTalent, news: badNews }), "admin");
  const research = rows.filter((row) => row.sample === "회사 조사");
  expect(research.filter((row) => !row.pass).map((row) => row.check)).toEqual([
    "인재상을 찾았다",
    "인재상 출처가 samsung.com이다",
    "검사로 버린 항목이 2개 이하",
    "사건·사고 소식이 없다",
    "날짜가 있으면 1년 안",
  ]);
  const diag = research.find((row) => row.check === "AI가 보낸 답(진단용)");
  expect(diag?.pass).toBe(true);
  expect(diag?.actual).toContain("made-up.example.com");
});

test("맞는 답이면 회사 조사에 진단용 줄을 남기지 않는다", async () => {
  const rows = await runPostingCheck(db, answering(full, sparse), "admin");
  expect(rows.some((row) => row.check === "AI가 보낸 답(진단용)")).toBe(false);
});

test("조사 호출이 모두 실패하면 실패 줄과 진단용 줄이 나온다", async () => {
  const fail = { fail: "unavailable" };
  const rows = await runPostingCheck(db, answering(full, sparse, chrome, match, docs, { talent: fail, news: fail }), "admin");
  const research = rows.filter((row) => row.sample === "회사 조사");
  expect(research.map((row) => [row.check, row.actual, row.pass])).toEqual([
    ["AI 호출", "실패: unavailable", false],
    ["AI가 보낸 답(진단용)", expect.stringContaining("unavailable"), true],
  ]);
});
