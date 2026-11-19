import { eq } from "drizzle-orm";
import { beforeEach, expect, test } from "vitest";
import { createTestDb } from "@/db/test-db";
import type { Db } from "@/db/types";
import { createFakeAi } from "@/modules/ai/fake-client";
import { aiUsage } from "@/modules/ai/schema";
import { user } from "@/modules/auth/schema";
import type { ExperienceInput } from "@/modules/experiences/input";
import { confirmExperience, createExperience, setTrackScope } from "@/modules/experiences/repo";
import { experiences } from "@/modules/experiences/schema";
import type { AppliedScore, PostingAnalysis } from "@/modules/postings/analysis";
import { validatePosting } from "@/modules/postings/input";
import { applyToPosting, createPosting, getPosting, saveAnalysis, setStatus } from "@/modules/postings/repo";
import { createTrack } from "@/modules/tracks/repo";
import type { SurveyInput } from "@/modules/tracks/survey";
import { RESUME_EMPHASIS_SYSTEM } from "./prompts";
import { getCommonResume, getResume, getTailoredResume, saveResumeContent, saveTailoredContent } from "./resume-repo";
import { startCommonResume } from "./resume-write";
import { buildTailored, emphasisText, selectEmphasis } from "./resume-tailor";
import { listResumeSources } from "@/modules/experiences/writing";

let db: Db;
let trackId: string;
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
  requirements: [{ kind: "required", text: "Java 실무 경력 3년 이상", quote: "Java 실무 경력 3년 이상", quoteFound: true, evidence: [] }],
  field: { level: "same_job", reason: "분야가 같다" },
  analyzedAt: "2026-11-18T00:00:00.000Z",
};
const score = { desire: 50, fit: 50, criteria: {}, analyzedAt: "2026-11-18T00:00:00.000Z", appliedAt: "2026-11-18T00:00:00.000Z" } as unknown as AppliedScore;

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

async function addPosting(apply = true) {
  const checked = validatePosting(raw);
  if (!checked.ok) throw new Error("공고 입력 오류");
  const created = await createPosting(db, "u1", trackId, checked.value);
  if (!created.ok) throw new Error(created.reason);
  if (apply) {
    const saved = await saveAnalysis(db, "u1", created.id, analysis, { rawText, companyNote: raw.companyNote });
    if (!saved.ok) throw new Error(saved.reason);
    const posting = await getPosting(db, "u1", created.id);
    if (!posting) throw new Error("없음");
    const result = await applyToPosting(db, "u1", created.id, score, { ...posting, analysis });
    if (!result.ok) throw new Error(result.reason);
  }
  return created.id;
}

const lineReply = (...entries: [string, string[]][]) => ({ entries: entries.map(([exp, lines]) => ({ exp, lines })) });

beforeEach(async () => {
  delete process.env.AI_MONTHLY_LIMIT_USD;
  db = await createTestDb();
  await db.insert(user).values([
    { id: "u1", name: "홍길동", email: "u1@example.com" },
    { id: "u2", name: "김철수", email: "u2@example.com" },
  ]);
  const mine = await createTrack(db, "u1", survey);
  const theirs = await createTrack(db, "u2", survey); // 남의 트랙도 있는 상태
  if (!mine.ok || !theirs.ok) throw new Error("트랙을 만들지 못함");
  trackId = mine.id;
});


const pickReply = (...picks: [string, string][]) => ({ picks: picks.map(([exp, why]) => ({ exp, why })) });

// 공통본을 만든다: 시작 월이 늦은 순서로 경험A, 경험B, 경험C
async function commonWithThree(scopes: Partial<Record<"a" | "b" | "c", "summary">> = {}) {
  const a = await addExperience({ name: "경험A", startMonth: "2023-03" });
  const b = await addExperience({ name: "경험B", startMonth: "2022-03" });
  const c = await addExperience({ name: "경험C", startMonth: "2021-03" });
  const ids = { a, b, c };
  for (const key of ["a", "b", "c"] as const) {
    if (scopes[key]) await setTrackScope(db, "u1", ids[key], trackId, scopes[key]);
  }
  const ai = createFakeAi([lineReply(["E1", ["A 공통1"]], ["E2", ["B 공통1"]], ["E3", ["C 공통1"]])]);
  const made = await startCommonResume(db, ai, "u1", trackId, now);
  if (!made.ok) throw new Error(made.reason);
  return { ...ids, commonId: made.id };
}

