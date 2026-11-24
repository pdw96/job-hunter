import { eq } from "drizzle-orm";
import { beforeEach, expect, test } from "vitest";
import { createTestDb } from "@/db/test-db";
import type { Db } from "@/db/types";
import { createFakeAi } from "@/modules/ai/fake-client";
import { aiUsage } from "@/modules/ai/schema";
import { user } from "@/modules/auth/schema";
import { createFact } from "@/modules/experiences/facts-repo";
import type { FactInputs, JobInput, SceneInput } from "@/modules/experiences/record-input";
import type { FactKind } from "@/modules/experiences/record-options";
import { confirmScene, createScene, setSceneTrackScope } from "@/modules/experiences/scenes-repo";
import { scenes } from "@/modules/experiences/schema";
import type { AppliedScore, PostingAnalysis } from "@/modules/postings/analysis";
import { validatePosting } from "@/modules/postings/input";
import { applyToPosting, createPosting, getPosting, saveAnalysis, setStatus } from "@/modules/postings/repo";
import { createTrack } from "@/modules/tracks/repo";
import type { SurveyInput } from "@/modules/tracks/survey";
import { getCareer, getCommonCareer, getTailoredCareer, saveCareerContent, saveTailoredCareerContent } from "./career-repo";
import { buildTailoredCareer, selectCareerEmphasis } from "./career-tailor";
import { startCommonCareer } from "./career-write";
import { RESUME_EMPHASIS_SYSTEM } from "./prompts";
import { reopenPosting, submitPosting } from "./submit";
import type { CareerContent } from "./types";

