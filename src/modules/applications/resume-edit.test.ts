import { eq } from "drizzle-orm";
import { beforeEach, expect, test, vi } from "vitest";
import { createTestDb } from "@/db/test-db";
import type { Db } from "@/db/types";
import { createFakeAi } from "@/modules/ai/fake-client";
import { user } from "@/modules/auth/schema";
import type { ExperienceInput } from "@/modules/experiences/input";
import { confirmExperience, createExperience } from "@/modules/experiences/repo";
import { experiences } from "@/modules/experiences/schema";
import type { AppliedScore, PostingAnalysis } from "@/modules/postings/analysis";
import { validatePosting } from "@/modules/postings/input";
import { applyToPosting, createPosting, getPosting, saveAnalysis, setStatus } from "@/modules/postings/repo";
import { createTrack } from "@/modules/tracks/repo";
import type { SurveyInput } from "@/modules/tracks/survey";
import { editResume } from "./resume-edit";
import { getResume, getTailoredResume, saveTailoredContent } from "./resume-repo";
import { reopenPosting, submitPosting } from "./submit";
import { startCommonResume } from "./resume-write";
import { resumes } from "./schema";

// 이 파일의 예시는 옛 표(createExperience)로 원천을 만든다. 스위치(newRecordsOn)는 5-4부터 늘 켜져 있으므로
// 원천 읽기(sources.ts)를 옛 표로 고정한다(자소서·이력서 로직은 원천 모양만 본다)
vi.mock("@/modules/experiences/switch", () => ({ newRecordsOn: () => false }));
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

const reply = (...entries: [string, string[]][]) => ({ entries: entries.map(([exp, lines]) => ({ exp, lines })) });

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

// 시작 월이 늦은 것이 E1(경험A)이다. 공통본을 만들어 둔다
async function commonWithTwo() {
  const a = await addExperience({ name: "경험A", startMonth: "2023-03" });
  const b = await addExperience({ name: "경험B", startMonth: "2022-03" });
  const ai = createFakeAi([reply(["E1", ["A 줄1", "A 줄2"]], ["E2", ["B 줄1"]])]);
  const made = await startCommonResume(db, ai, "u1", trackId, now);
  if (!made.ok) throw new Error(made.reason);
  const resume = await getResume(db, "u1", made.id);
  if (!resume?.content) throw new Error("내용 없음");
  return { a, b, id: made.id, resume };
}

test("줄을 고치면 바꾼 줄만 edited가 된다", async () => {
  const { a, id, resume } = await commonWithTwo();
  const result = await editResume(db, "u1", id, { type: "lines", experienceId: a, text: "A 줄1\n- 새 줄" }, resume.version);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.value.entries[0].lines).toEqual([
    { text: "A 줄1", edited: false },
    { text: "새 줄", edited: true },
  ]);
  const saved = await getResume(db, "u1", id);
  expect(saved?.content).toEqual(result.value);
  expect(saved?.version).toBe(resume.version + 1);
});

test("빈 글이면 줄이 없는 항목이 된다", async () => {
  const { a, id, resume } = await commonWithTwo();
  const result = await editResume(db, "u1", id, { type: "lines", experienceId: a, text: "  \n " }, resume.version);
  expect(result.ok && result.value.entries[0].lines).toEqual([]);
});

test("9줄은 too_many_lines, 151자는 too_long이고 저장하지 않는다", async () => {
  const { a, id, resume } = await commonWithTwo();
  const nine = Array.from({ length: 9 }, (_, i) => `줄${i}`).join("\n");
  expect(await editResume(db, "u1", id, { type: "lines", experienceId: a, text: nine }, resume.version)).toEqual({ ok: false, reason: "too_many_lines" });
  expect(await editResume(db, "u1", id, { type: "lines", experienceId: a, text: "가".repeat(151) }, resume.version)).toEqual({ ok: false, reason: "too_long" });
  const eight = Array.from({ length: 8 }, (_, i) => `줄${i}`).join("\n");
  expect((await editResume(db, "u1", id, { type: "lines", experienceId: a, text: `${eight}` }, resume.version)).ok).toBe(true);
  expect((await getResume(db, "u1", id))?.version).toBe(resume.version + 1);
});

test("위로·아래로·빼기", async () => {
  const { a, b, id, resume } = await commonWithTwo();
  const down = await editResume(db, "u1", id, { type: "move", experienceId: a, direction: "down" }, resume.version);
  expect(down.ok && down.value.entries.map((e) => e.experienceId)).toEqual([b, a]);
  const up = await editResume(db, "u1", id, { type: "move", experienceId: a, direction: "up" }, resume.version + 1);
  expect(up.ok && up.value.entries.map((e) => e.experienceId)).toEqual([a, b]);
  const removed = await editResume(db, "u1", id, { type: "remove", experienceId: a }, resume.version + 2);
  expect(removed.ok && removed.value.entries.map((e) => e.experienceId)).toEqual([b]);
});