test("강조 후보로는 공통본에 있는 사용 경험만 가고, 요약만 경험·수치·증빙 메모·실제 id는 가지 않는다", async () => {
  const { a, b, c } = await commonWithThree({ b: "summary" });
  // 공통본에 없는 사용 경험(나중에 확인됨)은 후보가 아니다
  const late = await addExperience({ name: "나중 경험", startMonth: "2020-03" });
  const postingId = await addPosting();
  const ai = createFakeAi([pickReply(["E1", "공고의 Java 경력과 경험A가 겹칩니다"])]);

  const result = await selectEmphasis(db, ai, "u1", postingId, now);

  if (!result.ok) throw new Error(result.reason);
  const request = ai.requests[0];
  expect(request).toMatchObject({ purpose: "resume_emphasis", effort: "medium", maxTokens: 8000 });
  expect(request.system).toBe(RESUME_EMPHASIS_SYSTEM);
  const sent = request.messages[0].text;
  expect(sent).toContain("[공고]\n");
  expect(sent).toContain("[공고 요구 사항]\nJava 실무 경력 3년 이상");
  expect(sent).toContain("[경험 기록]\nE1\n- 이름: 경험A");
  expect(sent).toContain("- 이름: 경험C");
  for (const hidden of ["경험B", "나중 경험", "57건", "비밀메모", "수치", "u1@example.com", "홍길동", "E3"]) {
    expect(sent).not.toContain(hidden);
  }
  for (const secret of [a, b, c, late, trackId, postingId, "u1"]) expect(sent).not.toContain(secret);
  expect(result.value.picks).toEqual([{ experienceId: a, contentVersion: expect.any(Number), why: "공고의 Java 경력과 경험A가 겹칩니다" }]);
  expect(result.value.noMatch).toBe(false);
  // 고르기만 하면 맞춤본 행에 selection만 저장된다
  const row = await getTailoredResume(db, "u1", postingId);
  expect(row?.selection?.picks).toHaveLength(1);
  expect(row?.content).toBeNull();
  // 공통본을 만들 때의 resume_write가 먼저, 고르기는 resume_emphasis 하나
  expect((await db.select().from(aiUsage)).map((r) => r.purpose).sort()).toEqual(["resume_emphasis", "resume_write"]);
});

test("학력·자격 경험은 강조 후보로 AI에 보내지 않고, 직접 고르면 buildTailored는 받아 준다", async () => {
  const a = await addExperience({ name: "경험A", startMonth: "2023-03" });
  const school = await addExperience({ name: "한국대학교 졸업", kind: "school", startMonth: "2015-03" });
  const cert = await addExperience({ name: "정보처리기사", kind: "certificate", startMonth: "2020-03" });
  const made = await startCommonResume(
    db,
    createFakeAi([lineReply(["E1", ["A 공통1"]], ["E2", ["자격 공통1"]], ["E3", ["학력 공통1"]])]),
    "u1",
    trackId,
    now,
  );
  if (!made.ok) throw new Error(made.reason);
  const postingId = await addPosting();
  const ai = createFakeAi([pickReply(["E1", "공고의 Java 경력과 경험A가 겹칩니다"])]);

  const result = await selectEmphasis(db, ai, "u1", postingId, now);

  if (!result.ok) throw new Error(result.reason);
  const sent = ai.requests[0].messages[0].text;
  expect(sent).toContain("- 이름: 경험A");
  expect(sent).not.toContain("한국대학교 졸업");
  expect(sent).not.toContain("정보처리기사");
  expect(sent.match(/^E\d+$/gm)).toEqual(["E1"]);
  expect(result.value.picks.map((p) => p.experienceId)).toEqual([a]);

  // 직접 체크한 학력·자격은 그대로 강조로 받는다
  const row = await getTailoredResume(db, "u1", postingId);
  const built = await buildTailored(db, createFakeAi([lineReply(["E1", ["학력 맞춤"]], ["E2", ["자격 맞춤"]])]), "u1", postingId, [school, cert], row!.version, now);
  if (!built.ok) throw new Error(built.reason);
  const byId = new Map(built.value.entries.map((e) => [e.experienceId, e]));
  expect(byId.get(school)?.emphasized).toBe(true);
  expect(byId.get(cert)?.emphasized).toBe(true);
});

