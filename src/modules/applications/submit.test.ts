import { and, eq, isNull } from "drizzle-orm";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createTestDb } from "@/db/test-db";
import type { Db } from "@/db/types";
import { user } from "@/modules/auth/schema";
import type { ExperienceInput } from "@/modules/experiences/input";
import { confirmExperience, createExperience, deleteExperience, updateExperience } from "@/modules/experiences/repo";
import { experiences } from "@/modules/experiences/schema";
import type { AppliedScore, PostingAnalysis } from "@/modules/postings/analysis";
import { validatePosting } from "@/modules/postings/input";
import { applyToPosting, createPosting, getPosting, saveAnalysis, setChosenDocuments, setStatus, updatePosting } from "@/modules/postings/repo";
import { saveContact } from "@/modules/profile/repo";
import { createTrack } from "@/modules/tracks/repo";
import type { SurveyInput } from "@/modules/tracks/survey";
import { addQuestions, createDraft, listQuestions } from "./repo";
import { editResume } from "./resume-edit";
import { getTailoredResume, insertCommonResume, saveTailoredContent } from "./resume-repo";
import { resumes } from "./schema";
import { editParagraph } from "./write";
import { freeze, reopenPosting, submitPosting, submitPreview } from "./submit";
import { getSubmission, listSubmissions } from "./submission-repo";
import type { Draft, ResumeContent, ResumeEntry, SubmittedResume } from "./types";
import type { Posting } from "@/modules/postings/repo";

// 이 파일의 예시는 대부분 옛 표(createExperience)로 원천을 만든다. 스위치(newRecordsOn)는 5-4부터 늘 켜져 있으므로
// 원천 읽기(sources.ts)를 옛 표로 고정하고, 새 표를 쓰는 테스트에서만 켠다(자소서·이력서·채점 로직은 원천 모양만 본다)
const recordSwitch = vi.hoisted(() => ({ on: false }));
// 옛 표를 지우는 계획에서 예시를 새 표로 옮기고 이 모의를 걷어 낸다
vi.mock("@/modules/experiences/switch", () => ({ newRecordsOn: () => recordSwitch.on }));
afterEach(() => {
  recordSwitch.on = false;
});

let db: Db;
let trackId: string;
const now = new Date("2026-11-19T03:00:00Z");

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
const rawText = "가나다 주식회사 백엔드 개발자 채용\n자격 요건\n- Java 실무 경력 3년 이상";
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
  evidenceNote: "",
  tags: [],
};

async function addExperience(over: Partial<ExperienceInput> = {}) {
  const id = await createExperience(db, "u1", { ...job, ...over });
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
  const [row] = await db.select({ version: experiences.contentVersion }).from(experiences).where(eq(experiences.id, id));
  versions.set(id, row.version);
  return id;
}
const versions = new Map<string, number>();

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
let otherTrack: string;

const entryOf = (experienceId: string, text: string, over: Partial<ResumeEntry> = {}): ResumeEntry => ({
  experienceId,
  contentVersion: versions.get(experienceId) ?? 1,
  kind: "project",
  heading: { name: "결제 시스템 개편", organization: "라마바 주식회사", role: "백엔드 개발", period: "2023.03 ~ 2023.11" },
  detail: "full",
  emphasized: false,
  lines: [{ text, edited: false }],
  writtenAt: now.toISOString(),
  ...over,
});
const resumeOf = (entries: ResumeEntry[], commonVersion: number | null): ResumeContent => ({ entries, commonVersion });

