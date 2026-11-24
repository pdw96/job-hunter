import { eq } from "drizzle-orm";
import { beforeEach, expect, test } from "vitest";
import { createTestDb } from "@/db/test-db";
import type { Db } from "@/db/types";
import { createFakeAi } from "@/modules/ai/fake-client";
import { aiUsage } from "@/modules/ai/schema";
import { user } from "@/modules/auth/schema";
import { confirmFact, createFact, setFactTrackScope, updateFact } from "@/modules/experiences/facts-repo";
import type { FactInputs, JobInput, ProjectInput, SceneInput } from "@/modules/experiences/record-input";
import type { FactKind } from "@/modules/experiences/record-options";
import { confirmScene, createScene, setSceneTrackScope } from "@/modules/experiences/scenes-repo";
import { scenes } from "@/modules/experiences/schema";
import { listCareerSources } from "@/modules/experiences/sources";
import type { AppliedScore, PostingAnalysis } from "@/modules/postings/analysis";
import { validatePosting } from "@/modules/postings/input";
import { applyToPosting, createPosting, getPosting, saveAnalysis } from "@/modules/postings/repo";
import { createTrack } from "@/modules/tracks/repo";
import type { SurveyInput } from "@/modules/tracks/survey";
import { getCareer, getCommonCareer, getTailoredCareer, saveCareerContent, saveTailoredCareerContent } from "./career-repo";
import { rewriteCareerItems, startCommonCareer, writeCareerItems } from "./career-write";
import { CAREER_WRITE_SYSTEM } from "./prompts";
import { submitPosting } from "./submit";
import type { CareerContent, CareerItem } from "./types";