test("공통본에 학력·자격만 있으면 AI를 부르지 않고 noMatch", async () => {
  await addExperience({ name: "한국대학교 졸업", kind: "school" });
  const made = await startCommonResume(db, createFakeAi([lineReply(["E1", ["학력 공통1"]])]), "u1", trackId, now);
  if (!made.ok) throw new Error(made.reason);
  const postingId = await addPosting();
  const ai = createFakeAi([]);

  const result = await selectEmphasis(db, ai, "u1", postingId, now);

  if (!result.ok) throw new Error(result.reason);
  expect(result.value.noMatch).toBe(true);
  expect(ai.requests.length).toBe(0);
});

test("후보가 없으면 AI를 부르지 않고 noMatch", async () => {
  const ai = createFakeAi([]);
  const result = await emphasisText(db, ai, "u1", { postingText: "공고", requirements: [], sources: [] }, now);
  expect(result).toEqual({ ok: true, value: { picks: [], noMatch: true, selectedAt: now.toISOString() } });
  expect(ai.requests.length).toBe(0);
});

test("별명이 'E1 (경험 이름)'처럼 조금 달라도 강조로 읽는다", async () => {
  await addExperience({ name: "경험0", startMonth: "2023-01" });
  const sources = await listResumeSources(db, "u1", trackId);
  const ai = createFakeAi([pickReply(["E1 (경험0)", "공고의 3년 경력과 겹칩니다"])]);

  const result = await emphasisText(db, ai, "u1", { postingText: "Java 3년 이상", requirements: [], sources }, now);

  if (!result.ok) throw new Error(result.reason);
  expect(result.value.picks.map((p) => p.experienceId)).toEqual([sources[0].id]);
});

test("AI가 별명 대신 경험 이름을 적어도 강조로 읽는다", async () => {
  await addExperience({ name: "주문 조회 API 개선", startMonth: "2023-01" });
  const sources = await listResumeSources(db, "u1", trackId);
  const ai = createFakeAi([pickReply(["주문 조회 API 개선", "공고의 3년 경력과 겹칩니다"])]);

  const result = await emphasisText(db, ai, "u1", { postingText: "Java 3년 이상", requirements: [], sources }, now);

  if (!result.ok) throw new Error(result.reason);
  expect(result.value.picks.map((p) => p.experienceId)).toEqual([sources[0].id]);
});

test("why에 기록에 없는 숫자가 있으면 비우고, 없는 별명·중복은 버리고, picks는 5개까지", async () => {
  for (let i = 0; i < 7; i++) await addExperience({ name: `경험${i}`, startMonth: `2023-0${i + 1}` });
  const sources = await listResumeSources(db, "u1", trackId);
  const ai = createFakeAi([
    pickReply(
      ["E1", "경험0에서 매출 999% 성장을 했습니다"],
      ["E2", "공고의 3년 경력과 겹칩니다"],
      ["E2", "중복"],
      ["E9", "없는 별명"],
      ["E3", "x".repeat(400)],
      ["E4", "넷째"],
      ["E5", "다섯째"],
      ["E6", "여섯째"],
      ["E7", "일곱째"],
    ),
  ]);

  const result = await emphasisText(db, ai, "u1", { postingText: "Java 3년 이상", requirements: [], sources }, now);

  if (!result.ok) throw new Error(result.reason);
  expect(result.value.picks).toHaveLength(5);
  expect(result.value.picks[0].why).toBe("");
  expect(result.value.picks[1].why).toBe("공고의 3년 경력과 겹칩니다");
  expect(result.value.picks[2].why).toHaveLength(300);
  expect(new Set(result.value.picks.map((p) => p.experienceId)).size).toBe(5);
});