async function addQuestion(postingId: string, prompt: string, charLimit: number | null = null) {
  const added = await addQuestions(db, "u1", postingId, [{ prompt, charLimit, countSpaces: true }]);
  if (!added.ok) throw new Error(added.reason);
  return added.ids[0];
}
async function putDraft(questionId: string, texts: string[], sources: string[] = []) {
  const [question] = (await listQuestions(db, "u1", (await findPostingOf(questionId)))).filter((q) => q.id === questionId);
  const draft: Draft = {
    questionVersion: question.version,
    basedOn: sources.map((experienceId) => ({ experienceId, contentVersion: versions.get(experienceId) ?? 1 })),
    paragraphs: texts.map((text) => ({ text, sources, edited: false })),
    shortage: "",
    writtenAt: now.toISOString(),
  };
  const saved = await createDraft(db, "u1", questionId, draft);
  if (!saved.ok) throw new Error(saved.reason);
  return draft;
}
let postingOfQuestion = new Map<string, string>();
async function findPostingOf(questionId: string) {
  const id = postingOfQuestion.get(questionId);
  if (!id) throw new Error("문항의 공고를 모름");
  return id;
}
async function addQuestionWithDraft(postingId: string, prompt: string, texts: string[] | null, charLimit: number | null = null, sources: string[] = []) {
  const id = await addQuestion(postingId, prompt, charLimit);
  postingOfQuestion.set(id, postingId);
  if (texts) await putDraft(id, texts, sources);
  return id;
}

beforeEach(async () => {
  postingOfQuestion = new Map();
  db = await createTestDb();
  await db.insert(user).values([
    { id: "u1", name: "A", email: "u1@example.com" },
    { id: "u2", name: "B", email: "u2@example.com" },
  ]);
  const mine = await createTrack(db, "u1", survey);
  const theirs = await createTrack(db, "u2", survey);
  if (!mine.ok || !theirs.ok) throw new Error("트랙을 만들지 못함");
  trackId = mine.id;
  otherTrack = theirs.id;
});

test("freeze: 이름에 없는 경험은 지운 경험으로 적는다", async () => {
  const postingId = await addPosting();
  const posting = (await getPosting(db, "u1", postingId)) as Posting;
  const resume: SubmittedResume | null = null;
  const questions = [
    {
      id: "q1", postingId, position: 0, version: 1, selection: null, createdAt: now, updatedAt: now,
      prompt: "지원 동기", charLimit: 500, countSpaces: true,
      draft: { questionVersion: 1, basedOn: [], paragraphs: [{ text: "답", sources: ["e1", "gone"], edited: false }], shortage: "", writtenAt: now.toISOString() },
    },
  ];
  const content = freeze(posting, questions, resume, new Map([["e1", "결제 개편"]]));
  expect(content.answers[0].paragraphs[0].sources).toEqual([
    { experienceId: "e1", name: "결제 개편" },
    { experienceId: "gone", name: "지운 경험" },
  ]);
  expect(content.posting).toMatchObject({ company: "가나다 주식회사", rawText, companyNote: raw.companyNote });
});

test("제출본 내용: 맞춤본이 있으면 tailored, 문항은 순서대로, 답 없는 문항은 빈 문단, 연락처는 없다", async () => {
  const exp = await addExperience();
  const postingId = await addPosting();
  await insertCommonResume(db, "u1", trackId, resumeOf([entryOf(exp, "공통본 줄")], null));
  await saveTailoredContent(db, "u1", postingId, trackId, resumeOf([entryOf(exp, "맞춤본 줄")], 1), null);
  await addQuestionWithDraft(postingId, "지원 동기", ["결제 개편 경험을 했다"], null, [exp]);
  await addQuestionWithDraft(postingId, "성장 과정", null);
  await saveContact(db, "u1", { legalName: "홍길동", phone: "010-9876-5432", address: "서울시 어딘가", birthDate: "1995-01-02", contactEmail: "a@b.example" });

  expect(await submitPosting(db, "u1", postingId, 0, now)).toEqual({ ok: true, number: 1 });
  const saved = await getSubmission(db, "u1", postingId, 1);
  expect(saved?.content.resume?.from).toBe("tailored");
  expect(saved?.content.resume?.content.entries[0].lines[0].text).toBe("맞춤본 줄");
  expect(saved?.content.answers.map((a) => a.prompt)).toEqual(["지원 동기", "성장 과정"]);
  expect(saved?.content.answers[0].paragraphs[0].sources).toEqual([{ experienceId: exp, name: "결제 시스템 개편" }]);
  expect(saved?.content.answers[1].paragraphs).toEqual([]);
  const json = JSON.stringify(saved?.content);
  for (const secret of ["010-9876-5432", "서울시 어딘가", "1995-01-02", "홍길동"]) expect(json).not.toContain(secret);
});

