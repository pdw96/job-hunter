import { beforeEach, expect, test } from "vitest";
import { createTestDb } from "@/db/test-db";
import type { Db } from "@/db/types";
import { createFakeAi } from "@/modules/ai/fake-client";
import { aiUsage } from "@/modules/ai/schema";
import { user } from "@/modules/auth/schema";
import type { ExperienceInput } from "@/modules/experiences/input";
import { confirmExperience, createExperience, setTrackScope } from "@/modules/experiences/repo";
import { createTrack } from "@/modules/tracks/repo";
import type { SurveyInput } from "@/modules/tracks/survey";
import { analyzePosting, analyzeText } from "./analyze";
import { validatePosting } from "./input";
import { createPosting, getPosting, updatePosting } from "./repo";

let db: Db;
let trackId: string;
const now = new Date("2026-11-17T03:00:00Z");

const survey: SurveyInput = {
  name: "백엔드 개발",
  majorCode: "20",
  jobs: [
    { ncsCode: "20010202", customName: null },
    { ncsCode: null, customName: "백엔드 개발자" },
  ],
  applicantType: "experienced",
  experienceMonths: 30,
  regions: ["seoul"],
  salaryMin: null,
  employmentTypes: ["regular"],
  importanceOrder: ["jobMatch", "location", "experience", "field", "preferred"],
  extraAnswers: {},
};

const rawText = `가나다 주식회사 백엔드 개발자 채용
담당 업무
- 결제 API 개발과 운영
자격 요건
- Java 실무 경력 3년 이상
우대 사항
- 대용량 트래픽 경험
문의 hr@ganada.example`;

const posting = (over: Record<string, unknown> = {}) => {
  const checked = validatePosting({
    company: "가나다 주식회사",
    title: "백엔드 개발자",
    deadline: "2026-11-30",
    isRolling: false,
    locationText: "서울 강남구",
    regions: ["seoul"],
    careerType: "experienced",
    minYears: 3,
    employmentType: "regular",
    url: "",
    rawText,
    companyNote: "고객 문제를 끝까지 파고드는 사람",
    ...over,
  });
  if (!checked.ok) throw new Error(JSON.stringify(checked.errors));
  return checked.value;
};

const job: ExperienceInput = {
  name: "결제 시스템 개편",
  kind: "project",
  organization: "라마바 주식회사",
  role: "백엔드 개발",
  startMonth: "2023-03",
  endMonth: "2023-11",
  isOngoing: false,
  situation: "결제 장애가 잦았다",
  actions: "Java로 결제 승인 API를 다시 설계했다",
  result: "장애가 줄었다",
  metrics: [{ text: "월 장애 57건에서 9건", basis: "사내 장애 보고서" }],
  notDone: "프론트엔드는 하지 않았다",
  bannedPhrases: [],
  evidenceNote: "사내 보고서 링크 비밀메모",
  tags: [],
};

async function addExperience(input: ExperienceInput, confirm = true) {
  const id = await createExperience(db, "u1", input);
  if (confirm) await confirmExperience(db, "u1", id);
  return id;
}

async function addPosting(userId = "u1", over: Record<string, unknown> = {}) {
  const result = await createPosting(db, userId, trackId, posting(over));
  if (!result.ok) throw new Error(result.reason);
  return result.id;
}

const answer = (over: Record<string, unknown> = {}) => ({
  field: { level: "same_job", reason: "공고의 직무가 지원 직무인 백엔드 개발자와 같다" },
  requirements: [
    {
      kind: "required",
      text: "Java 실무 경력 3년 이상",
      quote: "Java 실무 경력 3년 이상",
      evidence: [{ exp: "E1", level: "partial", why: "공고의 Java 실무와 경험의 Java 결제 API 설계가 겹친다" }],
    },
    { kind: "preferred", text: "대용량 트래픽 경험", quote: "대용량 트래픽 경험", evidence: [] },
  ],
  ...over,
});