test("공통본이 없으면 no_common이고 AI를 부르지 않는다", async () => {
  await addExperience();
  const postingId = await addPosting();
  const ai = createFakeAi([]);
  expect(await selectEmphasis(db, ai, "u1", postingId, now)).toEqual({ ok: false, reason: "no_common" });
  expect(await buildTailored(db, ai, "u1", postingId, [], null, now)).toEqual({ ok: false, reason: "no_common" });
  expect(ai.requests.length).toBe(0);
});

test("고른 경험은 섹션 맨 위로 순서대로 오고 공고 문맥과 함께 다시 쓰이며, 나머지 항목은 공통본 그대로(직접 고친 줄 포함)", async () => {
  const { a, b, c, commonId } = await commonWithThree();
  const common = await getCommonResume(db, "u1", trackId);
  // 경험A의 줄은 직접 고친 것으로 만든다
  const edited = {
    ...common!.content!,
    entries: common!.content!.entries.map((e) => (e.experienceId === a ? { ...e, lines: [{ text: "내가 고친 줄", edited: true }] } : e)),
  };
  const saved = await saveResumeContent(db, "u1", commonId, edited, common!.version);
  if (!saved.ok) throw new Error(saved.reason);
  const postingId = await addPosting();
  // 체크 순서는 C, B. 목록 순서(B가 먼저)와 다르다
  const ai = createFakeAi([lineReply(["E1", ["C 맞춤1", "C 맞춤2"]], ["E2", ["B 맞춤1"]])]);

  const result = await buildTailored(db, ai, "u1", postingId, [c, b], null, now);

  if (!result.ok) throw new Error(result.reason);
  expect(result.value.entries.map((e) => e.experienceId)).toEqual([c, b, a]);
  const byId = new Map(result.value.entries.map((e) => [e.experienceId, e]));
  expect(byId.get(c)).toMatchObject({ emphasized: true, detail: "full", lines: [{ text: "C 맞춤1", edited: false }, { text: "C 맞춤2", edited: false }] });
  expect(byId.get(a)?.lines).toEqual([{ text: "내가 고친 줄", edited: true }]);
  expect(byId.get(a)?.emphasized).toBe(false);
  expect(result.value.commonVersion).toBe(saved.version);
  const sent = ai.requests[0].messages[0].text;
  expect(ai.requests[0].purpose).toBe("resume_write");
  expect(sent).toContain("[공고]\n");
  expect(sent).toContain("[공고 요구 사항]\nJava 실무 경력 3년 이상");
  expect(sent).toContain("- 공고에 맞춰 강조: 예");
  expect(sent.indexOf("- 이름: 경험C")).toBeLessThan(sent.indexOf("- 이름: 경험B"));
  const row = await getTailoredResume(db, "u1", postingId);
  expect(row?.content?.entries.map((e) => e.experienceId)).toEqual([c, b, a]);
});

