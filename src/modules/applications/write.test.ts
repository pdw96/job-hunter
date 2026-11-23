import { eq } from "drizzle-orm";
import { beforeEach, expect, test, vi } from "vitest";
import { createTestDb } from "@/db/test-db";
import type { Db } from "@/db/types";
import { createFakeAi } from "@/modules/ai/fake-client";
import { aiUsage } from "@/modules/ai/schema";
import { user } from "@/modules/auth/schema";
import type { ExperienceInput } from "@/modules/experiences/input";
import { confirmExperience, createExperience, setTrackScope, unconfirmExperience, updateExperience } from "@/modules/experiences/repo";
import { experiences } from "@/modules/experiences/schema";
import type { AppliedScore, PostingAnalysis } from "@/modules/postings/analysis";
import { validatePosting } from "@/modules/postings/input";
import { applyToPosting, createPosting, getPosting, saveAnalysis, setStatus } from "@/modules/postings/repo";

import { createTrack } from "@/modules/tracks/repo";
import type { SurveyInput } from "@/modules/tracks/survey";
import { listWritingSources } from "@/modules/experiences/writing";
import { createAnswer } from "./answers-repo";
import type { QuestionKind } from "./options";
import { addQuestions, approveSelection, attachAnswer, detachAnswer, getQuestion, saveSelection, setQuestionKinds, updateQuestion } from "./repo";
import { answers as answersTable, questions as questionsTable } from "./schema";
import { reopenPosting, submitPosting } from "./submit";
import { checkDraft } from "./check";
import { REVISE_SYSTEM, WRITE_SYSTEM } from "./prompts";
import { selectForQuestion } from "./select";
import type { Draft } from "./types";
import { approveAndWrite, editParagraph, reviseParagraph, writeManually, writeText } from "./write";

// 이 파일의 예시는 옛 표(createExperience)로 원천을 만든다. 스위치(newRecordsOn)는 5-4부터 늘 켜져 있으므로
// 원천 읽기(sources.ts)를 옛 표로 고정한다(자소서·이력서 로직은 원천 모양만 본다)
// 옛 표를 지우는 계획에서 예시를 새 표로 옮기고 이 모의를 걷어 낸다
vi.mock("@/modules/experiences/switch", () => ({ newRecordsOn: () => false }));

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


const writeReply = (over: Record<string, unknown> = {}) => ({
  paragraphs: [
    { text: "결제 승인 API를 Java로 다시 설계했습니다.", sources: ["E1"] },
    { text: "그 결과 장애가 줄었습니다.", sources: ["E1"] },
  ],
  shortage: "",
  ...over,
});
const selectReply = { picks: [{ exp: "E1", overlap: "겹친다", role: "API를 설계했다" }], passed: [], kinds: ["experience"], topics: [] };

// 문항을 만들고 고르기까지 해 둔다
async function ready(extra: Partial<ExperienceInput> = {}) {
  const expId = await addExperience(extra);
  const questionId = await addQuestion(await addPosting());
  const r = await selectForQuestion(db, createFakeAi([selectReply]), "u1", questionId, now);
  if (!r.ok) throw new Error(r.reason);
  return { expId, questionId };
}

async function written(extra: Partial<ExperienceInput> = {}) {
  const base = await ready(extra);
  const result = await approveAndWrite(db, createFakeAi([writeReply()]), "u1", base.questionId, [base.expId], now);
  if (!result.ok) throw new Error(result.reason);
  return { ...base, draft: result.value };
}

test("쓰기에는 승인한 경험만 가고, 승인하지 않은 경험·증빙 메모·실제 id가 없으며, 수치는 충족인 경험의 것만 간다", async () => {
  const { expId, questionId } = await ready();
  const other = await addExperience({ name: "승인 안 한 경험", startMonth: "2020-01", metrics: [{ text: "비밀수치 99건", basis: "기준" }] });
  const noMetric = await addExperience({ name: "수치 미달 경험", startMonth: "2019-01", metrics: [{ text: "미달수치 77건", basis: "기준" }] });
  await db
    .update(experiences)
    .set({ rubric: { period: { status: "met", note: null }, role: { status: "met", note: null }, level: { status: "met", note: null }, metrics: { status: "unmet", note: "x" }, evidence: { status: "unjudged", note: null } } })
    .where(eq(experiences.id, noMetric));
  await confirmExperience(db, "u1", noMetric);
  const ai = createFakeAi([writeReply()]);

  const result = await approveAndWrite(db, ai, "u1", questionId, [expId, noMetric], now);

  expect(result.ok).toBe(true);
  const request = ai.requests[0];
  expect(request).toMatchObject({ purpose: "application_write", effort: "medium", maxTokens: 16000 });
  expect(request.system).toBe(WRITE_SYSTEM);
  const sent = request.messages[0].text;
  expect(sent).toContain("[문항]\n지원 동기와 관련 경험을 쓰세요");
  expect(sent).toContain("[글자 수]\n500자 이내(공백 포함)");
  expect(sent).toContain("[공고]\n가나다 주식회사 백엔드 개발자 채용");
  expect(sent).toContain("고객 문제를 끝까지 파고드는 사람");
  expect(sent).toContain("[경험 기록]\nE");
  expect(sent).toContain("수치: 월 장애 57건에서 9건 (기준: 사내 장애 보고서)");
  expect(sent).toContain("하지 않은 것: 프론트엔드는 하지 않았다");
  expect(sent).toContain("쓰면 안 되는 표현: 혁신적인");
  expect(sent).toContain("수치 미달 경험");
  for (const hidden of ["승인 안 한 경험", "비밀수치", "미달수치", "비밀메모", "hr@ganada.example", "u1@example.com", "홍길동", "E3"]) {
    expect(sent).not.toContain(hidden);
  }
  for (const secret of [expId, other, noMetric, questionId, trackId, "u1"]) expect(sent).not.toContain(secret);
  const q = await getQuestion(db, "u1", questionId);
  expect(q?.selection?.approved).toEqual([
    { experienceId: expId, contentVersion: 0 },
    { experienceId: noMetric, contentVersion: 0 },
  ]);
  expect(q?.selection?.approvedAt).toBe(now.toISOString());
  const rows = await db.select().from(aiUsage);
  expect(rows.map((r) => r.purpose)).toEqual(["application_select", "application_write"]);
});

