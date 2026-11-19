import { eq } from "drizzle-orm";
import { beforeEach, expect, test } from "vitest";
import { createTestDb } from "@/db/test-db";
import type { Db } from "@/db/types";
import { createFakeAi } from "@/modules/ai/fake-client";
import { aiUsage } from "@/modules/ai/schema";
import { user } from "@/modules/auth/schema";
import type { ExperienceInput } from "@/modules/experiences/input";
import { confirmExperience, createExperience, setTrackScope, updateExperience } from "@/modules/experiences/repo";
import { experiences } from "@/modules/experiences/schema";
import type { AppliedScore, PostingAnalysis } from "@/modules/postings/analysis";
import { validatePosting } from "@/modules/postings/input";
import { applyToPosting, createPosting, getPosting, saveAnalysis, setStatus } from "@/modules/postings/repo";

import { createTrack } from "@/modules/tracks/repo";
import type { SurveyInput } from "@/modules/tracks/survey";
import { listWritingSources } from "@/modules/experiences/writing";
import { addQuestions, approveSelection, getQuestion, updateQuestion } from "./repo";
import { describeSource, selectForQuestion, selectText, type SelectInput } from "./select";
import { SELECT_SYSTEM } from "./prompts";

let db: Db;
let trackId: string;
let otherTrack: string;
const now = new Date("2026-11-18T03:00:00Z");

const survey: SurveyInput = {
  name: "백엔드 개발",
  majorCode: "20",
  jobs: [{ ncsCode: "20010202", customName: null }],
  applicantType: "experienced",
  experienceMonths: 30,
  regions: ["seoul"],
  salaryMin: null,
  employmentTypes: ["regular"],
  importanceOrder: ["jobMatch", "location", "experience", "field", "preferred"],
  extraAnswers: {},
};
const rawText = `가나다 주식회사 백엔드 개발자 채용
자격 요건
- Java 실무 경력 3년 이상
문의 hr@ganada.example`;
const raw = {
  company: "가나다 주식회사",
  title: "백엔드 개발자",
  deadline: "2026-11-30",
  isRolling: false,
  locationText: "서울 강남구",
  regions: ["seoul"],
  careerType: "experienced",
  minYears: 3,
  employmentType: "regular",
  url: null,
  rawText,
  companyNote: "고객 문제를 끝까지 파고드는 사람",
};
const analysis: PostingAnalysis = {
  target: "개발",
  requirements: [
    { kind: "required", text: "Java 실무 경력 3년 이상", quote: "Java 실무 경력 3년 이상", quoteFound: true, evidence: [] },
  ],
  field: { level: "same_job", reason: "분야가 같다" },
  analyzedAt: "2026-11-18T00:00:00.000Z",
};
const score = {
  desire: 50,
  fit: 50,
  criteria: {},
  analyzedAt: "2026-11-18T00:00:00.000Z",
  appliedAt: "2026-11-18T00:00:00.000Z",
} as unknown as AppliedScore;

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
  bannedPhrases: ["혁신적인"],
  evidenceNote: "사내 보고서 링크 비밀메모",
  tags: [],
};

// 확인됨으로 만든다(AI 판정을 흉내 낸다)
async function markConfirmed(id: string) {
  await db
    .update(experiences)
    .set({
      rubric: {
        period: { status: "met", note: null },
        role: { status: "met", note: null },
        level: { status: "met", note: null },
        metrics: { status: "met", note: null },
        evidence: { status: "unjudged", note: null },
      },
    })
    .where(eq(experiences.id, id));
  await confirmExperience(db, "u1", id);
}

async function addExperience(over: Partial<ExperienceInput> = {}, confirm = true) {
  const id = await createExperience(db, "u1", { ...job, ...over });
  if (confirm) await markConfirmed(id);
  return id;
}