test("AI가 답에서 뺀 경험은 공통본 항목(고친 줄 포함)을 그대로 두고 강조만 켜며 체크 순서를 지킨다", async () => {
  const { a, b, c, commonId } = await commonWithThree();
  const common = await getResume(db, "u1", commonId);
  const edited = {
    ...common!.content!,
    entries: common!.content!.entries.map((e) => (e.experienceId === b ? { ...e, lines: [{ text: "내가 고친 줄", edited: true }] } : e)),
  };
  const saved = await saveResumeContent(db, "u1", commonId, edited, common!.version);
  if (!saved.ok) throw new Error(saved.reason);
  const postingId = await addPosting();
  // 체크 순서 C, B. AI는 E1(C)만 답한다
  const ai = createFakeAi([lineReply(["E1", ["C 맞춤"]])]);

  const result = await buildTailored(db, ai, "u1", postingId, [c, b], null, now);

  if (!result.ok) throw new Error(result.reason);
  expect(result.value.entries.map((e) => e.experienceId)).toEqual([c, b, a]);
  const byId = new Map(result.value.entries.map((e) => [e.experienceId, e]));
  expect(byId.get(c)?.lines).toEqual([{ text: "C 맞춤", edited: false }]);
  expect(byId.get(b)).toMatchObject({ emphasized: true, lines: [{ text: "내가 고친 줄", edited: true }] });
});

test("요약만 경험을 직접 올리면 자세히 분량으로 쓰이고, 쓸 수 없는 id는 버린다", async () => {
  const { b } = await commonWithThree({ b: "summary" });
  const excluded = await addExperience({ name: "제외 경험", startMonth: "2019-03" });
  await setTrackScope(db, "u1", excluded, trackId, "exclude");
  const postingId = await addPosting();
  const ai = createFakeAi([lineReply(["E1", ["B 자세히1", "B 자세히2", "B 자세히3"]])]);

  const result = await buildTailored(db, ai, "u1", postingId, [excluded, "없는-id", b, b], null, now);

  if (!result.ok) throw new Error(result.reason);
  const sent = ai.requests[0].messages[0].text;
  expect(sent).toContain("- 분량: 자세히(2~4줄)");
  expect(sent).not.toContain("제외 경험");
  expect(sent).not.toContain("E2");
  const entry = result.value.entries.find((e) => e.experienceId === b);
  expect(entry).toMatchObject({ detail: "full", emphasized: true });
  expect(entry?.lines).toHaveLength(3);
  expect(result.value.entries[0].experienceId).toBe(b);
});

test("6개는 too_many_selected이고 AI를 부르지 않는다", async () => {
  await commonWithThree();
  const more: string[] = [];
  for (let i = 0; i < 3; i++) more.push(await addExperience({ name: `추가${i}`, startMonth: `2018-0${i + 1}` }));
  const all = (await listResumeSources(db, "u1", trackId)).map((s) => s.id);
  expect(all).toHaveLength(6);
  const postingId = await addPosting();
  const ai = createFakeAi([]);

  expect(await buildTailored(db, ai, "u1", postingId, all, null, now)).toEqual({ ok: false, reason: "too_many_selected" });
  expect(ai.requests.length).toBe(0);
  expect(await getTailoredResume(db, "u1", postingId)).toBeNull();
});

test("아무것도 고르지 않으면 AI 없이 공통본을 복사한다", async () => {
  const { commonId } = await commonWithThree();
  const common = await getResume(db, "u1", commonId);
  const postingId = await addPosting();
  const ai = createFakeAi([]);

  const result = await buildTailored(db, ai, "u1", postingId, [], null, now);

  if (!result.ok) throw new Error(result.reason);
  expect(ai.requests.length).toBe(0);
  expect(result.value.entries).toEqual(common!.content!.entries);
  expect(result.value.commonVersion).toBe(common!.version);
});