test("글자 수 기준과 제한 없음이 글에 적힌다", async () => {
  await addExperience();
  const sources = await listWritingSources(db, "u1", trackId);
  const ai = createFakeAi([writeReply(), writeReply()]);
  await writeText(db, ai, "u1", { prompt: "문항", charLimit: 300, countSpaces: false, postingText: "공고", sources, kinds: ["experience"], answers: [], unanswered: [] }, now);
  await writeText(db, ai, "u1", { prompt: "문항", charLimit: null, countSpaces: true, postingText: "공고", sources, kinds: ["experience"], answers: [], unanswered: [] }, now);
  expect(ai.requests[0].messages[0].text).toContain("[글자 수]\n300자 이내(공백 제외)");
  expect(ai.requests[1].messages[0].text).toContain("[글자 수]\n제한 없음");
});

test("쓴 답이 저장된다: 문단의 근거는 실제 id, 기반 경험과 문항 버전이 남는다", async () => {
  const { expId, questionId, draft } = await written();
  expect(draft).toEqual({
    questionVersion: 0,
    basedOn: [{ experienceId: expId, contentVersion: 0 }],
    paragraphs: [
      { text: "결제 승인 API를 Java로 다시 설계했습니다.", sources: [expId], answers: [], edited: false },
      { text: "그 결과 장애가 줄었습니다.", sources: [expId], answers: [], edited: false },
    ],
    shortage: "",
    answers: [],
    writtenAt: now.toISOString(),
  });
  expect((await getQuestion(db, "u1", questionId))?.draft).toEqual(draft);
});

test("화면이 보낸 id 중 쓸 수 없는 경험(부분 확인, 남의 것, 요약만)은 버리고, 남은 것이 없으면 none_selected이고 AI를 부르지 않는다", async () => {
  const { expId, questionId } = await ready();
  const partial = await addExperience({ name: "부분 확인", startMonth: "2020-01" }, false);
  const summary = await addExperience({ name: "요약만", startMonth: "2019-01" });
  await setTrackScope(db, "u1", summary, trackId, "summary");
  const theirs = await createExperience(db, "u2", job);
  const ai = createFakeAi([writeReply()]);

  const none = await approveAndWrite(db, ai, "u1", questionId, [partial, summary, theirs, "없는-id"], now);
  expect(none).toEqual({ ok: false, reason: "none_selected" });
  expect(ai.requests).toHaveLength(0);
  expect((await getQuestion(db, "u1", questionId))?.selection?.approved).toBeNull();

  const some = await approveAndWrite(db, ai, "u1", questionId, [partial, expId, expId, theirs], now);
  expect(some.ok && some.value.basedOn).toEqual([{ experienceId: expId, contentVersion: 0 }]);
});

test("쓸 수 있는 경험을 5개까지만 받고, 넘으면 too_many_selected이며 AI를 부르지 않는다. 고르기 후보 밖의 경험도 쓸 수 있으면 받는다", async () => {
  const ids: string[] = [];
  for (let i = 0; i < 6; i++) ids.push(await addExperience({ name: `경험 ${i}`, startMonth: `2020-0${i + 1}` }));
  const questionId = await addQuestion(await addPosting());
  await selectForQuestion(db, createFakeAi([selectReply]), "u1", questionId, now);
  const ai = createFakeAi([writeReply()]);

  // 같은 id 반복과 쓸 수 없는 id는 세지 않는다
  const over = await approveAndWrite(db, ai, "u1", questionId, [...ids, ids[0], "없는-id"], now);
  expect(over).toEqual({ ok: false, reason: "too_many_selected" });
  expect(ai.requests).toHaveLength(0);
  expect((await getQuestion(db, "u1", questionId))?.selection?.approved).toBeNull();

  const five = [...ids].reverse().slice(0, 5);
  const result = await approveAndWrite(db, ai, "u1", questionId, [...five, five[0], "없는-id"], now);
  expect(result.ok && result.value.basedOn.map((r) => r.experienceId)).toEqual(five);
});

test("고르기 전(selection 없음)이면 changed, 남의 문항은 not_found, 지원이 아니면 not_apply이고 AI를 부르지 않는다", async () => {
  const expId = await addExperience();
  const postingId = await addPosting();
  const questionId = await addQuestion(postingId);
  const ai = createFakeAi([writeReply()]);

  expect(await approveAndWrite(db, ai, "u1", questionId, [expId], now)).toEqual({ ok: false, reason: "changed" });
  expect(await approveAndWrite(db, ai, "u2", questionId, [expId], now)).toEqual({ ok: false, reason: "not_found" });
  await selectForQuestion(db, createFakeAi([selectReply]), "u1", questionId, now);
  await setStatus(db, "u1", postingId, "hold");
  expect(await approveAndWrite(db, ai, "u1", questionId, [expId], now)).toEqual({ ok: false, reason: "not_apply" });
  expect(ai.requests).toHaveLength(0);
});

test("없는 별명의 근거는 버리고 같은 별명은 한 번만 쓴다. 근거가 없는 문단은 남아 검사에 걸린다", async () => {
  const { expId, questionId } = await ready();
  const ai = createFakeAi([
    writeReply({
      paragraphs: [
        { text: "  첫 문단  ", sources: ["E9", " E1 ", "E1"] },
        { text: "근거 없는 다짐입니다.", sources: [] },
        { text: "없는 별명만", sources: ["E4"] },
      ],
    }),
  ]);
  const result = await approveAndWrite(db, ai, "u1", questionId, [expId], now);
  expect(result.ok && result.value.paragraphs.map((p) => [p.text, p.sources])).toEqual([
    ["첫 문단", [expId]],
    ["근거 없는 다짐입니다.", []],
    ["없는 별명만", []],
  ]);
});

test("문단의 근거에 별명 대신 경험 이름이 있어도 실제 id로 바꾼다", async () => {
  const { expId, questionId } = await ready();
  const ai = createFakeAi([writeReply({ paragraphs: [{ text: "첫 문단", sources: ["결제 시스템 개편", ' "결제 시스템 개편" ', "없는 경험"] }] })]);
  const result = await approveAndWrite(db, ai, "u1", questionId, [expId], now);
  expect(result.ok && result.value.paragraphs.map((p) => [p.text, p.sources])).toEqual([["첫 문단", [expId]]]);
});