let db: Db;
let trackId: string;
const now = new Date("2026-11-24T03:00:00Z");

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
- Java 실무 경력 3년 이상`;
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

const job: JobInput = {
  company: "가나다 주식회사",
  department: "개발팀",
  title: "사원",
  employment: "regular",
  startMonth: "2022-03",
  endMonth: "2024-08",
  isOngoing: false,
  duties: ["결제 서버 운영"],
  bannedPhrases: [],
};
const scene = (head: SceneInput["head"], over: Partial<SceneInput> = {}): SceneInput => ({
  head,
  title: "결제 장애 대응",
  startMonth: "2023-03",
  endMonth: "2023-11",
  isOngoing: false,
  situation: "결제 장애가 잦았다",
  judgment: null,
  actions: "승인 API를 다시 설계했다",
  result: "장애가 줄었다",
  lessons: null,
  metrics: [{ text: "월 장애 5건에서 1건", basis: "장애 보고서" }],
  notDone: null,
  bannedPhrases: [],
  evidenceNote: "사내 보고서 링크 비밀메모",
  tags: [],
  ...over,
});

async function fact<K extends FactKind>(kind: K, input: FactInputs[K], confirmed = true) {
  const r = await createFact(db, "u1", kind, input, { confirmed });
  if (!r.ok) throw new Error(r.reason);
  return r.id;
}
// 사례를 만들고 AI 판정(모두 충족)을 흉내 낸 뒤 확인한다
async function addScene(input: SceneInput) {
  const r = await createScene(db, "u1", input);
  if (!r.ok) throw new Error(r.reason);
  await db
    .update(scenes)
    .set({
      rubric: {
        period: { status: "met", note: null },
        role: { status: "met", note: null },
        level: { status: "met", note: null },
        metrics: { status: "met", note: null },
        evidence: { status: "unjudged", note: null },
      },
    })
    .where(eq(scenes.id, r.id));
  await confirmScene(db, "u1", r.id);
  return r.id;
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

type Reply = [string, string[], string[]?];
const reply = (...items: Reply[]) => ({ items: items.map(([exp, done, results]) => ({ exp, done, results: results ?? [] })) });
const pickReply = (...picks: [string, string][]) => ({ picks: picks.map(([exp, why]) => ({ exp, why })) });

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
});

const allItems = (content: CareerContent | null | undefined) => (content?.companies ?? []).flatMap((c) => c.items);
const itemOf = (content: CareerContent | null | undefined, id: string) => allItems(content).find((i) => i.experienceId === id);
const idsIn = (content: CareerContent | null | undefined) => (content?.companies ?? []).map((c) => [c.experienceId, c.items.map((i) => i.experienceId)]);
const texts = (lines: { text: string }[] | undefined) => lines?.map((l) => l.text);

// 경력 하나에 사례 A(2023-03)·B(2022-05)로 공통본을 만든다. 공통본 순서는 A, B
async function commonWithTwo(scopes: { b?: "summary" } = {}) {
  const jobId = await fact("job", job);
  const a = await addScene(scene({ kind: "job", id: jobId }, { title: "사례A" }));
  const b = await addScene(scene({ kind: "job", id: jobId }, { title: "사례B", startMonth: "2022-05", endMonth: "2022-09" }));
  if (scopes.b) await setSceneTrackScope(db, "u1", b, trackId, scopes.b);
  const made = await startCommonCareer(db, createFakeAi([reply(["E1", ["A 공통 한 일"], ["A 공통 성과"]], ["E2", ["B 공통 한 일"]])]), "u1", trackId, now);
  if (!made.ok) throw new Error(made.reason);
  const common = await getCareer(db, "u1", made.id);
  if (!common?.content) throw new Error("내용 없음");
  return { jobId, a, b, commonId: made.id, common };
}

// ── 강조 고르기 ──

test("공통본이 없으면 no_common이고 AI를 부르지 않는다", async () => {
  const jobId = await fact("job", job);
  await addScene(scene({ kind: "job", id: jobId }));
  const postingId = await addPosting();
  const ai = createFakeAi([]);
  expect(await selectCareerEmphasis(db, ai, "u1", postingId, now)).toEqual({ ok: false, reason: "no_common" });
  expect(await buildTailoredCareer(db, ai, "u1", postingId, [], null, now)).toEqual({ ok: false, reason: "no_common" });
  expect(ai.requests).toHaveLength(0);
});

test("후보가 없으면 AI 없이 noMatch를 저장한다", async () => {
  await fact("job", job); // 항목 없는 회사만 있는 공통본
  const made = await startCommonCareer(db, createFakeAi([]), "u1", trackId, now);
  if (!made.ok) throw new Error(made.reason);
  const postingId = await addPosting();
  const ai = createFakeAi([]);

  const result = await selectCareerEmphasis(db, ai, "u1", postingId, now);

  expect(result).toEqual({ ok: true, value: { picks: [], noMatch: true, selectedAt: now.toISOString() } });
  expect(ai.requests).toHaveLength(0);
  expect((await getTailoredCareer(db, "u1", postingId))?.selection?.noMatch).toBe(true);
});

test("AI가 고른 것을 이유와 함께 저장한다(purpose career_emphasis로 사용량에 남는다)", async () => {
  const { jobId, a, b } = await commonWithTwo({ b: "summary" });
  // 공통본에 없는 사용 항목(나중에 확인됨)은 후보가 아니다
  const late = await addScene(scene({ kind: "job", id: jobId }, { title: "나중 사례", startMonth: "2024-01", endMonth: "2024-02" }));
  const postingId = await addPosting();
  const ai = createFakeAi([pickReply(["E1", "공고의 Java 경력과 사례A가 겹칩니다"])]);

  const result = await selectCareerEmphasis(db, ai, "u1", postingId, now);

  if (!result.ok) throw new Error(result.reason);
  const request = ai.requests[0];
  expect(request).toMatchObject({ purpose: "career_emphasis", effort: "medium", maxTokens: 8000 });
  expect(request.system).toBe(RESUME_EMPHASIS_SYSTEM);
  const sent = request.messages[0].text;
  expect(sent).toContain("[공고 요구 사항]\nJava 실무 경력 3년 이상");
  expect(sent).toContain("[경험 기록]\nE1\n- 이름: 사례A");
  for (const hidden of ["사례B", "나중 사례", "비밀메모", "5건", "E2", "홍길동", "u1@example.com"]) expect(sent).not.toContain(hidden);
  for (const secret of [a, b, late, jobId, trackId, postingId]) expect(sent).not.toContain(secret);
  expect(result.value.picks).toEqual([{ experienceId: a, contentVersion: expect.any(Number), why: "공고의 Java 경력과 사례A가 겹칩니다" }]);
  expect(result.value.noMatch).toBe(false);
  const row = await getTailoredCareer(db, "u1", postingId);
  expect(row?.selection?.picks.map((p) => p.experienceId)).toEqual([a]);
  expect(row?.content).toBeNull();
  expect((await db.select().from(aiUsage)).map((r) => r.purpose).sort()).toEqual(["career_emphasis", "career_write"]);
});

// ── 맞춤본 만들기 ──

test("0개면 AI 없이 공통본을 그대로 복사한다", async () => {
  const { common } = await commonWithTwo();
  const postingId = await addPosting();
  const ai = createFakeAi([]);

  const result = await buildTailoredCareer(db, ai, "u1", postingId, [], null, now);

  if (!result.ok) throw new Error(result.reason);
  expect(ai.requests).toHaveLength(0);
  expect(result.value).toEqual({ companies: common.content!.companies, commonVersion: common.version });
  expect((await getTailoredCareer(db, "u1", postingId))?.content).toEqual(result.value);
});

test("고른 항목이 회사 맨 위로 오르고 강조가 켜지며, 공고와 함께 자세히로 다시 쓴다", async () => {
  const { jobId, a, b, commonId, common } = await commonWithTwo({ b: "summary" });
  // A의 한 일은 직접 고친 것으로 만든다
  const edited: CareerContent = {
    ...common.content!,
    companies: common.content!.companies.map((c) => ({
      ...c,
      items: c.items.map((i) => (i.experienceId === a ? { ...i, done: [{ text: "내가 고친 줄", edited: true }] } : i)),
    })),
  };
  const saved = await saveCareerContent(db, "u1", commonId, edited, common.version);
  if (!saved.ok) throw new Error(saved.reason);
  const postingId = await addPosting();
  const ai = createFakeAi([reply(["E1", ["B 맞춤 1", "B 맞춤 2"], ["B 성과"]])]);

  const result = await buildTailoredCareer(db, ai, "u1", postingId, [b], null, now);

  if (!result.ok) throw new Error(result.reason);
  expect(idsIn(result.value)).toEqual([[jobId, [b, a]]]);
  expect(itemOf(result.value, b)).toMatchObject({ emphasized: true, detail: "full" });
  expect(texts(itemOf(result.value, b)?.done)).toEqual(["B 맞춤 1", "B 맞춤 2"]);
  expect(texts(itemOf(result.value, b)?.results)).toEqual(["B 성과"]);
  expect(itemOf(result.value, a)).toMatchObject({ emphasized: false, done: [{ text: "내가 고친 줄", edited: true }] });
  expect(result.value.commonVersion).toBe(saved.version);
  const request = ai.requests[0];
  expect(request.purpose).toBe("career_write");
  const sent = request.messages[0].text;
  expect(sent).toContain("[공고]\n");
  expect(sent).toContain("[공고 요구 사항]\nJava 실무 경력 3년 이상");
  expect(sent).toContain("- 분량: 자세히");
  expect(sent).toContain("- 공고에 맞춰 강조: 예");
  expect(sent).not.toContain("사례A");
  expect(idsIn((await getTailoredCareer(db, "u1", postingId))?.content)).toEqual([[jobId, [b, a]]]);
});

test("AI가 답에서 뺀 항목은 공통본 항목에 강조만 켜고 고른 순서를 지킨다", async () => {
  const { jobId, a, b } = await commonWithTwo();
  const postingId = await addPosting();
  // 고른 순서 B, A. AI는 E1(B)만 답한다
  const ai = createFakeAi([reply(["E1", ["B 맞춤"]])]);

  const result = await buildTailoredCareer(db, ai, "u1", postingId, [b, a], null, now);

  if (!result.ok) throw new Error(result.reason);
  expect(idsIn(result.value)).toEqual([[jobId, [b, a]]]);
  expect(texts(itemOf(result.value, b)?.done)).toEqual(["B 맞춤"]);
  expect(itemOf(result.value, a)).toMatchObject({ emphasized: true });
  expect(texts(itemOf(result.value, a)?.done)).toEqual(["A 공통 한 일"]);
  expect(texts(itemOf(result.value, a)?.results)).toEqual(["A 공통 성과"]);
});

test("공통본에 없는 항목은 그 회사 맨 위에 넣고, 공통본에 없는 회사는 회사 머리를 만들어 넣는다", async () => {
  const { jobId, a, b } = await commonWithTwo();
  // 공통본을 만든 뒤 확인된 사례 C(같은 회사)와 새 경력(더 최근)의 사례 D
  const c = await addScene(scene({ kind: "job", id: jobId }, { title: "사례C", startMonth: "2021-01", endMonth: "2021-02" }));
  const newJob = await fact("job", { ...job, company: "라마바 주식회사", startMonth: "2024-09", endMonth: null, isOngoing: true, duties: ["주문 서버 개발"] });
  const d = await addScene(scene({ kind: "job", id: newJob }, { title: "사례D", startMonth: "2025-01", endMonth: "2025-03" }));
  const postingId = await addPosting();
  const ai = createFakeAi([reply(["E1", ["C 맞춤"]], ["E2", ["D 맞춤"]])]);

  const result = await buildTailoredCareer(db, ai, "u1", postingId, [c, d], null, now);

  if (!result.ok) throw new Error(result.reason);
  expect(idsIn(result.value)).toEqual([
    [newJob, [d]],
    [jobId, [c, a, b]],
  ]);
  expect(result.value.companies[0].heading).toMatchObject({ company: "라마바 주식회사", duties: ["주문 서버 개발"] });
  expect(itemOf(result.value, c)).toMatchObject({ emphasized: true, detail: "full" });
  expect(texts(itemOf(result.value, d)?.done)).toEqual(["D 맞춤"]);
});

test("6개면 too_many_selected이고 AI를 부르지 않는다", async () => {
  const { jobId, a, b } = await commonWithTwo();
  const more: string[] = [];
  for (let i = 0; i < 4; i++) {
    more.push(await addScene(scene({ kind: "job", id: jobId }, { title: `추가${i}`, startMonth: `2021-0${i + 1}`, endMonth: `2021-0${i + 1}` })));
  }
  const postingId = await addPosting();
  const ai = createFakeAi([]);

  expect(await buildTailoredCareer(db, ai, "u1", postingId, [a, b, ...more], null, now)).toEqual({ ok: false, reason: "too_many_selected" });
  expect(ai.requests).toHaveLength(0);
  expect(await getTailoredCareer(db, "u1", postingId)).toBeNull();
});

test("쓸 수 없는 id는 버리고, 요약만 항목도 받는다", async () => {
  const { jobId, b } = await commonWithTwo({ b: "summary" });
  const excluded = await addScene(scene({ kind: "job", id: jobId }, { title: "제외 사례", startMonth: "2020-01", endMonth: "2020-02" }));
  await setSceneTrackScope(db, "u1", excluded, trackId, "exclude");
  const postingId = await addPosting();
  const ai = createFakeAi([reply(["E1", ["B 자세히 1", "B 자세히 2", "B 자세히 3"]])]);

  const result = await buildTailoredCareer(db, ai, "u1", postingId, [excluded, "없는-id", jobId, b, b], null, now);

  if (!result.ok) throw new Error(result.reason);
  const sent = ai.requests[0].messages[0].text;
  expect(sent).not.toContain("제외 사례");
  expect(sent).not.toContain("E2");
  expect(itemOf(result.value, b)).toMatchObject({ detail: "full", emphasized: true });
  expect(itemOf(result.value, b)?.done).toHaveLength(3);
  expect(itemOf(result.value, excluded)).toBeUndefined();
});

test("version이 다르면 AI 전에 changed", async () => {
  const { a } = await commonWithTwo();
  const postingId = await addPosting();
  const first = await buildTailoredCareer(db, createFakeAi([reply(["E1", ["A 맞춤"]])]), "u1", postingId, [a], null, now);
  if (!first.ok) throw new Error(first.reason);
  const row = await getTailoredCareer(db, "u1", postingId);
  const ai = createFakeAi([]);

  expect(await buildTailoredCareer(db, ai, "u1", postingId, [a], null, now)).toEqual({ ok: false, reason: "changed" });
  expect(await buildTailoredCareer(db, ai, "u1", postingId, [a], row!.version + 5, now)).toEqual({ ok: false, reason: "changed" });
  // 행이 없는데 숫자를 보내도 changed
  const other = await addPosting();
  expect(await buildTailoredCareer(db, ai, "u1", other, [a], 3, now)).toEqual({ ok: false, reason: "changed" });
  expect(ai.requests).toHaveLength(0);

  // 맞는 version이면 덮어쓴다
  const again = await buildTailoredCareer(db, createFakeAi([reply(["E1", ["A 새 맞춤"]])]), "u1", postingId, [a], row!.version, now);
  if (!again.ok) throw new Error(again.reason);
  expect(texts(itemOf(again.value, a)?.done)).toEqual(["A 새 맞춤"]);
});

test("AI가 쓰는 사이 다른 탭에서 맞춤본을 고치면 changed이고 고친 내용이 남는다", async () => {
  const { a } = await commonWithTwo();
  const postingId = await addPosting();
  const first = await buildTailoredCareer(db, createFakeAi([reply(["E1", ["A 맞춤"]])]), "u1", postingId, [a], null, now);
  if (!first.ok) throw new Error(first.reason);
  const row = await getTailoredCareer(db, "u1", postingId);
  const other: CareerContent = { ...row!.content!, companies: [] };
  const ai = createFakeAi([
    async () => {
      expect((await saveTailoredCareerContent(db, "u1", postingId, trackId, other, row!.version)).ok).toBe(true);
      return reply(["E1", ["AI가 쓴 줄"]]);
    },
  ]);

  expect(await buildTailoredCareer(db, ai, "u1", postingId, [a], row!.version, now)).toEqual({ ok: false, reason: "changed" });
  expect((await getTailoredCareer(db, "u1", postingId))?.content?.companies).toEqual([]);
});

test("사용량이 career_emphasis·career_write로 기록된다", async () => {
  const { a } = await commonWithTwo();
  const postingId = await addPosting();
  const ai = createFakeAi([pickReply(["E1", "겹칩니다"]), reply(["E1", ["A 맞춤"]])]);

  const picked = await selectCareerEmphasis(db, ai, "u1", postingId, now);
  if (!picked.ok) throw new Error(picked.reason);
  const row = await getTailoredCareer(db, "u1", postingId);
  const built = await buildTailoredCareer(db, ai, "u1", postingId, [a], row!.version, now);
  if (!built.ok) throw new Error(built.reason);

  expect((await db.select().from(aiUsage)).map((r) => r.purpose).sort()).toEqual(["career_emphasis", "career_write", "career_write"]);
});

// ── 잠금과 소유 ──

test("제출로 잠기면 submitted이고 AI를 부르지 않는다", async () => {
  const { a } = await commonWithTwo();
  const postingId = await addPosting();
  expect(await submitPosting(db, "u1", postingId, 0)).toEqual({ ok: true, number: 1 });
  const ai = createFakeAi([]);

  expect(await selectCareerEmphasis(db, ai, "u1", postingId, now)).toEqual({ ok: false, reason: "submitted" });
  expect(await buildTailoredCareer(db, ai, "u1", postingId, [a], null, now)).toEqual({ ok: false, reason: "submitted" });
  expect(ai.requests).toHaveLength(0);
  expect(await getTailoredCareer(db, "u1", postingId)).toBeNull();
});

test("만드는 사이 제출하면 submitted이고 맞춤본을 저장하지 않는다", async () => {
  const { a } = await commonWithTwo();
  const postingId = await addPosting();
  const first = createFakeAi([
    async () => {
      expect(await submitPosting(db, "u1", postingId, 0)).toEqual({ ok: true, number: 1 });
      return pickReply(["E1", "겹칩니다"]);
    },
  ]);
  expect(await selectCareerEmphasis(db, first, "u1", postingId, now)).toEqual({ ok: false, reason: "submitted" });
  expect(await getTailoredCareer(db, "u1", postingId)).toBeNull();

  expect(await reopenPosting(db, "u1", postingId, 1)).toEqual({ ok: true });
  const second = createFakeAi([
    async () => {
      expect(await submitPosting(db, "u1", postingId, 1)).toEqual({ ok: true, number: 2 });
      return reply(["E1", ["A 맞춤"]]);
    },
  ]);
  expect(await buildTailoredCareer(db, second, "u1", postingId, [a], null, now)).toEqual({ ok: false, reason: "submitted" });
  expect(await getTailoredCareer(db, "u1", postingId)).toBeNull();
});

test("다른 사용자의 공고면 not_found, 지원이 아닌 공고는 not_apply이고 AI를 부르지 않는다", async () => {
  const { a } = await commonWithTwo();
  const postingId = await addPosting();
  const hold = await addPosting();
  await setStatus(db, "u1", hold, "hold");
  const ai = createFakeAi([]);

  expect(await selectCareerEmphasis(db, ai, "u2", postingId, now)).toEqual({ ok: false, reason: "not_found" });
  expect(await buildTailoredCareer(db, ai, "u2", postingId, [a], null, now)).toEqual({ ok: false, reason: "not_found" });
  expect(await selectCareerEmphasis(db, ai, "u1", "없는-공고", now)).toEqual({ ok: false, reason: "not_found" });
  expect(await selectCareerEmphasis(db, ai, "u1", hold, now)).toEqual({ ok: false, reason: "not_apply" });
  expect(await buildTailoredCareer(db, ai, "u1", hold, [a], null, now)).toEqual({ ok: false, reason: "not_apply" });
  expect(ai.requests).toHaveLength(0);
  expect(await getTailoredCareer(db, "u1", postingId)).toBeNull();
  expect(await getCommonCareer(db, "u2", trackId)).toBeNull();
});
