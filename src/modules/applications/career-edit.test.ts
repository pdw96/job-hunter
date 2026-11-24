import { eq } from "drizzle-orm";
import { beforeEach, expect, test } from "vitest";
import { createTestDb } from "@/db/test-db";
import type { Db } from "@/db/types";
import { createFakeAi } from "@/modules/ai/fake-client";
import { user } from "@/modules/auth/schema";
import { createFact } from "@/modules/experiences/facts-repo";
import type { FactInputs, JobInput, SceneInput } from "@/modules/experiences/record-input";
import type { FactKind } from "@/modules/experiences/record-options";
import { confirmScene, createScene } from "@/modules/experiences/scenes-repo";
import { scenes } from "@/modules/experiences/schema";
import type { AppliedScore, PostingAnalysis } from "@/modules/postings/analysis";
import { validatePosting } from "@/modules/postings/input";
import { applyToPosting, createPosting, getPosting, saveAnalysis, setStatus } from "@/modules/postings/repo";
import { createTrack } from "@/modules/tracks/repo";
import type { SurveyInput } from "@/modules/tracks/survey";
import { careers } from "./schema";
import { getCareer, getTailoredCareer, saveTailoredCareerContent } from "./career-repo";
import { editCareer } from "./career-edit";
import { startCommonCareer } from "./career-write";
import { reopenPosting, submitPosting } from "./submit";

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
  duties: ["결제 서버 운영", "장애 대응"],
  bannedPhrases: ["주도"],
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
  if (!mine.ok) throw new Error("트랙을 만들지 못함");
  trackId = mine.id;
});


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


const texts = (lines: { text: string }[] | undefined) => lines?.map((l) => l.text);

test("한 일 줄을 고치면 그 줄만 edited가 되고 성과는 그대로다", async () => {
  const { a, id, career } = await commonWithTwo();
  const result = await editCareer(db, "u1", id, { type: "lines", itemId: a, field: "done", text: "A 한 일\n- 새 줄" }, career.version);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  const item = result.value.companies[0].items[0];
  expect(item.done).toEqual([
    { text: "A 한 일", edited: false },
    { text: "새 줄", edited: true },
  ]);
  expect(texts(item.results)).toEqual(["A 성과"]);
  const saved = await getCareer(db, "u1", id);
  expect(saved?.content).toEqual(result.value);
  expect(saved?.version).toBe(career.version + 1);
});

test("성과 줄을 비우면 빈 배열이 된다", async () => {
  const { a, id, career } = await commonWithTwo();
  const result = await editCareer(db, "u1", id, { type: "lines", itemId: a, field: "results", text: " \n " }, career.version);
  expect(result.ok && result.value.companies[0].items[0].results).toEqual([]);
});

test("9줄은 too_many_lines, 151자는 too_long이고 저장하지 않는다", async () => {
  const { a, id, career } = await commonWithTwo();
  const nine = Array.from({ length: 9 }, (_, i) => `줄${i}`).join("\n");
  expect(await editCareer(db, "u1", id, { type: "lines", itemId: a, field: "done", text: nine }, career.version)).toEqual({ ok: false, reason: "too_many_lines" });
  expect(await editCareer(db, "u1", id, { type: "lines", itemId: a, field: "done", text: "가".repeat(151) }, career.version)).toEqual({ ok: false, reason: "too_long" });
  expect((await getCareer(db, "u1", id))?.version).toBe(career.version);
  const eight = Array.from({ length: 8 }, (_, i) => `줄${i}`).join("\n");
  expect((await editCareer(db, "u1", id, { type: "lines", itemId: a, field: "results", text: eight }, career.version)).ok).toBe(true);
});

test("위로·아래로 옮기고, 항목 id로 빼면 그 항목만 빠진다", async () => {
  const { a, b, id, career } = await commonWithTwo();
  const down = await editCareer(db, "u1", id, { type: "move", itemId: a, direction: "down" }, career.version);
  expect(down.ok && down.value.companies[0].items.map((i) => i.experienceId)).toEqual([b, a]);
  const removed = await editCareer(db, "u1", id, { type: "remove", itemId: a }, career.version + 1);
  expect(removed.ok && removed.value.companies[0].items.map((i) => i.experienceId)).toEqual([b]);
});

test("경력 id로 빼면 회사째 빠진다", async () => {
  const { jobId, id, career } = await commonWithTwo();
  const removed = await editCareer(db, "u1", id, { type: "remove", itemId: jobId }, career.version);
  expect(removed.ok && removed.value.companies).toEqual([]);
  expect((await getCareer(db, "u1", id))?.content?.companies).toEqual([]);
});

test("옮길 것이 없으면(맨 위에서 위로) 저장하지 않고 version 그대로다", async () => {
  const { a, id, career } = await commonWithTwo();
  const result = await editCareer(db, "u1", id, { type: "move", itemId: a, direction: "up" }, career.version);
  expect(result).toEqual({ ok: true, value: career.content });
  expect((await getCareer(db, "u1", id))?.version).toBe(career.version);
});