test("빈 문단은 버리고 문단은 10개까지, 문단은 2000자까지, shortage는 500자까지", async () => {
  const { expId, questionId } = await ready();
  const paragraphs = [
    { text: "   ", sources: ["E1"] },
    ...Array.from({ length: 12 }, (_, i) => ({ text: `문단 ${i}`, sources: ["E1"] })),
  ];
  paragraphs[1] = { text: "가".repeat(2100), sources: ["E1"] };
  const ai = createFakeAi([writeReply({ paragraphs, shortage: ` ${"나".repeat(600)} ` })]);
  const result = await approveAndWrite(db, ai, "u1", questionId, [expId], now);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.value.paragraphs).toHaveLength(10);
  expect(result.value.paragraphs[0].text).toBe("가".repeat(2000));
  expect(result.value.paragraphs[1].text).toBe("문단 1");
  expect(result.value.shortage).toBe("나".repeat(500));
});

test("반목표: 기록에 없는 숫자, 금지 표현, 근거 없는 문단을 쓴 답은 저장된 뒤 checkDraft가 셋 다 표시한다", async () => {
  const { expId, questionId } = await ready();
  const ai = createFakeAi([
    writeReply({
      paragraphs: [
        { text: "장애를 90% 줄였습니다.", sources: ["E1"] },
        { text: "혁신적인 방식으로 설계했습니다.", sources: ["E1"] },
        { text: "앞으로도 열심히 하겠습니다.", sources: [] },
      ],
    }),
  ]);
  const result = await approveAndWrite(db, ai, "u1", questionId, [expId], now);
  expect(result.ok).toBe(true); // 검사에 걸려도 저장은 막지 않는다
  const q = await getQuestion(db, "u1", questionId);
  const sources = await listWritingSources(db, "u1", trackId);
  const check = checkDraft(q!.draft!, q!, sources);
  expect(check.paragraphs[0].ungrounded).toEqual(["90"]);
  expect(check.paragraphs[1].banned).toEqual(["혁신적인"]);
  expect(check.paragraphs[2].noSource).toBe(true);
});

// 규칙: 요청한 id 중 이미 승인한 것이 지금 목록에 없거나 버전이 다르면 stale(AI 없음).
// 다른 id 묶음을 보내면 새 승인이다(지금 버전으로)
test("승인한 경험을 고친 뒤 같은 경험으로 다시 쓰면 stale이고 AI를 부르지 않는다", async () => {
  const { expId, questionId } = await written();
  await updateExperience(db, "u1", expId, { ...job, result: "장애가 크게 줄었다" });
  const ai = createFakeAi([writeReply()]);

  const result = await approveAndWrite(db, ai, "u1", questionId, [expId], now);

  expect(result).toEqual({ ok: false, reason: "stale" });
  expect(ai.requests).toHaveLength(0);
});

test("트랙에서 요약만으로 바꿔도, 승인했던 경험을 다시 보내면 stale이다", async () => {
  const { expId, questionId } = await written();
  await setTrackScope(db, "u1", expId, trackId, "summary");
  const ai = createFakeAi([writeReply()]);
  expect(await approveAndWrite(db, ai, "u1", questionId, [expId], now)).toEqual({ ok: false, reason: "stale" });
  expect(ai.requests).toHaveLength(0);
});

test("다른 경험으로 다시 승인하면 새 승인이고, 같은 경험이면 승인을 다시 하지 않고 쓴다", async () => {
  const { expId, questionId } = await written();
  const second = await addExperience({ name: "두 번째 경험", startMonth: "2020-01" });
  await updateExperience(db, "u1", expId, { ...job, result: "장애가 크게 줄었다" });
  const ai = createFakeAi([writeReply(), writeReply()]);

  // 고친 경험은 보내지 않고 다른 경험만 보낸다: 새 승인
  const fresh = await approveAndWrite(db, ai, "u1", questionId, [second], new Date("2026-11-18T04:00:00Z"));
  expect(fresh.ok && fresh.value.basedOn).toEqual([{ experienceId: second, contentVersion: 0 }]);
  expect((await getQuestion(db, "u1", questionId))?.selection?.approvedAt).toBe("2026-11-18T04:00:00.000Z");

  // 같은 경험으로 다시 쓰기: approvedAt이 그대로다
  const again = await approveAndWrite(db, ai, "u1", questionId, [second], new Date("2026-11-18T05:00:00Z"));
  expect(again.ok).toBe(true);
  expect((await getQuestion(db, "u1", questionId))?.selection?.approvedAt).toBe("2026-11-18T04:00:00.000Z");
});

test("쓰는 사이 다시 고르면 changed이고 답을 저장하지 않는다", async () => {
  const { expId, questionId } = await ready();
  const ai = createFakeAi([
    async () => {
      await saveSelection(db, "u1", questionId, { questionVersion: 0, picks: [], passed: [], noMatch: true, selectedAt: now.toISOString(), approved: null, approvedAt: null });
      return writeReply();
    },
  ]);
  const result = await approveAndWrite(db, ai, "u1", questionId, [expId], now);
  expect(result).toEqual({ ok: false, reason: "changed" });
  expect((await getQuestion(db, "u1", questionId))?.draft).toBeNull();
});

test("다시 쓰는 사이 문단을 직접 고치면 changed이고 직접 고친 글이 남는다", async () => {
  const { expId, questionId, draft } = await written();
  const ai = createFakeAi([
    async () => {
      const edited = await editParagraph(db, "u1", questionId, 0, "직접 고친 글", draft, now);
      expect(edited.ok).toBe(true);
      return writeReply();
    },
  ]);
  const result = await approveAndWrite(db, ai, "u1", questionId, [expId], now);
  expect(result).toEqual({ ok: false, reason: "changed" });
  const stored = (await getQuestion(db, "u1", questionId))?.draft;
  expect(stored?.paragraphs[0]).toMatchObject({ text: "직접 고친 글", edited: true });
});

test("쓰는 사이 문항 글을 고치면 changed이고 저장하지 않는다", async () => {
  const { expId, questionId } = await ready();
  const ai = createFakeAi([
    async () => {
      await updateQuestion(db, "u1", questionId, { prompt: "다른 문항", charLimit: 500, countSpaces: true });
      return writeReply();
    },
  ]);
  const result = await approveAndWrite(db, ai, "u1", questionId, [expId], now);
  expect(result).toEqual({ ok: false, reason: "changed" });
  expect((await getQuestion(db, "u1", questionId))?.draft).toBeNull();
});