beforeEach(async () => {
  delete process.env.AI_MONTHLY_LIMIT_USD;
  db = await createTestDb();
  await db.insert(user).values([
    { id: "u1", name: "홍길동", email: "u1@example.com" },
    { id: "u2", name: "김철수", email: "u2@example.com" },
  ]);
  const track = await createTrack(db, "u1", survey);
  if (!track.ok) throw new Error(track.reason);
  trackId = track.id;
});

test("AI에 보내는 글에 확인된 경험의 별명과 내용이 있고, 미확인·제외 경험, 수치, 증빙 메모, 이메일, 실제 id가 없다", async () => {
  const used = await addExperience(job);
  const unconfirmed = await addExperience({ ...job, name: "미확인 경험", startMonth: "2024-01" }, false);
  const excluded = await addExperience({ ...job, name: "제외한 경험", startMonth: "2022-01" });
  await setTrackScope(db, "u1", excluded, trackId, "exclude");
  const id = await addPosting();
  const ai = createFakeAi([answer()]);

  await analyzePosting(db, ai, "u1", id, now);

  const request = ai.requests[0];
  expect(request).toMatchObject({ purpose: "posting_match", effort: "medium", maxTokens: 8000 });
  const sent = request.messages[0].text;
  expect(request.messages).toHaveLength(1);
  expect(sent).toContain("[지원 직무]\n응용SW엔지니어링, 백엔드 개발자");
  expect(sent).toContain("[분야]\n정보통신");
  expect(sent).toContain("[공고 원문]\n가나다 주식회사 백엔드 개발자 채용\n담당 업무");
  expect(sent).toContain("Java 실무 경력 3년 이상");
  expect(sent).toContain("[인재상·회사 소개]\n고객 문제를 끝까지 파고드는 사람");
  expect(sent).toContain("[경험 기록]\nE1\n");
  for (const value of ["결제 시스템 개편", "프로젝트", "라마바 주식회사", "백엔드 개발", "2023-03 ~ 2023-11", "결제 장애가 잦았다", "Java로 결제 승인 API를 다시 설계했다", "장애가 줄었다", "프론트엔드는 하지 않았다"]) {
    expect(sent).toContain(value);
  }
  expect(sent).not.toContain("E2");
  expect(sent).not.toContain("미확인 경험");
  expect(sent).not.toContain("제외한 경험");
  expect(sent).not.toContain("57건");
  expect(sent).not.toContain("사내 장애 보고서");
  expect(sent).not.toContain("비밀메모");
  expect(sent).not.toContain("hr@ganada.example");
  expect(sent).not.toContain("u1@example.com");
  expect(sent).not.toContain("홍길동");
  for (const secret of [used, unconfirmed, excluded, id, trackId, "u1"]) expect(sent).not.toContain(secret);
  // 고정 지시문에도 바뀌는 값이 들어가지 않는다
  expect(request.system).not.toContain("결제 시스템 개편");
  expect(request.system).not.toContain("2026");
});

test("인재상 글이 없고 경험도 없으면 '없음'으로 보낸다", async () => {
  const ai = createFakeAi([answer({ requirements: [] })]);
  await analyzeText(db, ai, "u1", { rawText, companyNote: null, jobNames: ["백엔드 개발자"], majorName: "정보통신", candidates: [] }, now);
  const sent = ai.requests[0].messages[0].text;
  expect(sent).toContain("[인재상·회사 소개]\n없음");
  expect(sent).toContain("[경험 기록]\n없음");
});

test("없는 별명(E9)을 가리킨 근거는 버리고, 별명을 실제 id로 바꾼다", async () => {
  const first = await addExperience(job);
  const second = await addExperience({ ...job, name: "사내 교육 이수", kind: "training", startMonth: "2021-01", endMonth: "2021-02" });
  const id = await addPosting();
  const reply = answer({
    requirements: [
      {
        kind: "required",
        text: "Java 실무 경력 3년 이상",
        quote: "Java 실무 경력 3년 이상",
        evidence: [
          { exp: "E9", level: "full", why: "없는 경험" },
          { exp: "E2", level: "partial", why: "교육에서 Java를 배웠다" },
          { exp: "E1", level: "full", why: "결제 API를 Java로 설계했다" },
          { exp: "E2", level: "full", why: "같은 경험을 두 번 짚었다" },
        ],
      },
    ],
  });

  const result = await analyzePosting(db, createFakeAi([reply]), "u1", id, now);

  expect(result.ok).toBe(true);
  const evidence = result.ok ? result.value.requirements[0].evidence : [];
  expect(evidence).toEqual([
    { experienceId: second, level: "partial", why: "교육에서 Java를 배웠다" },
    { experienceId: first, level: "full", why: "결제 API를 Java로 설계했다" },
  ]);
  expect((await getPosting(db, "u1", id))?.analysis?.requirements[0].evidence).toEqual(evidence);
});