test("맞춤본이 없으면 공통본, 둘 다 없으면 null", async () => {
  const exp = await addExperience();
  const first = await addPosting();
  expect(await submitPosting(db, "u1", first, 0, now)).toEqual({ ok: true, number: 1 });
  expect((await getSubmission(db, "u1", first, 1))?.content.resume).toBeNull();

  await insertCommonResume(db, "u1", trackId, resumeOf([entryOf(exp, "공통본 줄")], null));
  const second = await addPosting();
  expect(await submitPosting(db, "u1", second, 0, now)).toEqual({ ok: true, number: 1 });
  expect((await getSubmission(db, "u1", second, 1))?.content.resume?.from).toBe("common");
});

test("얼린 뒤 원본을 고쳐도 제출본은 그대로", async () => {
  const exp = await addExperience();
  const postingId = await addPosting();
  await insertCommonResume(db, "u1", trackId, resumeOf([entryOf(exp, "공통본 줄")], null));
  await saveTailoredContent(db, "u1", postingId, trackId, resumeOf([entryOf(exp, "맞춤본 줄")], 1), null);
  const questionId = await addQuestionWithDraft(postingId, "지원 동기", ["결제 개편 경험을 했다"], null, [exp]);

  expect(await submitPosting(db, "u1", postingId, 0, now)).toEqual({ ok: true, number: 1 });
  const before = (await getSubmission(db, "u1", postingId, 1))?.content;
  expect(await reopenPosting(db, "u1", postingId, 1, now)).toEqual({ ok: true });

  const [question] = await listQuestions(db, "u1", postingId);
  const edited = await editParagraph(db, "u1", questionId, 0, "고친 답", question.draft as Draft);
  expect(edited.ok).toBe(true);
  const tailored = await getTailoredResume(db, "u1", postingId);
  const fixed = await editResume(db, "u1", tailored!.id, { type: "lines", experienceId: exp, text: "고친 줄" }, tailored!.version);
  expect(fixed.ok).toBe(true);
  await updateExperience(db, "u1", exp, { ...job, name: "새 이름" });
  const checked = validatePosting({ ...raw, rawText: "바뀐 원문" });
  if (!checked.ok) throw new Error("공고 입력 오류");
  await updatePosting(db, "u1", postingId, checked.value);
  await deleteExperience(db, "u1", exp);

  expect((await getSubmission(db, "u1", postingId, 1))?.content).toEqual(before);
});

test("두 번 제출하면 둘째는 changed이고, 동시에 제출해도 하나만 된다", async () => {
  const postingId = await addPosting();
  expect(await submitPosting(db, "u1", postingId, 0, now)).toEqual({ ok: true, number: 1 });
  expect(await submitPosting(db, "u1", postingId, 0, now)).toEqual({ ok: false, reason: "changed" });
  expect(await listSubmissions(db, "u1", postingId)).toHaveLength(1);

  const other = await addPosting();
  const results = await Promise.all([submitPosting(db, "u1", other, 0, now), submitPosting(db, "u1", other, 0, now)]);
  expect(results.filter((r) => r.ok)).toHaveLength(1);
  expect(await listSubmissions(db, "u1", other)).toHaveLength(1);
});

test("지원이 아닌 공고와 남의 공고는 낼 수 없고, 보류해도 제출본은 읽힌다", async () => {
  const postingId = await addPosting();
  expect(await submitPosting(db, "u1", postingId, 0, now)).toEqual({ ok: true, number: 1 });
  await setStatus(db, "u1", postingId, "hold");
  expect(await getSubmission(db, "u1", postingId, 1)).not.toBeNull();
  expect(await submitPosting(db, "u1", postingId, 1, now)).toEqual({ ok: false, reason: "not_apply" });

  const theirs = await addPosting("u2");
  expect(await submitPosting(db, "u1", theirs, 0, now)).toEqual({ ok: false, reason: "not_found" });
});