test("AI 실패는 그대로 돌려주고 저장하지 않는다", async () => {
  const { expId, questionId } = await ready();
  const result = await approveAndWrite(db, createFakeAi([{ fail: "invalid" }]), "u1", questionId, [expId], now);
  expect(result).toEqual({ ok: false, reason: "invalid" });
  expect((await getQuestion(db, "u1", questionId))?.draft).toBeNull();
});

const reviseReply = { text: "더 짧게 고친 문단입니다.", sources: ["E1"] };

test("부분 수정은 그 문단만 바꾸고 다른 문단은 그대로이며, 승인한 경험과 현재 답이 AI에 간다", async () => {
  const { expId, questionId, draft } = await written();
  const ai = createFakeAi([reviseReply]);

  const result = await reviseParagraph(db, ai, "u1", questionId, 1, { preset: "shorter", note: "  숫자는 빼 주세요  " }, draft, now);

  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.value.paragraphs[0]).toEqual(draft.paragraphs[0]);
  expect(result.value.paragraphs[1]).toEqual({ text: "더 짧게 고친 문단입니다.", sources: [expId], answers: [], edited: false });
  expect(result.value.basedOn).toEqual(draft.basedOn);
  expect((await getQuestion(db, "u1", questionId))?.draft).toEqual(result.value);
  const request = ai.requests[0];
  expect(request).toMatchObject({ purpose: "application_revise", effort: "low", maxTokens: 8000 });
  expect(request.system).toBe(REVISE_SYSTEM);
  const sent = request.messages[0].text;
  expect(sent).toContain("[지금 답]\n결제 승인 API를 Java로 다시 설계했습니다.\n그 결과 장애가 줄었습니다.");
  expect(sent).toContain("[고칠 문단]\n그 결과 장애가 줄었습니다.");
  expect(sent).toContain("[요청]\n더 짧게\n숫자는 빼 주세요");
  expect(sent).toContain("수치: 월 장애 57건에서 9건");
  for (const secret of [expId, questionId, "비밀메모", "u1@example.com"]) expect(sent).not.toContain(secret);
  expect((await db.select().from(aiUsage)).map((r) => r.purpose)).toContain("application_revise");
});

test("부분 수정의 요청 문구와 note 200자 제한", async () => {
  const { questionId, draft } = await written();
  const ai = createFakeAi([reviseReply, reviseReply]);
  await reviseParagraph(db, ai, "u1", questionId, 0, { preset: "concrete", note: "" }, draft, now);
  expect(ai.requests[0].messages[0].text).toContain("[요청]\n더 구체적으로(기록에 있는 내용 안에서)");
  const after = (await getQuestion(db, "u1", questionId))!.draft!;
  await reviseParagraph(db, ai, "u1", questionId, 0, { preset: null, note: "가".repeat(250) }, after, now);
  expect(ai.requests[1].messages[0].text).toContain(`[요청]\n${"가".repeat(200)}`);
  expect(ai.requests[1].messages[0].text).not.toContain("가".repeat(201));
});

test("preset도 note도 없으면 empty_request이고 AI를 부르지 않는다", async () => {
  const { questionId, draft } = await written();
  const ai = createFakeAi([reviseReply]);
  expect(await reviseParagraph(db, ai, "u1", questionId, 0, { preset: null, note: "   " }, draft, now)).toEqual({ ok: false, reason: "empty_request" });
  expect(ai.requests).toHaveLength(0);
});

test("부분 수정 중 다른 탭에서 직접 고치면 changed이고 저장하지 않는다", async () => {
  const { questionId, draft } = await written();
  const ai = createFakeAi([
    async () => {
      await editParagraph(db, "u1", questionId, 0, "직접 고친 글", draft, now);
      return reviseReply;
    },
  ]);
  const result = await reviseParagraph(db, ai, "u1", questionId, 1, { preset: "natural", note: "" }, draft, now);
  expect(result).toEqual({ ok: false, reason: "changed" });
  expect((await getQuestion(db, "u1", questionId))?.draft?.paragraphs[0].text).toBe("직접 고친 글");
});

test("부분 수정: 읽은 답과 다르면(expected) changed, 범위 밖 문단은 changed, 지원이 아니면 not_apply, 남의 문항은 not_found, 모두 AI 없음", async () => {
  const { questionId, draft } = await written();
  const ai = createFakeAi([reviseReply]);
  const stale: Draft = { ...draft, shortage: "다른 값" };
  expect(await reviseParagraph(db, ai, "u1", questionId, 0, { preset: "shorter", note: "" }, stale, now)).toEqual({ ok: false, reason: "changed" });
  expect(await reviseParagraph(db, ai, "u1", questionId, 5, { preset: "shorter", note: "" }, draft, now)).toEqual({ ok: false, reason: "changed" });
  expect(await reviseParagraph(db, ai, "u1", questionId, -1, { preset: "shorter", note: "" }, draft, now)).toEqual({ ok: false, reason: "changed" });
  expect(await reviseParagraph(db, ai, "u2", questionId, 0, { preset: "shorter", note: "" }, draft, now)).toEqual({ ok: false, reason: "not_found" });
  const q = await getQuestion(db, "u1", questionId);
  await setStatus(db, "u1", q!.postingId, "hold");
  expect(await reviseParagraph(db, ai, "u1", questionId, 0, { preset: "shorter", note: "" }, draft, now)).toEqual({ ok: false, reason: "not_apply" });
  expect(ai.requests).toHaveLength(0);
});

test("부분 수정: 승인한 경험이 바뀌었으면 stale이고 AI를 부르지 않는다", async () => {
  const { expId, questionId, draft } = await written();
  await updateExperience(db, "u1", expId, { ...job, result: "바뀐 결과" });
  const ai = createFakeAi([reviseReply]);
  expect(await reviseParagraph(db, ai, "u1", questionId, 0, { preset: "shorter", note: "" }, draft, now)).toEqual({ ok: false, reason: "stale" });
  expect(ai.requests).toHaveLength(0);
});

test("부분 수정의 답도 같은 검사를 거친다: 없는 별명은 버리고 빈 글은 invalid", async () => {
  const { questionId, draft } = await written();
  const bad = await reviseParagraph(db, createFakeAi([{ text: "  ", sources: ["E1"] }]), "u1", questionId, 0, { preset: "shorter", note: "" }, draft, now);
  expect(bad).toEqual({ ok: false, reason: "invalid" });
  const ok = await reviseParagraph(db, createFakeAi([{ text: "고쳤다", sources: ["E8"] }]), "u1", questionId, 0, { preset: "shorter", note: "" }, draft, now);
  expect(ok.ok && ok.value.paragraphs[0]).toEqual({ text: "고쳤다", sources: [], answers: [], edited: false });
});