async function addPosting(userId = "u1", apply = true) {
  const checked = validatePosting(raw);
  if (!checked.ok) throw new Error("공고 입력 오류");
  const created = await createPosting(db, userId, userId === "u1" ? trackId : otherTrack, checked.value);
  if (!created.ok) throw new Error(created.reason);
  if (apply) {
    const saved = await saveAnalysis(db, userId, created.id, analysis, { rawText, companyNote: raw.companyNote });
    if (!saved.ok) throw new Error(saved.reason);
    const posting = await getPosting(db, userId, created.id);
    if (!posting) throw new Error("없음");
    const result = await applyToPosting(db, userId, created.id, score, { ...posting, analysis });
    if (!result.ok) throw new Error(result.reason);
  }
  return created.id;
}

async function addQuestion(postingId: string, prompt = "지원 동기와 관련 경험을 쓰세요", charLimit: number | null = 500) {
  const result = await addQuestions(db, "u1", postingId, [{ prompt, charLimit, countSpaces: true }]);
  if (!result.ok) throw new Error(result.reason);
  return result.ids[0];
}

const reply = (over: Record<string, unknown> = {}) => ({
  picks: [{ exp: "E1", overlap: "문항의 관련 경험과 결제 API 설계가 겹친다", role: "Java로 결제 승인 API를 다시 설계했다" }],
  passed: [],
  ...over,
});

beforeEach(async () => {
  delete process.env.AI_MONTHLY_LIMIT_USD;
  db = await createTestDb();
  await db.insert(user).values([
    { id: "u1", name: "홍길동", email: "u1@example.com" },
    { id: "u2", name: "김철수", email: "u2@example.com" },
  ]);
  const mine = await createTrack(db, "u1", survey);
  const theirs = await createTrack(db, "u2", survey);
  if (!mine.ok || !theirs.ok) throw new Error("트랙을 만들지 못함");
  trackId = mine.id;
  otherTrack = theirs.id;
});

test("AI에 보내는 글에 확인된 사용 경험의 별명과 내용이 있고, 부분 확인·요약만 경험, 수치, 증빙 메모, 이메일, 실제 id가 없다", async () => {
  const used = await addExperience();
  const unconfirmed = await addExperience({ name: "미확인 경험", startMonth: "2024-01" }, false);
  const summaryOnly = await addExperience({ name: "요약만 경험", startMonth: "2022-01" });
  await setTrackScope(db, "u1", summaryOnly, trackId, "summary");
  const excluded = await addExperience({ name: "제외한 경험", startMonth: "2021-01" });
  await setTrackScope(db, "u1", excluded, trackId, "exclude");
  const postingId = await addPosting();
  const questionId = await addQuestion(postingId);
  const ai = createFakeAi([reply()]);

  await selectForQuestion(db, ai, "u1", questionId, now);

  const request = ai.requests[0];
  expect(request).toMatchObject({ purpose: "application_select", effort: "medium", maxTokens: 8000 });
  expect(request.messages).toHaveLength(1);
  const sent = request.messages[0].text;
  expect(sent).toContain("[문항]\n지원 동기와 관련 경험을 쓰세요");
  expect(sent).toContain("[글자 수]\n500");
  expect(sent).toContain("[공고]\n가나다 주식회사 백엔드 개발자 채용");
  expect(sent).toContain("고객 문제를 끝까지 파고드는 사람");
  expect(sent).toContain("[공고 요구 사항]\nJava 실무 경력 3년 이상");
  expect(sent).toContain("[경험 기록]\nE1\n");
  expect(sent).toContain("[다른 문항에서 쓰기로 한 경험]\n없음");
  for (const value of ["결제 시스템 개편", "프로젝트", "라마바 주식회사", "백엔드 개발", "2023-03 ~ 2023-11", "결제 장애가 잦았다", "Java로 결제 승인 API를 다시 설계했다", "장애가 줄었다"]) {
    expect(sent).toContain(value);
  }
  for (const hidden of ["E2", "미확인 경험", "요약만 경험", "제외한 경험", "57건", "사내 장애 보고서", "비밀메모", "혁신적인", "프론트엔드는 하지 않았다", "hr@ganada.example", "u1@example.com", "홍길동"]) {
    expect(sent).not.toContain(hidden);
  }
  for (const secret of [used, unconfirmed, summaryOnly, excluded, postingId, questionId, trackId, "u1"]) expect(sent).not.toContain(secret);
  expect(request.system).toBe(SELECT_SYSTEM);
  expect(request.system).not.toContain("결제 시스템 개편");
  expect(request.system).not.toContain("2026");
});