test("reopenPosting: 남의 공고는 not_found, 제출이 없으면 changed", async () => {
  const mine = await addPosting();
  const theirs = await addPosting("u2");
  expect(await reopenPosting(db, "u1", theirs, 1, now)).toEqual({ ok: false, reason: "not_found" });
  expect(await reopenPosting(db, "u1", mine, 0, now)).toEqual({ ok: false, reason: "changed" });
});

test("submitPreview: 문항도 이력서도 없으면 두 가지를 알린다", async () => {
  const postingId = await addPosting();
  const posting = (await getPosting(db, "u1", postingId)) as Posting;
  const preview = await submitPreview(db, "u1", posting);
  expect(preview).toEqual({ resumeFrom: null, questionCount: 0, warnings: ["자소서 문항이 없습니다", "이력서가 없습니다"] });
});

test("submitPreview: 답이 없는 문항과 한도를 넘은 문항, 공통본만 있는 경우", async () => {
  const exp = await addExperience();
  const postingId = await addPosting();
  await insertCommonResume(db, "u1", trackId, resumeOf([entryOf(exp, "Java로 결제 승인 API를 다시 설계했다")], null));
  await addQuestionWithDraft(postingId, "지원 동기", ["열 글자를 훨씬 넘는 답입니다"], 10, [exp]);
  await addQuestionWithDraft(postingId, "성장 과정", null);
  const posting = (await getPosting(db, "u1", postingId)) as Posting;
  const preview = await submitPreview(db, "u1", posting);
  expect(preview.resumeFrom).toBe("common");
  expect(preview.questionCount).toBe(2);
  expect(preview.warnings).toEqual(["답이 없는 문항: 2번", "글자 수를 넘은 문항: 1번", "맞춤본이 없어 트랙 공통본으로 냅니다"]);
});

test("자기소개서를 고르지 않으면 문항 경고가 없고 제출본의 answers가 빈 배열", async () => {
  const exp = await addExperience();
  const postingId = await addPosting();
  await insertCommonResume(db, "u1", trackId, resumeOf([entryOf(exp, "Java로 결제 승인 API를 다시 설계했다")], null));
  await addQuestionWithDraft(postingId, "지원 동기", ["답이 있다"], null, [exp]);
  await setChosenDocuments(db, "u1", postingId, ["resume"]);
  const posting = (await getPosting(db, "u1", postingId)) as Posting;
  const preview = await submitPreview(db, "u1", posting);
  expect(preview.warnings.filter((w) => w.includes("문항"))).toEqual([]);
  expect(await submitPosting(db, "u1", postingId, 0, now)).toEqual({ ok: true, number: 1 });
  const saved = await getSubmission(db, "u1", postingId, 1);
  expect(saved?.content.answers).toEqual([]);
  expect(saved?.content.resume?.from).toBe("common");
});

test("이력서를 고르지 않으면 이력서 경고가 없고 resume이 null", async () => {
  const exp = await addExperience();
  const postingId = await addPosting();
  await insertCommonResume(db, "u1", trackId, resumeOf([entryOf(exp, "Java로 결제 승인 API를 다시 설계했다")], null));
  await addQuestionWithDraft(postingId, "지원 동기", ["답이 있다"], null, [exp]);
  await setChosenDocuments(db, "u1", postingId, ["cover_letter"]);
  const posting = (await getPosting(db, "u1", postingId)) as Posting;
  const preview = await submitPreview(db, "u1", posting);
  expect(preview.resumeFrom).toBeNull();
  expect(preview.warnings.filter((w) => w.includes("이력서"))).toEqual([]);
  expect(await submitPosting(db, "u1", postingId, 0, now)).toEqual({ ok: true, number: 1 });
  const saved = await getSubmission(db, "u1", postingId, 1);
  expect(saved?.content.resume).toBeNull();
  expect(saved?.content.answers.map((a) => a.prompt)).toEqual(["지원 동기"]);
});