test("직접 고친 문단은 edited가 되고 sources는 남는다. 다른 문단은 그대로", async () => {
  const { expId, questionId, draft } = await written();
  const result = await editParagraph(db, "u1", questionId, 0, "  내가 쓴 글  ", draft, now);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.value.paragraphs).toEqual([
    { text: "내가 쓴 글", sources: [expId], answers: [], edited: true },
    draft.paragraphs[1],
  ]);
  expect((await getQuestion(db, "u1", questionId))?.draft).toEqual(result.value);
});

test("직접 고친 글이 비면 그 문단을 지운다", async () => {
  const { questionId, draft } = await written();
  const result = await editParagraph(db, "u1", questionId, 0, "   ", draft, now);
  expect(result.ok && result.value.paragraphs).toEqual([draft.paragraphs[1]]);
});

test("다시 쓴 답의 문단이 모두 비면 invalid이고 있던 답을 지우지 않는다", async () => {
  const { expId, questionId, draft } = await written();
  const ai = createFakeAi([writeReply({ paragraphs: [{ text: "  ", sources: ["E1"] }] })]);
  const result = await approveAndWrite(db, ai, "u1", questionId, [expId], now);
  expect(result).toEqual({ ok: false, reason: "invalid" });
  expect((await getQuestion(db, "u1", questionId))?.draft).toEqual(draft);
  const none = await approveAndWrite(db, createFakeAi([writeReply({ paragraphs: [] })]), "u1", questionId, [expId], now);
  expect(none).toEqual({ ok: false, reason: "invalid" });
  expect((await getQuestion(db, "u1", questionId))?.draft).toEqual(draft);
});

test("마지막 문단을 지워 답이 비어도 직접 쓰기로 다시 쓸 수 있다", async () => {
  const { questionId, draft } = await written({});
  const one = await editParagraph(db, "u1", questionId, 1, "", draft, now);
  if (!one.ok) throw new Error(one.reason);
  const empty = await editParagraph(db, "u1", questionId, 0, "", one.value, now);
  expect(empty.ok && empty.value.paragraphs).toEqual([]);
  const result = await writeManually(db, "u1", questionId, "새로 쓴 글", now);
  expect(result.ok && result.value.paragraphs.map((p) => p.text)).toEqual(["새로 쓴 글"]);
});

test("직접 고치기: 2000자를 넘으면 too_long, 지금 답이 다르면 changed, 범위 밖이면 changed, 남의 문항은 not_found", async () => {
  const { questionId, draft } = await written();
  expect(await editParagraph(db, "u1", questionId, 0, "가".repeat(2001), draft, now)).toEqual({ ok: false, reason: "too_long" });
  expect((await editParagraph(db, "u1", questionId, 0, "가".repeat(2000), draft, now)).ok).toBe(true);
  expect(await editParagraph(db, "u1", questionId, 1, "또 고침", draft, now)).toEqual({ ok: false, reason: "changed" });
  const current = (await getQuestion(db, "u1", questionId))!.draft!;
  expect(await editParagraph(db, "u1", questionId, 9, "범위 밖", current, now)).toEqual({ ok: false, reason: "changed" });
  expect(await editParagraph(db, "u2", questionId, 0, "남의 것", current, now)).toEqual({ ok: false, reason: "not_found" });
});

test("승인한 경험의 확인을 풀고 같은 경험으로 다시 쓰면 stale이고 AI를 부르지 않는다", async () => {
  const { expId, questionId } = await written();
  await unconfirmExperience(db, "u1", expId);
  const ai = createFakeAi([writeReply()]);
  expect(await approveAndWrite(db, ai, "u1", questionId, [expId], now)).toEqual({ ok: false, reason: "stale" });
  expect(ai.requests).toHaveLength(0);
});

test("1999자 뒤에 이모지가 오는 문단도 코드 포인트 2000자 안으로 저장된다", async () => {
  const { expId, questionId } = await ready();
  const ai = createFakeAi([writeReply({ paragraphs: [{ text: `${"가".repeat(1999)}😀뒤에 더 있는 글`, sources: ["E1"] }], shortage: `${"나".repeat(499)}😀더` })]);
  const result = await approveAndWrite(db, ai, "u1", questionId, [expId], now);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect([...result.value.paragraphs[0].text]).toHaveLength(2000);
  expect(result.value.paragraphs[0].text.endsWith("😀")).toBe(true);
  expect([...result.value.shortage]).toHaveLength(500);
});

test("직접 고치기: 지원이 아니면 not_apply이고 답은 그대로다", async () => {
  const { questionId, draft } = await written();
  const q = await getQuestion(db, "u1", questionId);
  await setStatus(db, "u1", q!.postingId, "hold");
  expect(await editParagraph(db, "u1", questionId, 0, "고친 글", draft, now)).toEqual({ ok: false, reason: "not_apply" });
  expect((await getQuestion(db, "u1", questionId))?.draft).toEqual(draft);
});

test("직접 쓰기: 빈 줄로 문단을 나눠 직접 쓴 문단으로 저장하고, 승인한 경험을 basedOn으로 하며 AI를 부르지 않는다", async () => {
  const { expId, questionId } = await ready();
  const selected = (await getQuestion(db, "u1", questionId))!.selection!;
  await approveSelection(db, "u1", questionId, [{ experienceId: expId, contentVersion: 0 }], selected, now);
  const ai = createFakeAi([]);

  const result = await writeManually(db, "u1", questionId, "  첫 문단입니다.\n\n\n둘째 문단\n이어지는 줄\n \n셋째 문단  ", now);

  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.value).toEqual({
    questionVersion: 0,
    basedOn: [{ experienceId: expId, contentVersion: 0 }],
    paragraphs: [
      { text: "첫 문단입니다.", sources: [], edited: true },
      { text: "둘째 문단\n이어지는 줄", sources: [], edited: true },
      { text: "셋째 문단", sources: [], edited: true },
    ],
    shortage: "",
    writtenAt: now.toISOString(),
  });
  expect((await getQuestion(db, "u1", questionId))?.draft).toEqual(result.value);
  expect(ai.requests).toHaveLength(0);
});