test("글자 수 제한이 없으면 '없음', 공고 분석이 없으면 요구 사항도 '없음'으로 보낸다", async () => {
  await addExperience();
  const sources = await listWritingSources(db, "u1", trackId);
  const ai = createFakeAi([reply({ picks: [] })]);
  await selectText(db, ai, "u1", { prompt: "문항", charLimit: null, postingText: "공고", requirements: [], sources, usedElsewhere: [] }, now);
  const text = ai.requests[0].messages[0].text;
  expect(text).toContain("[글자 수]\n없음");
  expect(text).toContain("[공고 요구 사항]\n없음");
});

test("확인된 사용 경험이 없으면 AI를 부르지 않고 noMatch로 저장한다", async () => {
  await addExperience({}, false); // 미확인
  const questionId = await addQuestion(await addPosting());
  const ai = createFakeAi([]);

  const result = await selectForQuestion(db, ai, "u1", questionId, now);

  expect(ai.requests).toHaveLength(0);
  const expected = { questionVersion: 0, picks: [], passed: [], noMatch: true, selectedAt: now.toISOString(), approved: null, approvedAt: null };
  expect(result).toEqual({ ok: true, value: expected });
  expect((await getQuestion(db, "u1", questionId))?.selection).toEqual(expected);
  expect(await db.select().from(aiUsage)).toHaveLength(0);
});

test("없는 별명은 버리고 별명을 실제 id와 버전으로 바꾼다", async () => {
  const first = await addExperience();
  const second = await addExperience({ name: "사내 교육 이수", startMonth: "2021-01", endMonth: "2021-02" });
  await updateExperience(db, "u1", second, { ...job, name: "사내 교육 이수", startMonth: "2021-01", endMonth: "2021-02", result: "이수했다" });
  await markConfirmed(second);
  const questionId = await addQuestion(await addPosting());
  const ai = createFakeAi([
    reply({
      picks: [
        { exp: "E9", overlap: "없는 경험", role: "없다" },
        { exp: "E2", overlap: "교육에서 Java를 배웠다", role: "교육을 받았다" },
        { exp: " E1 ", overlap: "결제 API를 설계했다", role: "API를 설계했다" },
        { exp: "E2", overlap: "같은 경험을 두 번 골랐다", role: "중복" },
      ],
      passed: [{ exp: "E7", whyNot: "없는 경험" }],
    }),
  ]);

  const result = await selectForQuestion(db, ai, "u1", questionId, now);

  expect(result.ok).toBe(true);
  if (!result.ok) return;
  // 후보 순서는 listWritingSources(시작 월 내림차순)를 따른다: E1 = 결제 시스템 개편, E2 = 사내 교육 이수
  expect(result.value.picks).toEqual([
    { experienceId: second, contentVersion: 1, overlap: "교육에서 Java를 배웠다", role: "교육을 받았다" },
    { experienceId: first, contentVersion: 0, overlap: "결제 API를 설계했다", role: "API를 설계했다" },
  ]);
  expect(result.value.passed).toEqual([]);
  expect(result.value).toMatchObject({ noMatch: false, questionVersion: 0, approved: null, approvedAt: null, selectedAt: now.toISOString() });
  expect((await getQuestion(db, "u1", questionId))?.selection).toEqual(result.value);
});

test("별명이 'E1 (경험 이름)'처럼 조금 달라도 고른 것으로 읽는다", async () => {
  const first = await addExperience();
  const questionId = await addQuestion(await addPosting());
  const ai = createFakeAi([
    reply({ picks: [{ exp: "E1 (결제 시스템 개편)", overlap: "결제 API를 설계했다", role: "API를 설계했다" }] }),
  ]);

  const result = await selectForQuestion(db, ai, "u1", questionId, now);

  if (!result.ok) throw new Error(result.reason);
  expect(result.value.picks.map((p) => p.experienceId)).toEqual([first]);
  expect(result.value.noMatch).toBe(false);
});