test("바뀐 것이 없으면(맨 위에서 위로) 저장하지 않고 지금 내용을 돌려준다", async () => {
  const { a, id, resume } = await commonWithTwo();
  const result = await editResume(db, "u1", id, { type: "move", experienceId: a, direction: "up" }, resume.version);
  expect(result).toEqual({ ok: true, value: resume.content });
  expect((await getResume(db, "u1", id))?.version).toBe(resume.version);
});

test("version이 다르면 changed, 그 경험의 항목이 없어도 changed", async () => {
  const { a, id, resume } = await commonWithTwo();
  expect(await editResume(db, "u1", id, { type: "remove", experienceId: a }, resume.version + 5)).toEqual({ ok: false, reason: "changed" });
  expect(await editResume(db, "u1", id, { type: "lines", experienceId: "없는-id", text: "x" }, resume.version)).toEqual({ ok: false, reason: "changed" });
  expect(await editResume(db, "u1", id, { type: "move", experienceId: "없는-id", direction: "up" }, resume.version)).toEqual({ ok: false, reason: "changed" });
  await db.update(resumes).set({ content: null }).where(eq(resumes.id, id));
  expect(await editResume(db, "u1", id, { type: "remove", experienceId: a }, resume.version)).toEqual({ ok: false, reason: "changed" });
});

test("남의 이력서와 없는 이력서는 not_found", async () => {
  const { a, id, resume } = await commonWithTwo();
  expect(await editResume(db, "u2", id, { type: "remove", experienceId: a }, resume.version)).toEqual({ ok: false, reason: "not_found" });
  expect(await editResume(db, "u1", "없는-id", { type: "remove", experienceId: a }, 1)).toEqual({ ok: false, reason: "not_found" });
  expect((await getResume(db, "u1", id))?.content).toEqual(resume.content);
});

test("맞춤본은 지원 공고일 때만 고치고, 보류로 바뀐 공고의 맞춤본은 not_apply이지만 읽힌다", async () => {
  const { a, resume } = await commonWithTwo();
  const postingId = await addPosting(true);
  const saved = await saveTailoredContent(db, "u1", postingId, trackId, { ...resume.content!, commonVersion: resume.version }, null);
  if (!saved.ok) throw new Error(saved.reason);
  const tailored = await getTailoredResume(db, "u1", postingId);
  if (!tailored) throw new Error("없음");

  const ok = await editResume(db, "u1", tailored.id, { type: "lines", experienceId: a, text: "맞춤 줄" }, tailored.version);
  expect(ok.ok).toBe(true);

  const after = await getTailoredResume(db, "u1", postingId);
  await setStatus(db, "u1", postingId, "hold");
  expect((await getPosting(db, "u1", postingId))?.status).not.toBe("apply");
  expect(await editResume(db, "u1", tailored.id, { type: "remove", experienceId: a }, after!.version)).toEqual({ ok: false, reason: "not_apply" });
  expect(await getTailoredResume(db, "u1", postingId)).not.toBeNull();
});

test("제출한 공고의 맞춤본은 submitted이고, 같은 트랙의 공통본은 그래도 고칠 수 있다", async () => {
  const { a, id, resume } = await commonWithTwo();
  const postingId = await addPosting(true);
  const saved = await saveTailoredContent(db, "u1", postingId, trackId, { ...resume.content!, commonVersion: resume.version }, null);
  if (!saved.ok) throw new Error(saved.reason);
  const tailored = await getTailoredResume(db, "u1", postingId);
  if (!tailored) throw new Error("없음");
  expect(await submitPosting(db, "u1", postingId, 0)).toEqual({ ok: true, number: 1 });

  expect(await editResume(db, "u1", tailored.id, { type: "lines", experienceId: a, text: "맞춤 줄" }, tailored.version)).toEqual({ ok: false, reason: "submitted" });
  expect((await getTailoredResume(db, "u1", postingId))?.content).toEqual(tailored.content);

  const common = await editResume(db, "u1", id, { type: "lines", experienceId: a, text: "공통 줄" }, resume.version);
  expect(common.ok).toBe(true);

  expect(await reopenPosting(db, "u1", postingId, 1)).toEqual({ ok: true });
  const again = await editResume(db, "u1", tailored.id, { type: "lines", experienceId: a, text: "맞춤 줄" }, tailored.version);
  expect(again.ok).toBe(true);
});