test("직접 쓰기: 고르기 전에도 쓸 수 있고 basedOn은 빈 배열이다", async () => {
  const questionId = await addQuestion(await addPosting());
  const result = await writeManually(db, "u1", questionId, "그냥 쓴 글", now);
  expect(result.ok && result.value.basedOn).toEqual([]);
});

test("직접 쓰기: 이미 답이 있으면 changed이고 답을 덮어쓰지 않는다", async () => {
  const { questionId, draft } = await written();
  expect(await writeManually(db, "u1", questionId, "새로 쓴 글", now)).toEqual({ ok: false, reason: "changed" });
  expect((await getQuestion(db, "u1", questionId))?.draft).toEqual(draft);
});

test("직접 쓰기: 지원이 아니면 not_apply, 없거나 남의 문항이면 not_found", async () => {
  const questionId = await addQuestion(await addPosting());
  expect(await writeManually(db, "u2", questionId, "글", now)).toEqual({ ok: false, reason: "not_found" });
  expect(await writeManually(db, "u1", "없는-문항", "글", now)).toEqual({ ok: false, reason: "not_found" });
  const q = await getQuestion(db, "u1", questionId);
  await setStatus(db, "u1", q!.postingId, "hold");
  expect(await writeManually(db, "u1", questionId, "글", now)).toEqual({ ok: false, reason: "not_apply" });
  expect((await getQuestion(db, "u1", questionId))?.draft).toBeNull();
});

test("직접 쓰기: 빈 글은 empty, 문단 11개나 2001자 문단은 too_long이고 저장하지 않는다", async () => {
  const questionId = await addQuestion(await addPosting());
  expect(await writeManually(db, "u1", questionId, " \n\n  ", now)).toEqual({ ok: false, reason: "empty" });
  const eleven = Array.from({ length: 11 }, (_, i) => `문단 ${i + 1}`).join("\n\n");
  expect(await writeManually(db, "u1", questionId, eleven, now)).toEqual({ ok: false, reason: "too_long" });
  expect(await writeManually(db, "u1", questionId, "가".repeat(2001), now)).toEqual({ ok: false, reason: "too_long" });
  expect(await writeManually(db, "u1", questionId, `${"가".repeat(1999)}😀`, now)).toMatchObject({ ok: true });
});

test("제출한 공고의 문항은 쓰기·부분 수정·직접 고치기·직접 쓰기 모두 submitted이고 AI를 부르지 않는다", async () => {
  // 고르기만 한 문항(쓰기), 답이 있는 문항(수정·고치기), 답이 없는 문항(직접 쓰기)
  const { expId, questionId } = await ready();
  const q = await getQuestion(db, "u1", questionId);
  const postingId = q!.postingId;
  const emptyId = await addQuestion(postingId, "다른 문항");
  const ai = createFakeAi([writeReply(), reviseReply]);
  expect(await submitPosting(db, "u1", postingId, 0)).toEqual({ ok: true, number: 1 });

  expect(await approveAndWrite(db, ai, "u1", questionId, [expId], now)).toEqual({ ok: false, reason: "submitted" });
  expect(await writeManually(db, "u1", emptyId, "글", now)).toEqual({ ok: false, reason: "submitted" });
  expect((await getQuestion(db, "u1", emptyId))?.draft).toBeNull();
  expect(ai.requests).toHaveLength(0);
});

test("제출한 공고의 답은 부분 수정·직접 고치기가 submitted이고, 새 버전을 만들면 다시 고친다", async () => {
  const { questionId, draft } = await written();
  const q = await getQuestion(db, "u1", questionId);
  const postingId = q!.postingId;
  const ai = createFakeAi([reviseReply]);
  expect(await submitPosting(db, "u1", postingId, 0)).toEqual({ ok: true, number: 1 });

  expect(await reviseParagraph(db, ai, "u1", questionId, 0, { preset: "shorter", note: "" }, draft, now)).toEqual({ ok: false, reason: "submitted" });
  expect(await editParagraph(db, "u1", questionId, 0, "고친 글", draft, now)).toEqual({ ok: false, reason: "submitted" });
  expect(ai.requests).toHaveLength(0);
  expect((await getQuestion(db, "u1", questionId))?.draft).toEqual(draft);

  expect(await reopenPosting(db, "u1", postingId, 1)).toEqual({ ok: true });
  expect((await editParagraph(db, "u1", questionId, 0, "고친 글", draft, now)).ok).toBe(true);
});

test("쓰는 사이 제출하면 approveAndWrite는 submitted이고 답을 저장하지 않는다", async () => {
  const { expId, questionId } = await ready();
  const postingId = (await getQuestion(db, "u1", questionId))!.postingId;
  const ai = createFakeAi([
    async () => {
      expect(await submitPosting(db, "u1", postingId, 0)).toEqual({ ok: true, number: 1 });
      return writeReply();
    },
  ]);
  expect(await approveAndWrite(db, ai, "u1", questionId, [expId], now)).toEqual({ ok: false, reason: "submitted" });
  expect((await getQuestion(db, "u1", questionId))?.draft).toBeNull();
});

test("고치는 사이 제출하면 reviseParagraph는 submitted이고 답을 바꾸지 않는다", async () => {
  const { questionId, draft } = await written();
  const postingId = (await getQuestion(db, "u1", questionId))!.postingId;
  const ai = createFakeAi([
    async () => {
      expect(await submitPosting(db, "u1", postingId, 0)).toEqual({ ok: true, number: 1 });
      return reviseReply;
    },
  ]);
  expect(await reviseParagraph(db, ai, "u1", questionId, 0, { preset: "shorter", note: "" }, draft, now)).toEqual({ ok: false, reason: "submitted" });
  expect((await getQuestion(db, "u1", questionId))?.draft).toEqual(draft);
});

// 답으로 쓰기

async function addAnswer(over: Partial<Parameters<typeof createAnswer>[2]> = {}) {
  return createAnswer(
    db,
    "u1",
    { topic: "motive", question: "왜 이 회사인가요?", answer: "하루 30만 명이 쓰는 주문 서비스를 안정적으로 만들고 싶다", postingId: null, company: "가나다", companyKey: "가나다", ...over },
    now,
  );
}