test("고른 서류가 기본값이면 지금과 같다", async () => {
  const postingId = await addPosting();
  const posting = (await getPosting(db, "u1", postingId)) as Posting;
  expect(await submitPreview(db, "u1", posting)).toEqual({ resumeFrom: null, questionCount: 0, warnings: ["자소서 문항이 없습니다", "이력서가 없습니다"] });
  // 찾은 서류에 자소서·이력서가 없어도 고르지 않았을 뿐 기본값이 아니면 같은 규칙을 따른다
  await setChosenDocuments(db, "u1", postingId, ["resume", "cover_letter"]);
  const chosen = (await getPosting(db, "u1", postingId)) as Posting;
  expect((await submitPreview(db, "u1", chosen)).warnings).toEqual(["자소서 문항이 없습니다", "이력서가 없습니다"]);
});

test("맞춤본의 항목이 모두 빠져 0개면 공통본으로 내고, 공통본도 비었으면 이력서 없이 낸다", async () => {
  const exp = await addExperience();
  const postingId = await addPosting();
  await insertCommonResume(db, "u1", trackId, resumeOf([entryOf(exp, "공통본 줄")], null));
  await saveTailoredContent(db, "u1", postingId, trackId, resumeOf([], 1), null);
  const posting = (await getPosting(db, "u1", postingId)) as Posting;
  const preview = await submitPreview(db, "u1", posting);
  expect(preview.resumeFrom).toBe("common");
  expect(preview.warnings).toContain("맞춤본이 없어 트랙 공통본으로 냅니다");
  expect(await submitPosting(db, "u1", postingId, 0, now)).toEqual({ ok: true, number: 1 });
  expect((await getSubmission(db, "u1", postingId, 1))?.content.resume?.from).toBe("common");

  // 공통본도 항목이 0개면 없는 것으로 친다
  const other = await addPosting();
  await saveTailoredContent(db, "u1", other, trackId, resumeOf([], 1), null);
  const [common] = await db.select().from(resumes).where(and(eq(resumes.trackId, trackId), isNull(resumes.postingId)));
  await db.update(resumes).set({ content: resumeOf([], null) }).where(eq(resumes.id, common.id));
  const preview2 = await submitPreview(db, "u1", (await getPosting(db, "u1", other)) as Posting);
  expect(preview2.resumeFrom).toBeNull();
  expect(preview2.warnings).toContain("이력서가 없습니다");
});

test("submitPreview: 스위치를 켠 뒤 옛 기록을 가리키는 답·이력서 항목은 표시가 남은 것으로 센다", async () => {
  const exp = await addExperience();
  const postingId = await addPosting();
  await insertCommonResume(db, "u1", trackId, resumeOf([entryOf(exp, "Java로 결제 승인 API를 다시 설계했다")], null));
  await addQuestionWithDraft(postingId, "지원 동기", ["결제 승인 API를 다시 설계했습니다"], null, [exp]);
  recordSwitch.on = true;
  const posting = (await getPosting(db, "u1", postingId)) as Posting;
  const preview = await submitPreview(db, "u1", posting);
  expect(preview.warnings).toContain("표시가 남은 문항: 1번");
  expect(preview.warnings).toContain("이력서에 표시가 남은 항목: 1개");
});

test("스위치를 켠 뒤 옛 기록을 근거로 한 답을 제출하면 근거 이름은 옛 기록 이름으로 얼린다", async () => {
  const exp = await addExperience({ name: "옛 결제 경험" });
  const postingId = await addPosting();
  await addQuestionWithDraft(postingId, "지원 동기", ["결제 승인 API를 다시 설계했습니다"], null, [exp]);
  recordSwitch.on = true;
  expect(await submitPosting(db, "u1", postingId, 0, now)).toEqual({ ok: true, number: 1 });
  const submitted = await getSubmission(db, "u1", postingId, 1);
  expect(submitted?.content.answers[0].paragraphs[0].sources).toEqual([{ experienceId: exp, name: "옛 결제 경험" }]);
});