test("이미 맞춤본이 있는데 expectedVersion이 null이거나 다르면 changed이고 AI를 부르지 않는다", async () => {
  const { a } = await commonWithThree();
  const postingId = await addPosting();
  const first = await buildTailored(db, createFakeAi([lineReply(["E1", ["A 맞춤"]])]), "u1", postingId, [a], null, now);
  if (!first.ok) throw new Error(first.reason);
  const row = await getTailoredResume(db, "u1", postingId);
  const ai = createFakeAi([]);

  expect(await buildTailored(db, ai, "u1", postingId, [a], null, now)).toEqual({ ok: false, reason: "changed" });
  expect(await buildTailored(db, ai, "u1", postingId, [a], row!.version + 5, now)).toEqual({ ok: false, reason: "changed" });
  expect(ai.requests.length).toBe(0);
  // 행이 없는데 숫자를 보내도 changed
  const other = await addPosting();
  expect(await buildTailored(db, ai, "u1", other, [a], 3, now)).toEqual({ ok: false, reason: "changed" });

  // 맞는 version이면 덮어쓴다
  const again = await buildTailored(db, createFakeAi([lineReply(["E1", ["A 새 맞춤"]])]), "u1", postingId, [a], row!.version, now);
  if (!again.ok) throw new Error(again.reason);
  expect(again.value.entries[0].lines[0].text).toBe("A 새 맞춤");
});

test("지원이 아닌 공고는 not_apply, 남의 공고는 not_found이고 AI를 부르지 않는다", async () => {
  const { a } = await commonWithThree();
  const postingId = await addPosting();
  const hold = await addPosting();
  await setStatus(db, "u1", hold, "hold");
  const ai = createFakeAi([]);

  expect(await selectEmphasis(db, ai, "u1", hold, now)).toEqual({ ok: false, reason: "not_apply" });
  expect(await buildTailored(db, ai, "u1", hold, [a], null, now)).toEqual({ ok: false, reason: "not_apply" });
  expect(await selectEmphasis(db, ai, "u2", postingId, now)).toEqual({ ok: false, reason: "not_found" });
  expect(await buildTailored(db, ai, "u2", postingId, [a], null, now)).toEqual({ ok: false, reason: "not_found" });
  expect(await selectEmphasis(db, ai, "u1", "없는-공고", now)).toEqual({ ok: false, reason: "not_found" });
  expect(ai.requests.length).toBe(0);
  expect(await getTailoredResume(db, "u1", postingId)).toBeNull();
});

test("사용량이 resume_emphasis·resume_write로 기록된다", async () => {
  const { a } = await commonWithThree();
  const postingId = await addPosting();
  const ai = createFakeAi([pickReply(["E1", "겹칩니다"]), lineReply(["E1", ["A 맞춤"]])]);

  const picked = await selectEmphasis(db, ai, "u1", postingId, now);
  if (!picked.ok) throw new Error(picked.reason);
  const row = await getTailoredResume(db, "u1", postingId);
  const built = await buildTailored(db, ai, "u1", postingId, [a], row!.version, now);
  if (!built.ok) throw new Error(built.reason);

  expect((await db.select().from(aiUsage)).map((r) => r.purpose).sort()).toEqual(["resume_emphasis", "resume_write", "resume_write"]);
});

test("AI가 쓰는 사이 다른 탭에서 맞춤본을 고치면 changed이고 고친 내용이 남는다", async () => {
  const { a } = await commonWithThree();
  const postingId = await addPosting();
  const first = await buildTailored(db, createFakeAi([lineReply(["E1", ["A 맞춤"]])]), "u1", postingId, [a], null, now);
  if (!first.ok) throw new Error(first.reason);
  const row = await getTailoredResume(db, "u1", postingId);
  const other = {
    ...row!.content!,
    entries: row!.content!.entries.map((e) => (e.experienceId === a ? { ...e, lines: [{ text: "다른 탭에서 고침", edited: true }] } : e)),
  };
  const ai = createFakeAi([
    async () => {
      const saved = await saveTailoredContent(db, "u1", postingId, trackId, other, row!.version);
      expect(saved.ok).toBe(true);
      return lineReply(["E1", ["AI가 쓴 줄"]]);
    },
  ]);

  const result = await buildTailored(db, ai, "u1", postingId, [a], row!.version, now);

  expect(result).toEqual({ ok: false, reason: "changed" });
  const stored = await getTailoredResume(db, "u1", postingId);
  expect(stored?.content?.entries.find((e) => e.experienceId === a)?.lines).toEqual([{ text: "다른 탭에서 고침", edited: true }]);
});