// 유형을 정하고 답을 붙인 문항. withSelection이면 고르기까지 한다
async function answered(kinds: QuestionKind[], answerCount = 1, withSelection = false) {
  const expId = await addExperience();
  const questionId = await addQuestion(await addPosting());
  if (withSelection) {
    const r = await selectForQuestion(db, createFakeAi([selectReply]), "u1", questionId, now);
    if (!r.ok) throw new Error(r.reason);
  }
  const set = await setQuestionKinds(db, "u1", questionId, kinds);
  if (!set.ok) throw new Error(set.reason);
  const answerIds: string[] = [];
  for (let i = 0; i < answerCount; i++) {
    // 첫 답은 그 유형의 주제(동기포부형이면 지원동기, 자기소개형만이면 기타)
    const first = kinds.includes("motive") ? {} : { topic: "other" as const, answer: "사람들이 매일 쓰는 것을 만들 때 보람을 느낀다" };
    const id = await addAnswer(i === 0 ? first : { topic: "aspiration", answer: `포부 ${i}` });
    const attached = await attachAnswer(db, "u1", questionId, id);
    if (!attached.ok) throw new Error(attached.reason);
    answerIds.push(id);
  }
  return { expId, questionId, answerIds };
}

const answerReply = (sources: string[][] = [["A1"]]) => ({
  paragraphs: sources.map((s, i) => ({ text: `주문 서비스를 안정적으로 만들고 싶습니다 ${i}`, sources: s })),
  shortage: "",
});

test("동기포부형인데 답이 없으면 need_answers이고 AI를 부르지 않는다", async () => {
  const motive = await answered(["motive"], 0);
  const mixed = await answered(["experience", "motive"], 0, true);
  const ai = createFakeAi([writeReply(), writeReply()]);
  expect(await approveAndWrite(db, ai, "u1", motive.questionId, [], now)).toEqual({ ok: false, reason: "need_answers" });
  expect(await approveAndWrite(db, ai, "u1", mixed.questionId, [mixed.expId], now)).toEqual({ ok: false, reason: "need_answers" });
  expect(ai.requests).toHaveLength(0);
  expect((await getQuestion(db, "u1", mixed.questionId))?.selection?.approved).toBeNull();
});

test("자기소개형만인 문항은 고르기 없이 답만으로 쓴다", async () => {
  const { questionId, answerIds } = await answered(["self"]);
  const ai = createFakeAi([answerReply()]);
  const result = await approveAndWrite(db, ai, "u1", questionId, [], now);
  expect(result).toEqual({
    ok: true,
    value: {
      questionVersion: 0,
      basedOn: [],
      paragraphs: [{ text: "주문 서비스를 안정적으로 만들고 싶습니다 0", sources: [], answers: answerIds, edited: false }],
      shortage: "",
      answers: answerIds,
      writtenAt: now.toISOString(),
    },
  });
  const stored = await getQuestion(db, "u1", questionId);
  expect(stored?.draft).toEqual(result.ok && result.value);
  expect(stored?.selection).toBeNull();
  expect(ai.requests[0].messages[0].text).toContain("[경험 기록]\n없음");
});

test("경험형 문항은 지금처럼 고르기가 있어야 한다(changed)", async () => {
  const experience = await answered(["experience"], 0);
  const both = await answered(["experience", "motive"], 1);
  const motive = await answered(["motive"], 1);
  const ai = createFakeAi([writeReply()]);
  expect(await approveAndWrite(db, ai, "u1", experience.questionId, [experience.expId], now)).toEqual({ ok: false, reason: "changed" });
  expect(await approveAndWrite(db, ai, "u1", both.questionId, [], now)).toEqual({ ok: false, reason: "changed" });
  // 고르기 없이 경험을 보내면 승인할 고르기가 없으므로 changed
  expect(await approveAndWrite(db, ai, "u1", motive.questionId, [motive.expId], now)).toEqual({ ok: false, reason: "changed" });
  expect(ai.requests).toHaveLength(0);
});

test("AI의 A 별명은 paragraph.answers로, E 별명은 sources로 나뉜다", async () => {
  const { expId, questionId, answerIds } = await answered(["experience", "motive"], 2, true);
  const ai = createFakeAi([answerReply([["E1", "A1"], ["A2 (입사 후 포부)", "[a1]"], ["E1"]])]);
  const result = await approveAndWrite(db, ai, "u1", questionId, [expId], now);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.value.basedOn).toEqual([{ experienceId: expId, contentVersion: 0 }]);
  expect(result.value.answers).toEqual(answerIds);
  expect(result.value.paragraphs.map((p) => [p.sources, p.answers])).toEqual([
    [[expId], [answerIds[0]]],
    [[], [answerIds[1], answerIds[0]]],
    [[expId], []],
  ]);
});

test("경험형·동기포부형 문항에서 경험을 하나도 고르지 않아도 답이 있으면 답만으로 쓴다", async () => {
  const { questionId, answerIds } = await answered(["experience", "motive"], 1, true);
  const ai = createFakeAi([answerReply()]);
  const result = await approveAndWrite(db, ai, "u1", questionId, [], now);
  expect(result.ok && result.value.basedOn).toEqual([]);
  expect(result.ok && result.value.answers).toEqual(answerIds);
});

test("없는 A 별명은 버린다", async () => {
  const { questionId, answerIds } = await answered(["motive"]);
  const result = await approveAndWrite(db, createFakeAi([answerReply([["A2", "A9", "A0", "A1", "A1"]])]), "u1", questionId, [], now);
  expect(result.ok && result.value.paragraphs[0].answers).toEqual(answerIds);
});

test("붙인 답 중 지금 없는 답은 보내지 않는다", async () => {
  const { questionId, answerIds } = await answered(["motive"], 2);
  await db.delete(answersTable).where(eq(answersTable.id, answerIds[0]));
  const ai = createFakeAi([answerReply([["A1"]])]);
  const result = await approveAndWrite(db, ai, "u1", questionId, [], now);
  expect(result.ok && result.value.answers).toEqual([answerIds[1]]);
  expect(result.ok && result.value.paragraphs[0].answers).toEqual([answerIds[1]]);
  expect(ai.requests[0].messages[0].text).not.toContain("하루 30만 명");
});