test("AI가 별명 대신 경험 이름을 적어도 고른 것으로 읽는다(picks와 passed)", async () => {
  const first = await addExperience();
  const second = await addExperience({ name: "사내 교육 이수", startMonth: "2021-01", endMonth: "2021-02" });
  await updateExperience(db, "u1", second, { ...job, name: "사내 교육 이수", startMonth: "2021-01", endMonth: "2021-02", result: "이수했다" });
  await markConfirmed(second);
  const questionId = await addQuestion(await addPosting());
  const ai = createFakeAi([
    reply({
      picks: [{ exp: "결제 시스템 개편", overlap: "결제 API를 설계했다", role: "API를 설계했다" }],
      passed: [{ exp: ' "사내 교육 이수" ', whyNot: "관계가 적다" }],
    }),
  ]);

  const result = await selectForQuestion(db, ai, "u1", questionId, now);

  if (!result.ok) throw new Error(result.reason);
  expect(result.value.picks.map((p) => p.experienceId)).toEqual([first]);
  expect(result.value.passed.map((p) => p.experienceId)).toEqual([second]);
  expect(result.value.noMatch).toBe(false);
});

test("picks는 3개까지, passed에서 고른 경험은 빠지고 5개까지", async () => {
  const ids: string[] = [];
  for (let i = 0; i < 10; i++) ids.push(await addExperience({ name: `경험 ${i}`, startMonth: `2020-${String(i + 1).padStart(2, "0")}` }));
  const questionId = await addQuestion(await addPosting());
  // 시작 월 내림차순이므로 E1이 가장 늦은 달
  const ai = createFakeAi([
    reply({
      picks: ["E1", "E2", "E3", "E4"].map((exp) => ({ exp, overlap: "겹친다", role: "했다" })),
      passed: ["E1", "E5", "E6", "E7", "E8", "E9", "E10", "E5"].map((exp) => ({ exp, whyNot: "덜 맞는다" })),
    }),
  ]);

  const result = await selectForQuestion(db, ai, "u1", questionId, now);

  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.value.picks.map((p) => p.experienceId)).toEqual([ids[9], ids[8], ids[7]]);
  expect(result.value.passed.map((p) => p.experienceId)).toEqual([ids[5], ids[4], ids[3], ids[2], ids[1]]);
});

test("overlap·role·whyNot에 기록에 없는 숫자가 있으면 그 칸을 비우고, 있는 숫자와 문항·공고의 숫자는 둔다", async () => {
  await addExperience();
  await addExperience({ name: "다른 경험", startMonth: "2022-01" });
  const questionId = await addQuestion(await addPosting(), "500자 이내로 3년 이상의 경험을 쓰세요");
  const ai = createFakeAi([
    reply({
      picks: [
        // 90은 어디에도 없다
        { exp: "E1", overlap: "장애를 90% 줄였다", role: "2023년에 Java로 설계했다" },
        // 3은 문항과 공고에, 2023은 경험의 기간에 있다. 57은 수치라 보내지 않았으므로 근거가 아니다
        { exp: "E2", overlap: "3년 이상의 경험과 겹친다", role: "월 장애 57건을 줄였다" },
      ],
      passed: [],
    }),
  ]);

  const result = await selectForQuestion(db, ai, "u1", questionId, now);

  expect(result.ok && result.value.picks.map((p) => [p.overlap, p.role])).toEqual([
    ["", "2023년에 Java로 설계했다"],
    ["3년 이상의 경험과 겹친다", ""],
  ]);
});