test("원문에 없는 quote는 quoteFound false", async () => {
  const id = await addPosting();
  const reply = answer({
    requirements: [
      // 띄어쓰기와 대소문자만 다르면 찾은 것으로 본다
      { kind: "required", text: "Java 경력", quote: "java  실무 경력3년 이상", evidence: [] },
      // 인재상 글에 있는 것도 찾은 것으로 본다
      { kind: "required", text: "끈기", quote: "고객 문제를 끝까지", evidence: [] },
      { kind: "required", text: "Kotlin 경력", quote: "Kotlin 실무 경력", evidence: [] },
      { kind: "preferred", text: "협업", quote: "  ", evidence: [] },
    ],
  });

  const result = await analyzePosting(db, createFakeAi([reply]), "u1", id, now);

  expect(result.ok && result.value.requirements.map((r) => [r.text, r.quoteFound])).toEqual([
    ["Java 경력", true],
    ["끈기", true],
    ["Kotlin 경력", false],
    ["협업", false],
  ]);
});

test("why에 경험에 없는 숫자가 있으면 why를 비운다", async () => {
  const experience = await addExperience(job);
  const id = await addPosting();
  const reply = answer({
    requirements: [
      {
        kind: "required",
        text: "Java 실무 경력 3년 이상",
        quote: "Java 실무 경력 3년 이상",
        evidence: [{ exp: "E1", level: "partial", why: "결제 장애를 90% 줄였다" }],
      },
      {
        kind: "required",
        text: "Java 실무 경력 3년 이상",
        quote: "Java 실무 경력 3년 이상",
        // 3은 quote에, 2023은 경험의 기간에 있는 숫자다
        evidence: [{ exp: "E1", level: "partial", why: "2023년에 Java로 결제 API를 설계했으나 3년에는 못 미친다" }],
      },
    ],
  });

  const result = await analyzePosting(db, createFakeAi([reply]), "u1", id, now);

  expect(result.ok && result.value.requirements.map((r) => r.evidence)).toEqual([
    [{ experienceId: experience, level: "partial", why: "" }],
    [{ experienceId: experience, level: "partial", why: "2023년에 Java로 결제 API를 설계했으나 3년에는 못 미친다" }],
  ]);
});

test("원문에서 찾지 못한 quote의 숫자는 why의 근거가 되지 못한다", async () => {
  const experience = await addExperience(job);
  const id = await addPosting();
  const reply = answer({
    requirements: [
      {
        kind: "required",
        text: "장애 감소 경험",
        quote: "장애 90% 감소 경험", // 원문에 없는 구절
        evidence: [{ exp: "E1", level: "full", why: "결제 장애를 90% 줄였다" }],
      },
    ],
  });

  const result = await analyzePosting(db, createFakeAi([reply]), "u1", id, now);

  expect(result.ok && result.value.requirements[0]).toMatchObject({
    quoteFound: false,
    evidence: [{ experienceId: experience, level: "full", why: "" }],
  });
  expect((await getPosting(db, "u1", id))?.analysis?.requirements[0].evidence[0].why).toBe("");
});