test("쓰는 사이 답을 붙이거나 뗐으면 changed", async () => {
  const added = await answered(["motive"]);
  const extra = await addAnswer({ answer: "다른 답" });
  const attachAi = createFakeAi([
    async () => {
      expect((await attachAnswer(db, "u1", added.questionId, extra)).ok).toBe(true);
      return answerReply();
    },
  ]);
  expect(await approveAndWrite(db, attachAi, "u1", added.questionId, [], now)).toEqual({ ok: false, reason: "changed" });
  expect((await getQuestion(db, "u1", added.questionId))?.draft).toBeNull();

  const removed = await answered(["motive"], 2);
  const detachAi = createFakeAi([
    async () => {
      expect((await detachAnswer(db, "u1", removed.questionId, removed.answerIds[1])).ok).toBe(true);
      return answerReply();
    },
  ]);
  expect(await approveAndWrite(db, detachAi, "u1", removed.questionId, [], now)).toEqual({ ok: false, reason: "changed" });
  expect((await getQuestion(db, "u1", removed.questionId))?.draft).toBeNull();
});

test("고르기 없이 답만으로 쓰는 사이 고르기를 하면 changed", async () => {
  const { questionId } = await answered(["motive"]);
  const ai = createFakeAi([
    async () => {
      await saveSelection(db, "u1", questionId, { questionVersion: 0, picks: [], passed: [], noMatch: true, selectedAt: now.toISOString(), approved: null, approvedAt: null });
      return answerReply();
    },
  ]);
  expect(await approveAndWrite(db, ai, "u1", questionId, [], now)).toEqual({ ok: false, reason: "changed" });
  expect((await getQuestion(db, "u1", questionId))?.draft).toBeNull();
});

test("부분 수정은 답을 함께 보내고, 그 답이 없으면 stale", async () => {
  const { questionId, answerIds } = await answered(["motive"]);
  const first = await approveAndWrite(db, createFakeAi([answerReply()]), "u1", questionId, [], now);
  if (!first.ok) throw new Error(first.reason);
  const ai = createFakeAi([{ text: "고친 문단입니다.", sources: ["A1"] }, reviseReply]);

  const revised = await reviseParagraph(db, ai, "u1", questionId, 0, { preset: "shorter", note: "" }, first.value, now);
  expect(revised.ok && revised.value.paragraphs[0]).toEqual({ text: "고친 문단입니다.", sources: [], answers: answerIds, edited: false });
  const sent = ai.requests[0].messages[0].text;
  expect(sent).toContain("[내 답]\nA1\n");
  expect(sent).toContain("하루 30만 명이 쓰는 주문 서비스를 안정적으로 만들고 싶다");
  expect(sent).toContain("[문항 유형]\n동기포부형");
  if (!revised.ok) return;

  await db.delete(answersTable).where(eq(answersTable.id, answerIds[0]));
  expect(await reviseParagraph(db, ai, "u1", questionId, 0, { preset: "shorter", note: "" }, revised.value, now)).toEqual({ ok: false, reason: "stale" });
  expect(ai.requests).toHaveLength(1);
});

test("AI에 보낸 글에 [문항 유형]과 [내 답], 답 글이 있고 답 id는 없다", async () => {
  const { expId, questionId, answerIds } = await answered(["experience", "motive"], 1, true);
  const ai = createFakeAi([answerReply()]);
  await approveAndWrite(db, ai, "u1", questionId, [expId], now);
  const sent = ai.requests[0].messages[0].text;
  expect(sent).toContain("[문항 유형]\n경험형, 동기포부형");
  expect(sent).toContain("[내 답]\nA1\n- 주제: 지원동기\n- 질문: 왜 이 회사인가요?\n- 답: 하루 30만 명이 쓰는 주문 서비스를 안정적으로 만들고 싶다");
  expect(sent).toContain("[경험 기록]\nE1\n");
  for (const secret of [...answerIds, expId, questionId]) expect(sent).not.toContain(secret);

  // 유형이 없는(옛) 문항은 경험형으로 보고, 답이 없으면 "없음"
  const old = await ready();
  await db.update(questionsTable).set({ kinds: null }).where(eq(questionsTable.id, old.questionId));
  const oldAi = createFakeAi([writeReply()]);
  await approveAndWrite(db, oldAi, "u1", old.questionId, [old.expId], now);
  const oldSent = oldAi.requests[0].messages[0].text;
  expect(oldSent).toContain("[문항 유형]\n경험형");
  expect(oldSent).toContain("[내 답]\n없음");
});

test("지원동기·포부 문항에서 지원동기 답만 있으면 [답이 없는 주제]에 입사 후 포부가 들어간다", async () => {
  const { questionId } = await answered(["motive"]);
  await db.update(questionsTable).set({ topics: ["motive", "aspiration"] }).where(eq(questionsTable.id, questionId));
  const ai = createFakeAi([answerReply(), { text: "고친 문단입니다.", sources: ["A1"] }]);
  const result = await approveAndWrite(db, ai, "u1", questionId, [], now);
  expect(result.ok).toBe(true);
  expect(ai.requests[0].messages[0].text).toContain("[답이 없는 주제]\n입사 후 포부");
  if (!result.ok) return;
  await reviseParagraph(db, ai, "u1", questionId, 0, { preset: "shorter", note: "" }, result.value, now);
  expect(ai.requests[1].messages[0].text).toContain("[답이 없는 주제]\n입사 후 포부");

  // 주제마다 답이 있으면 없음
  const full = await answered(["motive"], 2);
  await db.update(questionsTable).set({ topics: ["motive", "aspiration"] }).where(eq(questionsTable.id, full.questionId));
  const fullAi = createFakeAi([answerReply()]);
  await approveAndWrite(db, fullAi, "u1", full.questionId, [], now);
  expect(fullAi.requests[0].messages[0].text).toContain("[답이 없는 주제]\n없음");
});

test("동기포부형+자기소개형인데 자기소개 쪽 답이 없으면 need_answers", async () => {
  const { questionId } = await answered(["motive", "self"]);
  const ai = createFakeAi([answerReply()]);
  expect(await approveAndWrite(db, ai, "u1", questionId, [], now)).toEqual({ ok: false, reason: "need_answers" });
  expect(ai.requests).toHaveLength(0);
  // 자기소개 쪽 답을 붙이면 쓴다
  const other = await addAnswer({ topic: "other", answer: "끝까지 확인하는 편이다" });
  expect((await attachAnswer(db, "u1", questionId, other)).ok).toBe(true);
  expect((await approveAndWrite(db, ai, "u1", questionId, [], now)).ok).toBe(true);
});