test("passed의 whyNot에 지어낸 숫자가 있으면 비운다", async () => {
  await addExperience();
  await addExperience({ name: "다른 경험", startMonth: "2022-01" });
  const questionId = await addQuestion(await addPosting());
  const ai = createFakeAi([reply({ passed: [{ exp: "E2", whyNot: "경력 8년이라 덜 맞는다" }] })]);

  const result = await selectForQuestion(db, ai, "u1", questionId, now);

  expect(result.ok && result.value.passed.map((p) => p.whyNot)).toEqual([""]);
});

test("overlap·role·whyNot은 다듬어서 300자까지 자른다", async () => {
  await addExperience();
  await addExperience({ name: "다른 경험", startMonth: "2022-01" });
  const questionId = await addQuestion(await addPosting());
  const ai = createFakeAi([
    reply({
      picks: [{ exp: "E1", overlap: `  ${"가".repeat(350)}  `, role: "나".repeat(310) }],
      passed: [{ exp: "E2", whyNot: "다".repeat(400) }],
    }),
  ]);

  const result = await selectForQuestion(db, ai, "u1", questionId, now);

  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.value.picks[0].overlap).toBe("가".repeat(300));
  expect(result.value.picks[0].role).toBe("나".repeat(300));
  expect(result.value.passed[0].whyNot).toBe("다".repeat(300));
});

test("300자 경계에서 이모지가 반으로 잘리지 않아 저장이 실패하지 않는다", async () => {
  await addExperience();
  const questionId = await addQuestion(await addPosting());
  const overlap = `${"가".repeat(299)}😀더`;
  const ai = createFakeAi([reply({ picks: [{ exp: "E1", overlap, role: "API를 설계했다" }] })]);

  const result = await selectForQuestion(db, ai, "u1", questionId, now);

  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect([...result.value.picks[0].overlap]).toHaveLength(300);
  expect(result.value.picks[0].overlap).toBe(`${"가".repeat(299)}😀`);
  expect((await getQuestion(db, "u1", questionId))?.selection?.picks[0].overlap).toBe(`${"가".repeat(299)}😀`);
});

test("고른 것이 하나도 없으면 noMatch", async () => {
  await addExperience();
  const questionId = await addQuestion(await addPosting());
  const ai = createFakeAi([reply({ picks: [{ exp: "E5", overlap: "없다", role: "없다" }] })]);

  const result = await selectForQuestion(db, ai, "u1", questionId, now);

  expect(result.ok && result.value).toMatchObject({ picks: [], noMatch: true });
});

test("다른 문항에서 승인한 경험이 [다른 문항에서 쓰기로 한 경험]에 별명으로 들어간다", async () => {
  const first = await addExperience();
  const second = await addExperience({ name: "사내 교육 이수", startMonth: "2021-01" });
  const postingId = await addPosting();
  const other = await addQuestion(postingId, "다른 문항");
  const target = await addQuestion(postingId, "이 문항");
  // 다른 문항에서 첫 경험과, 이제는 후보가 아닌 경험을 승인했다
  const picked = await selectForQuestion(db, createFakeAi([reply()]), "u1", other, now);
  if (!picked.ok) throw new Error("고르기 실패");
  const approved = [
    { experienceId: first, contentVersion: 0 },
    { experienceId: "gone-id", contentVersion: 0 },
  ];
  expect(await approveSelection(db, "u1", other, approved, picked.value, now)).toEqual({ ok: true });
  const ai = createFakeAi([reply({ picks: [{ exp: "E2", overlap: "교육", role: "교육을 받았다" }] })]);

  const result = await selectForQuestion(db, ai, "u1", target, now);

  const sent = ai.requests[0].messages[0].text;
  expect(sent).toContain("[다른 문항에서 쓰기로 한 경험]\nE1");
  expect(sent).not.toContain("gone-id");
  expect(result.ok && result.value.picks[0].experienceId).toBe(second);
});

test("AI가 답하는 사이 문항 글을 고치면 changed이고 저장하지 않는다", async () => {
  await addExperience();
  const questionId = await addQuestion(await addPosting());
  const ai = createFakeAi([
    async () => {
      await updateQuestion(db, "u1", questionId, { prompt: "고친 문항", charLimit: 500, countSpaces: true });
      return reply();
    },
  ]);

  const result = await selectForQuestion(db, ai, "u1", questionId, now);

  expect(result).toEqual({ ok: false, reason: "changed" });
  expect((await getQuestion(db, "u1", questionId))?.selection).toBeNull();
});