test("회사 경계에서 옮기기는 저장하지 않고 version 그대로다", async () => {
  const recent = await fact("job", { ...job, company: "최근 회사", startMonth: "2024-09", endMonth: null, isOngoing: true });
  const old = await fact("job", job);
  const r = await addScene(scene({ kind: "job", id: recent }, { title: "최근 사례" }));
  const o = await addScene(scene({ kind: "job", id: old }, { title: "옛 사례" }));
  const made = await startCommonCareer(db, createFakeAi([reply(["E1", ["r"]], ["E2", ["o"]])]), "u1", trackId, now);
  if (!made.ok) throw new Error(made.reason);
  const career = await getCareer(db, "u1", made.id);
  expect(career?.content?.companies.map((c) => c.items[0].experienceId)).toEqual([r, o]);

  const down = await editCareer(db, "u1", made.id, { type: "move", itemId: r, direction: "down" }, career!.version);
  expect(down).toEqual({ ok: true, value: career!.content });
  const up = await editCareer(db, "u1", made.id, { type: "move", itemId: o, direction: "up" }, career!.version);
  expect(up).toEqual({ ok: true, value: career!.content });
  expect((await getCareer(db, "u1", made.id))?.version).toBe(career!.version);
});

test("version이 다르면 changed, 없는 항목 id면 changed, 내용이 없어도 changed", async () => {
  const { a, id, career } = await commonWithTwo();
  expect(await editCareer(db, "u1", id, { type: "remove", itemId: a }, career.version + 5)).toEqual({ ok: false, reason: "changed" });
  expect(await editCareer(db, "u1", id, { type: "lines", itemId: "없는-id", field: "done", text: "x" }, career.version)).toEqual({ ok: false, reason: "changed" });
  expect(await editCareer(db, "u1", id, { type: "move", itemId: "없는-id", direction: "up" }, career.version)).toEqual({ ok: false, reason: "changed" });
  expect(await editCareer(db, "u1", id, { type: "remove", itemId: "없는-id" }, career.version)).toEqual({ ok: false, reason: "changed" });
  // 경력 id는 빼기에서만 쓴다
  const jobId = career.content!.companies[0].experienceId;
  expect(await editCareer(db, "u1", id, { type: "lines", itemId: jobId, field: "done", text: "x" }, career.version)).toEqual({ ok: false, reason: "changed" });
  expect(await editCareer(db, "u1", id, { type: "move", itemId: jobId, direction: "down" }, career.version)).toEqual({ ok: false, reason: "changed" });
  await db.update(careers).set({ content: null }).where(eq(careers.id, id));
  expect(await editCareer(db, "u1", id, { type: "remove", itemId: a }, career.version)).toEqual({ ok: false, reason: "changed" });
});

test("남의 경력기술서와 없는 경력기술서는 not_found", async () => {
  const { a, id, career } = await commonWithTwo();
  expect(await editCareer(db, "u2", id, { type: "remove", itemId: a }, career.version)).toEqual({ ok: false, reason: "not_found" });
  expect(await editCareer(db, "u1", "없는-id", { type: "remove", itemId: a }, 1)).toEqual({ ok: false, reason: "not_found" });
  expect((await getCareer(db, "u1", id))?.content).toEqual(career.content);
});

test("맞춤본은 지원 공고일 때만 고치고, 보류로 바뀐 공고는 not_apply", async () => {
  const { a, career } = await commonWithTwo();
  const postingId = await addPosting(true);
  const saved = await saveTailoredCareerContent(db, "u1", postingId, trackId, { ...career.content!, commonVersion: career.version }, null);
  if (!saved.ok) throw new Error(saved.reason);
  const tailored = await getTailoredCareer(db, "u1", postingId);
  if (!tailored) throw new Error("없음");

  expect((await editCareer(db, "u1", tailored.id, { type: "lines", itemId: a, field: "done", text: "맞춤 줄" }, tailored.version)).ok).toBe(true);

  const after = await getTailoredCareer(db, "u1", postingId);
  await setStatus(db, "u1", postingId, "hold");
  expect((await getPosting(db, "u1", postingId))?.status).not.toBe("apply");
  expect(await editCareer(db, "u1", tailored.id, { type: "remove", itemId: a }, after!.version)).toEqual({ ok: false, reason: "not_apply" });
});

test("제출로 잠긴 공고의 맞춤본은 submitted이고, 공통본은 고칠 수 있고, 다시 열면 고친다", async () => {
  const { a, id, career } = await commonWithTwo();
  const postingId = await addPosting(true);
  const saved = await saveTailoredCareerContent(db, "u1", postingId, trackId, { ...career.content!, commonVersion: career.version }, null);
  if (!saved.ok) throw new Error(saved.reason);
  const tailored = await getTailoredCareer(db, "u1", postingId);
  if (!tailored) throw new Error("없음");
  expect(await submitPosting(db, "u1", postingId, 0)).toEqual({ ok: true, number: 1 });

  expect(await editCareer(db, "u1", tailored.id, { type: "lines", itemId: a, field: "done", text: "맞춤 줄" }, tailored.version)).toEqual({ ok: false, reason: "submitted" });
  expect((await getTailoredCareer(db, "u1", postingId))?.content).toEqual(tailored.content);

  expect((await editCareer(db, "u1", id, { type: "lines", itemId: a, field: "done", text: "공통 줄" }, career.version)).ok).toBe(true);

  expect(await reopenPosting(db, "u1", postingId, 1)).toEqual({ ok: true });
  expect((await editCareer(db, "u1", tailored.id, { type: "lines", itemId: a, field: "done", text: "맞춤 줄" }, tailored.version)).ok).toBe(true);
});
