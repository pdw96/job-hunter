import { beforeEach, expect, test } from "vitest";
import { createTestDb } from "@/db/test-db";
import type { Db } from "@/db/types";
import { user } from "@/modules/auth/schema";
import type { AppliedScore, PostingAnalysis } from "@/modules/postings/analysis";
import { validatePosting } from "@/modules/postings/input";
import { applyToPosting, createPosting, getPosting, saveAnalysis } from "@/modules/postings/repo";
import type { Found } from "@/modules/postings/documents";
import { createTrack } from "@/modules/tracks/repo";
import type { SurveyInput } from "@/modules/tracks/survey";
import { chooseDocuments, seedQuestionsFromPosting } from "./documents";
import { addQuestions, listQuestions } from "./repo";
import { submitPosting } from "./submit";

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
const rawText = "가나다 주식회사 백엔드 개발자 채용\n1. 지원 동기를 쓰시오 (500자, 공백 제외)\n2. 성장 과정을 쓰시오";
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
  companyNote: "",
};
const analysis: PostingAnalysis = {
  target: "개발",
  requirements: [],
  field: { level: "same_job", reason: "분야가 같다" },
  analyzedAt: "2026-11-18T00:00:00.000Z",
};
const score = { desire: 50, fit: 50, criteria: {}, analyzedAt: "2026-11-18T00:00:00.000Z", appliedAt: "2026-11-18T00:00:00.000Z" } as unknown as AppliedScore;
const found: Found = {
  documents: [{ kind: "cover_letter", label: "자기소개서" }],
  questions: [
    { prompt: "지원 동기를 쓰시오", charLimit: 500, countSpaces: false },
    { prompt: "성장 과정을 쓰시오", charLimit: null, countSpaces: true },
  ],
};

async function addPosting(over: { apply?: boolean; found?: Found | null } = {}) {
  const { apply = true } = over;
  const checked = validatePosting(raw);
  if (!checked.ok) throw new Error("공고 입력 오류");
  const created = await createPosting(db, "u1", trackId, checked.value, over.found === null ? undefined : (over.found ?? found));
  if (!created.ok) throw new Error(created.reason);
  if (apply) {
    const saved = await saveAnalysis(db, "u1", created.id, analysis, { rawText, companyNote: null });
    if (!saved.ok) throw new Error(saved.reason);
    const posting = await getPosting(db, "u1", created.id);
    if (!posting) throw new Error("없음");
    const result = await applyToPosting(db, "u1", created.id, score, { ...posting, analysis });
    if (!result.ok) throw new Error(result.reason);
  }
  return created.id;
}

beforeEach(async () => {
  db = await createTestDb();
  await db.insert(user).values([
    { id: "u1", name: "A", email: "u1@example.com" },
    { id: "u2", name: "B", email: "u2@example.com" },
  ]);
  const mine = await createTrack(db, "u1", survey);
  if (!mine.ok) throw new Error("트랙을 만들지 못함");
  trackId = mine.id;
});

test("지원 공고에 찾은 문항을 넣는다(글자 수·기준까지)", async () => {
  const id = await addPosting();
  expect(await seedQuestionsFromPosting(db, "u1", id)).toEqual({ ok: true, added: 2 });
  const list = await listQuestions(db, "u1", id);
  expect(list.map((x) => [x.prompt, x.charLimit, x.countSpaces, x.position])).toEqual([
    ["지원 동기를 쓰시오", 500, false, 0],
    ["성장 과정을 쓰시오", null, true, 1],
  ]);
});

test("관심 공고에는 넣지 않는다", async () => {
  const id = await addPosting({ apply: false });
  expect(await seedQuestionsFromPosting(db, "u1", id)).toEqual({ ok: true, added: 0 });
  expect(await listQuestions(db, "u1", id)).toEqual([]);
});

test("문항이 이미 있으면 넣지 않는다", async () => {
  const id = await addPosting();
  await addQuestions(db, "u1", id, [{ prompt: "직접 넣은 문항", charLimit: null, countSpaces: true }]);
  expect(await seedQuestionsFromPosting(db, "u1", id)).toEqual({ ok: true, added: 0 });
  expect((await listQuestions(db, "u1", id)).map((x) => x.prompt)).toEqual(["직접 넣은 문항"]);
});

test("찾은 문항이 없으면 added 0", async () => {
  const unread = await addPosting({ found: null });
  expect(await seedQuestionsFromPosting(db, "u1", unread)).toEqual({ ok: true, added: 0 });
  const empty = await addPosting({ found: { documents: [], questions: [] } });
  expect(await seedQuestionsFromPosting(db, "u1", empty)).toEqual({ ok: true, added: 0 });
  expect(await listQuestions(db, "u1", empty)).toEqual([]);
});

test("제출로 잠긴 공고는 submitted, 남의 공고는 not_found", async () => {
  const id = await addPosting();
  expect(await submitPosting(db, "u1", id, 0, now)).toEqual({ ok: true, number: 1 });
  expect(await seedQuestionsFromPosting(db, "u1", id)).toEqual({ ok: false, reason: "submitted" });
  expect(await listQuestions(db, "u1", id)).toEqual([]);
  expect(await seedQuestionsFromPosting(db, "u2", id)).toEqual({ ok: false, reason: "not_found" });
});

test("chooseDocuments는 지원이 아니면 not_apply, 잠겼으면 submitted", async () => {
  const interest = await addPosting({ apply: false });
  expect(await chooseDocuments(db, "u1", interest, ["resume"])).toEqual({ ok: false, reason: "not_apply" });

  const id = await addPosting();
  expect(await chooseDocuments(db, "u1", id, ["portfolio", "resume", "resume"])).toEqual({ ok: true });
  expect((await getPosting(db, "u1", id))?.chosenDocuments).toEqual(["resume", "portfolio"]);

  expect(await submitPosting(db, "u1", id, 0, now)).toEqual({ ok: true, number: 1 });
  expect(await chooseDocuments(db, "u1", id, ["resume"])).toEqual({ ok: false, reason: "submitted" });
  expect(await chooseDocuments(db, "u2", id, ["resume"])).toEqual({ ok: false, reason: "not_found" });
});