test("지원이 아닌 공고는 not_apply, 남의 문항은 not_found이고 둘 다 AI를 부르지 않는다", async () => {
  await addExperience();
  const postingId = await addPosting();
  const questionId = await addQuestion(postingId);
  await setStatus(db, "u1", postingId, "hold");
  const ai = createFakeAi([]);

  expect(await selectForQuestion(db, ai, "u1", questionId, now)).toEqual({ ok: false, reason: "not_apply" });
  expect(await selectForQuestion(db, ai, "u2", questionId, now)).toEqual({ ok: false, reason: "not_found" });
  expect(await selectForQuestion(db, ai, "u1", "없는-문항", now)).toEqual({ ok: false, reason: "not_found" });
  expect(ai.requests).toHaveLength(0);
});

test("사용량이 application_select로 기록된다", async () => {
  await addExperience();
  const questionId = await addQuestion(await addPosting());
  await selectForQuestion(db, createFakeAi([reply()]), "u1", questionId, now);
  expect((await db.select().from(aiUsage)).map((row) => [row.purpose, row.userId])).toEqual([["application_select", "u1"]]);
});

test("AI 실패(refused·invalid)와 한도(over_limit)를 그대로 돌려주고 저장하지 않는다", async () => {
  await addExperience();
  const questionId = await addQuestion(await addPosting());
  expect(await selectForQuestion(db, createFakeAi([{ fail: "refused" }]), "u1", questionId, now)).toEqual({ ok: false, reason: "refused" });
  expect(await selectForQuestion(db, createFakeAi([{ picks: "틀린 모양" }]), "u1", questionId, now)).toEqual({ ok: false, reason: "invalid" });
  process.env.AI_MONTHLY_LIMIT_USD = "0";
  const ai = createFakeAi([]);
  expect(await selectForQuestion(db, ai, "u1", questionId, now)).toEqual({ ok: false, reason: "over_limit" });
  expect(ai.requests).toHaveLength(0);
  expect((await getQuestion(db, "u1", questionId))?.selection).toBeNull();
});

test("describeSource는 수치·하지 않은 것·금지 표현을 withMetrics일 때만 붙인다", async () => {
  await addExperience();
  const [source] = await listWritingSources(db, "u1", trackId);
  const plain = describeSource("E1", source, false);
  expect(plain).toContain("- 결과: 장애가 줄었다");
  for (const hidden of ["수치", "57건", "하지 않은 것", "프론트엔드", "혁신적인"]) expect(plain).not.toContain(hidden);
  const full = describeSource("E1", source, true);
  expect(full).toContain("- 수치: 월 장애 57건에서 9건 (기준: 사내 장애 보고서)");
  expect(full).toContain("- 하지 않은 것: 프론트엔드는 하지 않았다");
  expect(full).toContain("- 쓰면 안 되는 표현: 혁신적인");
  const bare = describeSource("E1", { ...source, metrics: [{ text: "처리 시간 20% 단축", basis: null }], bannedPhrases: [], notDone: null }, true);
  expect(bare).toContain("- 수치: 처리 시간 20% 단축 (기준: 없음)");
  expect(bare).toContain("- 쓰면 안 되는 표현: 없음");
  expect(describeSource("E1", { ...source, metrics: [] }, true)).toContain("- 수치: 없음");
});

test("selectText는 저장하지 않고 입력 그대로 고른다", async () => {
  await addExperience();
  const sources = await listWritingSources(db, "u1", trackId);
  const input: SelectInput = { prompt: "문항", charLimit: null, postingText: "공고", requirements: [], sources, usedElsewhere: [] };
  const result = await selectText(db, createFakeAi([reply()]), "u1", input, now);
  expect(result.ok && result.value.picks.map((p) => p.experienceId)).toEqual([sources[0].id]);
});