test("글자 수를 자르고 빈 요구 사항은 버린다", async () => {
  const id = await addPosting();
  const reply = answer({
    field: { level: "other", reason: "가".repeat(250) },
    requirements: [
      { kind: "required", text: "   ", quote: "Java", evidence: [] },
      { kind: "required", text: `  ${"나".repeat(250)}  `, quote: "다".repeat(350), evidence: [] },
    ],
  });

  const result = await analyzePosting(db, createFakeAi([reply]), "u1", id, now);

  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.value.field).toEqual({ level: "other", reason: "가".repeat(200) });
  expect(result.value.requirements).toHaveLength(1);
  expect(result.value.requirements[0].text).toBe("나".repeat(200));
  expect(result.value.requirements[0].quote).toBe("다".repeat(300));
  expect(result.value.analyzedAt).toBe(now.toISOString());
});

test("요구 사항이 30개를 넘으면 30개만", async () => {
  const id = await addPosting();
  const many = Array.from({ length: 35 }, (_, i) => ({ kind: "required", text: `요구 ${i + 1}`, quote: "Java", evidence: [] }));

  const result = await analyzePosting(db, createFakeAi([answer({ requirements: many })]), "u1", id, now);

  expect(result.ok && result.value.requirements.map((r) => r.text)).toEqual(many.slice(0, 30).map((r) => r.text));
});

test("경험이 하나도 없어도 요구 사항을 뽑아 저장한다", async () => {
  const id = await addPosting();
  const reply = answer({
    requirements: [
      { kind: "required", text: "Java 실무 경력 3년 이상", quote: "Java 실무 경력 3년 이상", evidence: [{ exp: "E1", level: "full", why: "지어낸 경험" }] },
    ],
  });

  const result = await analyzePosting(db, createFakeAi([reply]), "u1", id, now);

  const expected = {
    requirements: [{ kind: "required", text: "Java 실무 경력 3년 이상", quote: "Java 실무 경력 3년 이상", quoteFound: true, evidence: [] }],
    field: { level: "same_job", reason: "공고의 직무가 지원 직무인 백엔드 개발자와 같다" },
    analyzedAt: now.toISOString(),
  };
  expect(result).toEqual({ ok: true, value: expected });
  expect((await getPosting(db, "u1", id))?.analysis).toEqual(expected);
});

test("AI가 답하는 사이 원문이 바뀌면 changed이고 저장하지 않는다", async () => {
  const id = await addPosting();
  const ai = createFakeAi([
    async () => {
      await updatePosting(db, "u1", id, posting({ rawText: `${rawText}\n- Kotlin 경험` }));
      return answer();
    },
  ]);

  const result = await analyzePosting(db, ai, "u1", id, now);

  expect(result).toEqual({ ok: false, reason: "changed" });
  const saved = await getPosting(db, "u1", id);
  expect(saved?.analysis).toBeNull();
  expect(saved?.rawText).toContain("Kotlin 경험");
});

test("남의 공고는 not_found이고 AI를 부르지 않는다", async () => {
  const id = await addPosting();
  const ai = createFakeAi([]);
  expect(await analyzePosting(db, ai, "u2", id, now)).toEqual({ ok: false, reason: "not_found" });
  expect(await analyzePosting(db, ai, "u1", "no-such-id", now)).toEqual({ ok: false, reason: "not_found" });
  expect(ai.requests).toHaveLength(0);
});

test("사용량이 posting_match로 기록된다", async () => {
  const id = await addPosting();
  await analyzePosting(db, createFakeAi([answer()]), "u1", id, now);
  expect((await db.select().from(aiUsage)).map((row) => [row.purpose, row.userId])).toEqual([["posting_match", "u1"]]);
});

test("AI 실패(refused)와 한도(over_limit)를 그대로 돌려준다", async () => {
  const id = await addPosting();
  expect(await analyzePosting(db, createFakeAi([{ fail: "refused" }]), "u1", id, now)).toEqual({ ok: false, reason: "refused" });
  expect(await analyzePosting(db, createFakeAi([{ requirements: "틀린 모양" }]), "u1", id, now)).toEqual({ ok: false, reason: "invalid" });
  process.env.AI_MONTHLY_LIMIT_USD = "0";
  const ai = createFakeAi([]);
  expect(await analyzePosting(db, ai, "u1", id, now)).toEqual({ ok: false, reason: "over_limit" });
  expect(ai.requests).toHaveLength(0);
  expect((await getPosting(db, "u1", id))?.analysis).toBeNull();
});