let db: Db;
let trackId: string;
let otherTrack: string;
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
  duties: ["결제 서버 운영", "장애 대응"],
  bannedPhrases: ["주도"],
};
const project: ProjectInput = {
  name: "사내 정산 도구",
  parent: null,
  startMonth: "2023-01",
  endMonth: "2023-06",
  isOngoing: false,
  role: "백엔드",
  tools: ["Java", "Spring"],
  summary: "정산 업무를 자동화한 사내 도구",
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
  notDone: "프론트엔드는 하지 않았다",
  bannedPhrases: ["혼자 구축"],
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
async function addScene(input: SceneInput, confirmed = true) {
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
  if (confirmed) await confirmScene(db, "u1", r.id);
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

const allItems = (content: CareerContent | null | undefined) => (content?.companies ?? []).flatMap((c) => c.items);
const itemOf = (content: CareerContent | null | undefined, id: string) => allItems(content).find((i) => i.experienceId === id);
const texts = (lines: { text: string }[] | undefined) => lines?.map((l) => l.text);

// 경력 하나에 사례 A(2023-03)·B(2022-05) 두 항목으로 공통본을 만든다. A가 E1이다
async function commonWithTwo() {
  const jobId = await fact("job", job);
  const a = await addScene(scene({ kind: "job", id: jobId }, { title: "사례A" }));
  const b = await addScene(scene({ kind: "job", id: jobId }, { title: "사례B", startMonth: "2022-05", endMonth: "2022-09" }));
  const ai = createFakeAi([reply(["E1", ["A 한 일"], ["A 성과"]], ["E2", ["B 한 일"]])]);
  const made = await startCommonCareer(db, ai, "u1", trackId, now);
  if (!made.ok) throw new Error(made.reason);
  const career = await getCareer(db, "u1", made.id);
  if (!career?.content) throw new Error("내용 없음");
  return { jobId, a, b, id: made.id, career };
}

// ── 공통본 만들기 ──

test("확인된 경력이 없으면 no_jobs이고 AI를 부르지 않는다", async () => {
  await fact("job", job, false);
  await fact("project", project);
  const ai = createFakeAi([reply(["E1", ["줄"]])]);
  expect(await startCommonCareer(db, ai, "u1", trackId, now)).toEqual({ ok: false, reason: "no_jobs" });
  expect(ai.requests).toHaveLength(0);
  expect(await getCommonCareer(db, "u1", trackId)).toBeNull();
});

test("항목이 없으면 AI 없이 회사 머리만 만든다", async () => {
  const jobId = await fact("job", job);
  const ai = createFakeAi([]);

  const made = await startCommonCareer(db, ai, "u1", trackId, now);

  if (!made.ok) throw new Error(made.reason);
  expect(ai.requests).toHaveLength(0);
  expect(await db.select().from(aiUsage)).toHaveLength(0);
  const career = await getCareer(db, "u1", made.id);
  expect(career?.content).toEqual({
    commonVersion: null,
    companies: [
      {
        experienceId: jobId,
        contentVersion: expect.any(Number),
        heading: { company: "가나다 주식회사", department: "개발팀", title: "사원", period: "2022.03 ~ 2024.08", duties: ["결제 서버 운영", "장애 대응"] },
        items: [],
      },
    ],
  });
});

test("항목마다 done·results를 저장하고 분량 한도로 자른다", async () => {
  const jobId = await fact("job", job);
  const full = await addScene(scene({ kind: "job", id: jobId }, { title: "자세히 사례", startMonth: "2024-01", endMonth: "2024-03" }));
  const projectId = await fact("project", { ...project, parent: { kind: "job", id: jobId } });
  await setFactTrackScope(db, "u1", "project", projectId, trackId, "summary");
  const ai = createFakeAi([
    reply(
      ["E1", ["- 1", "2", "3", "4", "5"], ["r1", "r2", "r3", "r4"]],
      ["E2", ["a", "b", "c"], ["x", "y"]],
    ),
  ]);

  const made = await startCommonCareer(db, ai, "u1", trackId, now);

  if (!made.ok) throw new Error(made.reason);
  const request = ai.requests[0];
  expect(request).toMatchObject({ purpose: "career_write", effort: "medium", maxTokens: 16000 });
  expect(request.system).toBe(CAREER_WRITE_SYSTEM);
  const sent = request.messages[0].text;
  expect(sent).not.toContain("[공고]");
  expect(sent).toContain("[경력기술서 항목]\nE1\n- 이름: 자세히 사례");
  expect(sent).toContain("- 분량: 자세히(한 일 2~4줄, 성과 0~3줄)");
  expect(sent).toContain("E2\n- 이름: 사내 정산 도구");
  expect(sent).toContain("- 분량: 요약(한 일 1~2줄, 성과 0~1줄)");
  expect(sent).not.toContain("공고에 맞춰 강조");
  expect(sent).toContain("수치: 월 장애 5건에서 1건 (기준: 장애 보고서)");

  const content = (await getCareer(db, "u1", made.id))?.content;
  expect(content?.companies.map((c) => c.experienceId)).toEqual([jobId]);
  expect(allItems(content).map((i) => i.experienceId)).toEqual([full, projectId]);
  const first = itemOf(content, full);
  expect(texts(first?.done)).toEqual(["1", "2", "3", "4"]);
  expect(texts(first?.results)).toEqual(["r1", "r2", "r3"]);
  expect(first).toMatchObject({ kind: "scene", detail: "full", emphasized: false, writtenAt: now.toISOString() });
  expect(first?.heading).toEqual({ name: "자세히 사례", role: "사원", period: "2024.01 ~ 2024.03", tools: [] });
  const second = itemOf(content, projectId);
  expect(texts(second?.done)).toEqual(["a", "b"]);
  expect(texts(second?.results)).toEqual(["x"]);
  expect(second).toMatchObject({ kind: "project", detail: "summary" });
  expect(second?.heading).toEqual({ name: "사내 정산 도구", role: "백엔드", period: "2023.01 ~ 2023.06", tools: ["Java", "Spring"] });
  expect((await db.select().from(aiUsage)).map((r) => r.purpose)).toEqual(["career_write"]);
});

test("AI에 보내는 글에 실제 id·증빙 메모·이메일·이름·제외 항목이 없다", async () => {
  const jobId = await fact("job", job);
  const sceneId = await addScene(scene({ kind: "job", id: jobId }));
  const excluded = await addScene(scene({ kind: "job", id: jobId }, { title: "뺀 사례", startMonth: "2022-04" }));
  await setSceneTrackScope(db, "u1", excluded, trackId, "exclude");
  const projectId = await fact("project", { ...project, parent: { kind: "job", id: jobId } });
  const ai = createFakeAi([reply(["E1", ["줄"]])]);

  const made = await startCommonCareer(db, ai, "u1", trackId, now);

  expect(made.ok).toBe(true);
  const sent = ai.requests[0].messages[0].text;
  for (const hidden of ["비밀메모", "u1@example.com", "홍길동", "뺀 사례", "E3"]) expect(sent).not.toContain(hidden);
  for (const secret of [jobId, sceneId, excluded, projectId, trackId, "u1"]) expect(sent).not.toContain(secret);
});

test("항목 내용이 모두 비어 있는 프로젝트도 보내고, 답이 없으면 빈 줄로 넣는다", async () => {
  const jobId = await fact("job", job);
  const sceneId = await addScene(scene({ kind: "job", id: jobId }));
  const empty = await fact("project", { ...project, parent: { kind: "job", id: jobId }, summary: null, tools: [], startMonth: null, endMonth: null });
  const ai = createFakeAi([reply(["E1", ["사례 줄"]])]);

  const made = await startCommonCareer(db, ai, "u1", trackId, now);

  if (!made.ok) throw new Error(made.reason);
  expect(ai.requests[0].messages[0].text).toContain("E2\n- 이름: 사내 정산 도구");
  const content = (await getCareer(db, "u1", made.id))?.content;
  expect(texts(itemOf(content, sceneId)?.done)).toEqual(["사례 줄"]);
  expect(itemOf(content, empty)).toMatchObject({ done: [], results: [] });
});

test("답에 없는 별명과 같은 별명은 버리고 빠뜨린 항목은 빈 줄, 모두 없으면 invalid", async () => {
  const jobId = await fact("job", job);
  const a = await addScene(scene({ kind: "job", id: jobId }, { title: "사례A" }));
  const b = await addScene(scene({ kind: "job", id: jobId }, { title: "사례B", startMonth: "2022-05" }));

  const none = createFakeAi([reply(["E9", ["없는 별명"]])]);
  expect(await startCommonCareer(db, none, "u1", trackId, now)).toEqual({ ok: false, reason: "invalid" });
  expect(await getCommonCareer(db, "u1", trackId)).toBeNull();

  const ai = createFakeAi([reply(["E1", ["A 줄"]], ["E9", ["없는 별명"]], ["E1", ["같은 별명은 처음 것만"]])]);
  const made = await startCommonCareer(db, ai, "u1", trackId, now);
  if (!made.ok) throw new Error(made.reason);
  const content = (await getCareer(db, "u1", made.id))?.content;
  expect(texts(itemOf(content, a)?.done)).toEqual(["A 줄"]);
  expect(itemOf(content, b)?.done).toEqual([]);
});

test("경력 이름 대신 항목 이름을 적어도 받는다", async () => {
  const jobId = await fact("job", job);
  const a = await addScene(scene({ kind: "job", id: jobId }, { title: "사례A" }));
  const ai = createFakeAi([reply(["사례A", ["이름으로 받은 줄"]])]);

  const made = await startCommonCareer(db, ai, "u1", trackId, now);

  if (!made.ok) throw new Error(made.reason);
  expect(texts(itemOf((await getCareer(db, "u1", made.id))?.content, a)?.done)).toEqual(["이름으로 받은 줄"]);
});

test("항목은 30개까지 회사 순서대로 넣고 회사 머리는 모두 넣는다", async () => {
  const recent = await fact("job", { ...job, company: "최근 회사", startMonth: "2024-09", endMonth: null, isOngoing: true });
  const old = await fact("job", job);
  for (let i = 0; i < 29; i++) {
    await addScene(scene({ kind: "job", id: recent }, { title: `최근${i}`, startMonth: "2024-10", metrics: [] }));
  }
  await addScene(scene({ kind: "job", id: old }, { title: "옛1" }));
  await addScene(scene({ kind: "job", id: old }, { title: "옛2", startMonth: "2022-05" }));
  const ai = createFakeAi([
    (req: { messages: { text: string }[] }) => {
      const count = (req.messages[0].text.match(/^E\d+$/gm) ?? []).length;
      return { items: Array.from({ length: count }, (_, i) => ({ exp: `E${i + 1}`, done: ["줄"], results: [] })) };
    },
  ]);

  const made = await startCommonCareer(db, ai, "u1", trackId, now);

  if (!made.ok) throw new Error(made.reason);
  expect((ai.requests[0].messages[0].text.match(/^E\d+$/gm) ?? []).length).toBe(30);
  const content = (await getCareer(db, "u1", made.id))?.content;
  expect(content?.companies.map((c) => [c.experienceId, c.items.length])).toEqual([
    [recent, 29],
    [old, 1],
  ]);
  expect(content?.companies[1].items[0].heading.name).toBe("옛1");
});

test("공통본이 이미 있으면 exists이고 AI를 부르지 않는다, 남의 트랙은 not_found", async () => {
  await commonWithTwo();
  const ai = createFakeAi([reply(["E1", ["줄"]])]);
  expect(await startCommonCareer(db, ai, "u1", trackId, now)).toEqual({ ok: false, reason: "exists" });
  expect(await startCommonCareer(db, ai, "u1", otherTrack, now)).toEqual({ ok: false, reason: "not_found" });
  expect(await startCommonCareer(db, ai, "u2", trackId, now)).toEqual({ ok: false, reason: "not_found" });
  expect(ai.requests).toHaveLength(0);
});

test("refused·over_limit을 그대로 돌려주고 공통본은 생기지 않는다", async () => {
  const jobId = await fact("job", job);
  await addScene(scene({ kind: "job", id: jobId }));
  expect(await startCommonCareer(db, createFakeAi([{ fail: "refused" }]), "u1", trackId, now)).toEqual({ ok: false, reason: "refused" });
  process.env.AI_MONTHLY_LIMIT_USD = "0";
  const ai = createFakeAi([reply(["E1", ["줄"]])]);
  expect(await startCommonCareer(db, ai, "u1", trackId, now)).toEqual({ ok: false, reason: "over_limit" });
  expect(ai.requests).toHaveLength(0);
  expect(await getCommonCareer(db, "u1", trackId)).toBeNull();
});

// ── writeCareerItems ──

test("요청이 없으면 writeCareerItems는 AI를 부르지 않고 빈 값", async () => {
  const ai = createFakeAi([]);
  const result = await writeCareerItems(db, ai, "u1", { requests: [], posting: null }, now);
  expect(result).toEqual({ ok: true, value: {}, answered: new Set() });
  expect(ai.requests).toHaveLength(0);
});

test("writeCareerItems는 별명을 항목 id로 바꾸고 강조면 공고와 함께 보낸다", async () => {
  const jobId = await fact("job", job);
  const a = await addScene(scene({ kind: "job", id: jobId }, { title: "사례A" }));
  const b = await addScene(scene({ kind: "job", id: jobId }, { title: "사례B", startMonth: "2022-05" }));
  const [source] = await listCareerSources(db, "u1", trackId);
  const [itemA, itemB] = source.items;
  const ai = createFakeAi([reply(["E1", ["A 줄"], ["A 성과"]])]);

  const result = await writeCareerItems(
    db,
    ai,
    "u1",
    {
      requests: [
        { companyId: jobId, item: itemA, detail: "full", emphasize: true },
        { companyId: jobId, item: itemB, detail: "summary", emphasize: false },
      ],
      posting: { text: "공고 글", requirements: ["Java"] },
    },
    now,
  );

  expect(result).toEqual({ ok: true, value: { [a]: { done: ["A 줄"], results: ["A 성과"] }, [b]: { done: [], results: [] } }, answered: new Set([a]) });
  const sent = ai.requests[0].messages[0].text;
  expect(sent.startsWith("[공고]\n공고 글\n\n[공고 요구 사항]\nJava\n\n[경력기술서 항목]\nE1\n")).toBe(true);
  expect(sent.match(/- 공고에 맞춰 강조: 예/g)).toHaveLength(1);
});

// ── 다시 쓰기 ──

test("다시 쓰기: version이 다르면 AI 없이 changed, 없거나 남의 경력기술서는 not_found", async () => {
  const { a, id, career } = await commonWithTwo();
  const ai = createFakeAi([reply(["E1", ["줄"]])]);
  expect(await rewriteCareerItems(db, ai, "u1", id, [a], career.version + 1, now)).toEqual({ ok: false, reason: "changed" });
  expect(await rewriteCareerItems(db, ai, "u1", "없는-id", [a], 1, now)).toEqual({ ok: false, reason: "not_found" });
  expect(await rewriteCareerItems(db, ai, "u2", id, [a], career.version, now)).toEqual({ ok: false, reason: "not_found" });
  expect(ai.requests).toHaveLength(0);
});

test("다시 쓰기는 고른 항목만 바꾸고 다른 항목의 줄(직접 고친 줄 포함)은 그대로", async () => {
  const { a, b, id, career } = await commonWithTwo();
  const edited: CareerContent = {
    ...career.content!,
    companies: career.content!.companies.map((c) => ({
      ...c,
      items: c.items.map((i) => (i.experienceId === b ? { ...i, done: [{ text: "내가 고친 줄", edited: true }] } : i)),
    })),
  };
  const saved = await saveCareerContent(db, "u1", id, edited, career.version);
  if (!saved.ok) throw new Error(saved.reason);
  const ai = createFakeAi([reply(["E1", ["새 A 줄"], ["새 A 성과"]])]);

  const result = await rewriteCareerItems(db, ai, "u1", id, [a], saved.version, now);

  if (!result.ok) throw new Error(result.reason);
  expect(itemOf(result.value, a)?.done).toEqual([{ text: "새 A 줄", edited: false }]);
  expect(itemOf(result.value, a)?.results).toEqual([{ text: "새 A 성과", edited: false }]);
  expect(itemOf(result.value, b)?.done).toEqual([{ text: "내가 고친 줄", edited: true }]);
  expect(allItems(result.value).map((i) => i.experienceId)).toEqual([a, b]);
  const stored = await getCareer(db, "u1", id);
  expect(stored?.content).toEqual(result.value);
  expect(stored?.version).toBe(saved.version + 1);
  expect(ai.requests[0].messages[0].text).not.toContain("사례B");
});

test("다시 쓰기: 빠진 항목을 그 회사 끝에 넣는다", async () => {
  const { jobId, a, b, id, career } = await commonWithTwo();
  const fresh = await addScene(scene({ kind: "job", id: jobId }, { title: "새 사례", startMonth: "2024-01" }));
  const ai = createFakeAi([reply(["E1", ["새 줄"]])]);

  const result = await rewriteCareerItems(db, ai, "u1", id, [fresh], career.version, now);

  if (!result.ok) throw new Error(result.reason);
  expect(allItems(result.value).map((i) => i.experienceId)).toEqual([a, b, fresh]);
  expect(itemOf(result.value, fresh)).toMatchObject({ detail: "full", done: [{ text: "새 줄", edited: false }] });
});

test("다시 쓰기: 경력 id만 주면 AI 없이 머리를 새로 고치고, 없는 회사는 항목 없이 넣는다", async () => {
  const { jobId, id, career } = await commonWithTwo();
  await updateFact(db, "u1", "job", jobId, { ...job, duties: ["새 담당 업무"] });
  await confirmFact(db, "u1", "job", jobId);
  const newer = await fact("job", { ...job, company: "새 회사", startMonth: "2024-09", endMonth: null, isOngoing: true });
  await addScene(scene({ kind: "job", id: newer }, { title: "새 회사 사례", startMonth: "2024-10" }));
  const ai = createFakeAi([]);

  const result = await rewriteCareerItems(db, ai, "u1", id, [jobId, newer], career.version, now);

  if (!result.ok) throw new Error(result.reason);
  expect(ai.requests).toHaveLength(0);
  expect(result.value.companies.map((c) => c.experienceId)).toEqual([newer, jobId]);
  expect(result.value.companies[0].items).toEqual([]);
  expect(result.value.companies[0].heading.company).toBe("새 회사");
  expect(result.value.companies[1].heading.duties).toEqual(["새 담당 업무"]);
  expect(result.value.companies[1].items).toEqual(career.content!.companies[0].items);
});

test("다시 쓰기: 없는 회사의 항목 id를 주면 회사를 만들어 넣는다", async () => {
  const { jobId, id, career } = await commonWithTwo();
  const newer = await fact("job", { ...job, company: "새 회사", startMonth: "2024-09", endMonth: null, isOngoing: true });
  const fresh = await addScene(scene({ kind: "job", id: newer }, { title: "새 회사 사례", startMonth: "2024-10" }));
  const ai = createFakeAi([reply(["E1", ["새 회사 줄"]])]);

  const result = await rewriteCareerItems(db, ai, "u1", id, [newer, fresh], career.version, now);

  if (!result.ok) throw new Error(result.reason);
  expect(result.value.companies.map((c) => [c.experienceId, c.items.map((i) => i.experienceId)])).toEqual([
    [newer, [fresh]],
    [jobId, career.content!.companies[0].items.map((i) => i.experienceId)],
  ]);
});

test("다시 쓰기: 다른 회사로 옮긴 프로젝트는 옛 회사에서 빼고 새 회사 끝에 넣는다", async () => {
  const first = await fact("job", job);
  const second = await fact("job", { ...job, company: "라마바 주식회사", startMonth: "2024-09", endMonth: null, isOngoing: true });
  const projectId = await fact("project", { ...project, parent: { kind: "job", id: first } });
  const made = await startCommonCareer(db, createFakeAi([reply(["E1", ["정산 줄"]])]), "u1", trackId, now);
  if (!made.ok) throw new Error(made.reason);
  await updateFact(db, "u1", "project", projectId, { ...project, parent: { kind: "job", id: second } });
  await confirmFact(db, "u1", "project", projectId);
  const career = await getCareer(db, "u1", made.id);
  const ai = createFakeAi([reply(["E1", ["옮긴 줄"]])]);

  const result = await rewriteCareerItems(db, ai, "u1", made.id, [projectId], career!.version, now);

  if (!result.ok) throw new Error(result.reason);
  expect(result.value.companies.map((c) => [c.experienceId, c.items.map((i) => i.experienceId)])).toEqual([
    [second, [projectId]],
    [first, []],
  ]);
  expect(texts(itemOf(result.value, projectId)?.done)).toEqual(["옮긴 줄"]);
});

test("다시 쓰기: 30개가 차도 옮긴 항목은 제 자리를 지켜 새 회사에 들어가고, 같이 보낸 새 항목은 들어가지 않는다", async () => {
  const first = await fact("job", job);
  const second = await fact("job", { ...job, company: "라마바 주식회사", startMonth: "2024-09", endMonth: null, isOngoing: true });
  const projectId = await fact("project", { ...project, parent: { kind: "job", id: first } });
  const made = await startCommonCareer(db, createFakeAi([reply(["E1", ["정산 줄"]])]), "u1", trackId, now);
  if (!made.ok) throw new Error(made.reason);
  const career = await getCareer(db, "u1", made.id);
  const filler = (n: number): CareerItem => ({ ...itemOf(career!.content, projectId)!, experienceId: `채움-${n}` });
  const padded: CareerContent = {
    ...career!.content!,
    companies: career!.content!.companies.map((c) => (c.experienceId === first ? { ...c, items: [...c.items, ...Array.from({ length: 29 }, (_, n) => filler(n))] } : c)),
  };
  const saved = await saveCareerContent(db, "u1", made.id, padded, career!.version);
  if (!saved.ok) throw new Error(saved.reason);
  await updateFact(db, "u1", "project", projectId, { ...project, parent: { kind: "job", id: second } });
  await confirmFact(db, "u1", "project", projectId);
  // 새 사례는 목록에서 옮긴 프로젝트보다 앞이다
  const fresh = await addScene(scene({ kind: "job", id: second }, { title: "새 사례", startMonth: "2024-10" }));
  const ai = createFakeAi([reply(["E1", ["옮긴 줄"]])]);

  const result = await rewriteCareerItems(db, ai, "u1", made.id, [fresh, projectId], saved.version, now);

  if (!result.ok) throw new Error(result.reason);
  expect(ai.requests[0].messages[0].text).toContain("E1\n- 이름: 사내 정산 도구");
  expect((ai.requests[0].messages[0].text.match(/^E\d+$/gm) ?? []).length).toBe(1);
  expect(result.value.companies.map((c) => [c.experienceId, c.items.length])).toEqual([
    [second, 1],
    [first, 29],
  ]);
  expect(texts(itemOf(result.value, projectId)?.done)).toEqual(["옮긴 줄"]);
  expect(itemOf(result.value, fresh)).toBeUndefined();
});

test("다시 쓰기: AI가 뺀 기존 항목은 그대로 둔다", async () => {
  const { a, b, id, career } = await commonWithTwo();
  const ai = createFakeAi([reply(["E2", ["B 새 줄"]])]); // E1(A)을 빠뜨림

  const result = await rewriteCareerItems(db, ai, "u1", id, [a, b], career.version, now);

  if (!result.ok) throw new Error(result.reason);
  expect(itemOf(result.value, a)).toEqual(itemOf(career.content, a));
  expect(itemOf(result.value, b)?.done).toEqual([{ text: "B 새 줄", edited: false }]);
});

test("다시 쓰기: 확인이 풀린 항목·남의 항목·없는 id만 보내면 none_selected이고 AI를 부르지 않는다", async () => {
  const { a, id, career } = await commonWithTwo();
  await db.update(scenes).set({ confirmedAt: null }).where(eq(scenes.id, a));
  const ai = createFakeAi([]);
  expect(await rewriteCareerItems(db, ai, "u1", id, [a, "없는-id"], career.version, now)).toEqual({ ok: false, reason: "none_selected" });
  expect(await rewriteCareerItems(db, ai, "u1", id, [], career.version, now)).toEqual({ ok: false, reason: "none_selected" });
  expect(ai.requests).toHaveLength(0);
});

test("다시 쓰기: 30개가 차면 새 항목은 full이고 있는 항목은 다시 쓸 수 있다", async () => {
  const { jobId, a, id, career } = await commonWithTwo();
  const filler = (n: number): CareerItem => ({ ...itemOf(career.content, a)!, experienceId: `채움-${n}` });
  const padded: CareerContent = {
    ...career.content!,
    companies: career.content!.companies.map((c) => ({ ...c, items: [...c.items, ...Array.from({ length: 28 }, (_, n) => filler(n))] })),
  };
  const saved = await saveCareerContent(db, "u1", id, padded, career.version);
  if (!saved.ok) throw new Error(saved.reason);
  const fresh = await addScene(scene({ kind: "job", id: jobId }, { title: "새 사례", startMonth: "2024-01" }));

  const none = createFakeAi([]);
  expect(await rewriteCareerItems(db, none, "u1", id, [fresh], saved.version, now)).toEqual({ ok: false, reason: "full" });
  expect(none.requests).toHaveLength(0);

  const ai = createFakeAi([reply(["E1", ["A 새 줄"]])]);
  const result = await rewriteCareerItems(db, ai, "u1", id, [fresh, a], saved.version, now);
  if (!result.ok) throw new Error(result.reason);
  expect((ai.requests[0].messages[0].text.match(/^E\d+$/gm) ?? []).length).toBe(1);
  expect(itemOf(result.value, fresh)).toBeUndefined();
  expect(texts(itemOf(result.value, a)?.done)).toEqual(["A 새 줄"]);
});

test("다시 쓰기: 공통본에서 요약만으로 바뀐 항목은 요약 분량으로 보낸다", async () => {
  const { a, id, career } = await commonWithTwo();
  await setSceneTrackScope(db, "u1", a, trackId, "summary");
  const ai = createFakeAi([reply(["E1", ["1", "2", "3"], ["r1", "r2"]])]);

  const result = await rewriteCareerItems(db, ai, "u1", id, [a], career.version, now);

  if (!result.ok) throw new Error(result.reason);
  expect(ai.requests[0].messages[0].text).toContain("- 분량: 요약(한 일 1~2줄, 성과 0~1줄)");
  expect(itemOf(result.value, a)).toMatchObject({ detail: "summary" });
  expect(itemOf(result.value, a)?.done).toHaveLength(2);
  expect(itemOf(result.value, a)?.results).toHaveLength(1);
});

test("다시 쓰기: AI가 쓰는 사이 다른 곳에서 고치면 changed이고 고친 내용이 남는다", async () => {
  const { a, id, career } = await commonWithTwo();
  const other: CareerContent = {
    ...career.content!,
    companies: career.content!.companies.map((c) => ({
      ...c,
      items: c.items.map((i) => (i.experienceId === a ? { ...i, done: [{ text: "다른 탭에서 고침", edited: true }] } : i)),
    })),
  };
  const ai = createFakeAi([
    async () => {
      expect((await saveCareerContent(db, "u1", id, other, career.version)).ok).toBe(true);
      return reply(["E1", ["AI가 쓴 줄"]]);
    },
  ]);

  expect(await rewriteCareerItems(db, ai, "u1", id, [a], career.version, now)).toEqual({ ok: false, reason: "changed" });
  expect(itemOf((await getCareer(db, "u1", id))?.content, a)?.done).toEqual([{ text: "다른 탭에서 고침", edited: true }]);
});

// ── 맞춤본 다시 쓰기 ──

async function tailoredFrom(career: { version: number; content: CareerContent | null }, postingId: string, map = (c: CareerContent) => c) {
  const content = map({ ...career.content!, commonVersion: career.version });
  const saved = await saveTailoredCareerContent(db, "u1", postingId, trackId, content, null);
  if (!saved.ok) throw new Error(saved.reason);
  const tailored = await getTailoredCareer(db, "u1", postingId);
  if (!tailored) throw new Error("없음");
  return tailored;
}

test("맞춤본 다시 쓰기는 그 항목의 분량과 강조를 지키고, 강조한 항목이 있을 때만 공고를 보낸다", async () => {
  const { a, b, career } = await commonWithTwo();
  const postingId = await addPosting();
  const tailored = await tailoredFrom(career, postingId, (c) => ({
    ...c,
    companies: c.companies.map((co) => ({
      ...co,
      items: co.items.map((i) => (i.experienceId === a ? { ...i, emphasized: true } : { ...i, detail: "summary" as const })),
    })),
  }));
  const ai = createFakeAi([reply(["E1", ["공고 맞춘 줄"]]), reply(["E1", ["요약 줄"]])]);

  const first = await rewriteCareerItems(db, ai, "u1", tailored.id, [a], tailored.version, now);
  if (!first.ok) throw new Error(first.reason);
  const sent = ai.requests[0].messages[0].text;
  expect(sent).toContain("[공고]\n가나다 주식회사 백엔드 개발자 채용");
  expect(sent).toContain("고객 문제를 끝까지 파고드는 사람");
  expect(sent).toContain("[공고 요구 사항]\nJava 실무 경력 3년 이상");
  expect(sent).toContain("- 공고에 맞춰 강조: 예");
  expect(itemOf(first.value, a)?.emphasized).toBe(true);
  expect(first.value.commonVersion).toBe(career.version);

  const second = await rewriteCareerItems(db, ai, "u1", tailored.id, [b], tailored.version + 1, now);
  if (!second.ok) throw new Error(second.reason);
  const sent2 = ai.requests[1].messages[0].text;
  expect(sent2).not.toContain("[공고]");
  expect(sent2).toContain("- 분량: 요약(한 일 1~2줄, 성과 0~1줄)");
  expect(itemOf(second.value, b)?.detail).toBe("summary");
});

test("맞춤본 다시 쓰기는 지원이 아니면 not_apply이고 AI를 부르지 않는다", async () => {
  const { a, career } = await commonWithTwo();
  const postingId = await addPosting(false);
  const tailored = await tailoredFrom(career, postingId);
  const ai = createFakeAi([]);
  expect(await rewriteCareerItems(db, ai, "u1", tailored.id, [a], tailored.version, now)).toEqual({ ok: false, reason: "not_apply" });
  expect(ai.requests).toHaveLength(0);
});

test("맞춤본 다시 쓰기는 제출로 잠기면 submitted이고, 쓰는 사이 제출해도 저장하지 않는다", async () => {
  const { a, career } = await commonWithTwo();
  const postingId = await addPosting();
  const tailored = await tailoredFrom(career, postingId);
  const ai = createFakeAi([
    async () => {
      expect(await submitPosting(db, "u1", postingId, 0)).toEqual({ ok: true, number: 1 });
      return reply(["E1", ["줄"]]);
    },
  ]);
  expect(await rewriteCareerItems(db, ai, "u1", tailored.id, [a], tailored.version, now)).toEqual({ ok: false, reason: "submitted" });
  expect((await getTailoredCareer(db, "u1", postingId))?.version).toBe(tailored.version);

  const again = createFakeAi([]);
  expect(await rewriteCareerItems(db, again, "u1", tailored.id, [a], tailored.version, now)).toEqual({ ok: false, reason: "submitted" });
  expect(again.requests).toHaveLength(0);
});

test("다시 쓰기: 한도를 넘으면 over_limit이고 저장하지 않는다", async () => {
  const { a, id, career } = await commonWithTwo();
  process.env.AI_MONTHLY_LIMIT_USD = "0";
  const ai = createFakeAi([reply(["E1", ["줄"]])]);
  expect(await rewriteCareerItems(db, ai, "u1", id, [a], career.version, now)).toEqual({ ok: false, reason: "over_limit" });
  expect(ai.requests).toHaveLength(0);
  expect((await getCareer(db, "u1", id))?.version).toBe(career.version);
});
