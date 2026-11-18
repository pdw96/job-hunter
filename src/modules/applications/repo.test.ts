import { beforeEach, expect, test } from "vitest";
import { createTestDb } from "@/db/test-db";
import type { Db } from "@/db/types";
import { user } from "@/modules/auth/schema";
import { applyToPosting, createPosting, deletePosting, getPosting, saveAnalysis, setStatus } from "@/modules/postings/repo";
import { validatePosting } from "@/modules/postings/input";
import type { AppliedScore, PostingAnalysis } from "@/modules/postings/analysis";
import { createTrack } from "@/modules/tracks/repo";
import type { SurveyInput } from "@/modules/tracks/survey";
import { APPLICATION_LIMITS } from "./options";
import {
  addQuestions,
  approveSelection,
  deleteQuestion,
  getQuestion,
  listQuestions,
  replaceDraft,
  saveDraft,
  saveSelection,
  updateQuestion,
  type QuestionInput,
} from "./repo";
import type { Draft, Selection } from "./types";

let db: Db;
let trackId: string;

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
  rawText: "가나다 주식회사 백엔드 개발자 채용",
  companyNote: "",
};
const analysis: PostingAnalysis = {
  target: "개발",
  requirements: [],
  field: { level: "same_job", reason: "분야가 같다" },
  analyzedAt: "2026-11-18T00:00:00.000Z",
};
const score: AppliedScore = {
  desire: 50,
  fit: 50,
  criteria: {} as AppliedScore["criteria"],
  analyzedAt: "2026-11-18T00:00:00.000Z",
  appliedAt: "2026-11-18T00:00:00.000Z",
};

async function addPosting(userId = "u1", apply = true) {
  const checked = validatePosting(raw);
  if (!checked.ok) throw new Error("공고 입력 오류");
  const created = await createPosting(db, userId, userId === "u1" ? trackId : otherTrack, checked.value);
  if (!created.ok) throw new Error(created.reason);
  if (apply) {
    // 지원으로 바꾼다(점수 계산 없이 상태만 흉내 낸다)
    const saved = await saveAnalysis(db, userId, created.id, analysis, { rawText: raw.rawText, companyNote: null });
    if (!saved.ok) throw new Error(saved.reason);
    const posting = await getPosting(db, userId, created.id);
    if (!posting) throw new Error("없음");
    const result = await applyToPosting(db, userId, created.id, score, { ...posting, analysis });
    if (!result.ok) throw new Error(result.reason);
  }
  return created.id;
}
let otherTrack: string;

const q = (prompt: string, over: Partial<QuestionInput> = {}): QuestionInput => ({
  prompt,
  charLimit: 500,
  countSpaces: true,
  ...over,
});
const ref = (id: string, contentVersion = 0) => ({ experienceId: id, contentVersion });
const selection = (questionVersion: number, over: Partial<Selection> = {}): Selection => ({
  questionVersion,
  picks: [{ ...ref("e1"), overlap: "결제", role: "백엔드" }],
  passed: [],
  noMatch: false,
  selectedAt: "2026-11-18T00:00:00.000Z",
  approved: null,
  approvedAt: null,
  ...over,
});
const draft = (questionVersion: number, over: Partial<Draft> = {}): Draft => ({
  questionVersion,
  basedOn: [ref("e1")],
  paragraphs: [{ text: "첫 문단", sources: ["e1"], edited: false }],
  shortage: "",
  writtenAt: "2026-11-18T00:00:00.000Z",
  ...over,
});
async function oneQuestion(userId = "u1") {
  const postingId = await addPosting(userId);
  const result = await addQuestions(db, userId, postingId, [q("지원 동기를 쓰세요")]);
  if (!result.ok) throw new Error(result.reason);
  return { postingId, id: result.ids[0] };
}

beforeEach(async () => {
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

test("지원 공고에만 문항을 더한다", async () => {
  const interest = await addPosting("u1", false);
  expect(await addQuestions(db, "u1", interest, [q("가")])).toEqual({ ok: false, reason: "not_apply" });
  const postingId = await addPosting();
  const result = await addQuestions(db, "u1", postingId, [q("첫째"), q("둘째", { charLimit: null, countSpaces: false })]);
  expect(result.ok).toBe(true);
  const list = await listQuestions(db, "u1", postingId);
  expect(list.map((x) => [x.prompt, x.position, x.version, x.selection, x.draft])).toEqual([
    ["첫째", 0, 0, null, null],
    ["둘째", 1, 0, null, null],
  ]);
  expect(list[1]).toMatchObject({ charLimit: null, countSpaces: false, postingId });
  // 이어서 붙는다
  await addQuestions(db, "u1", postingId, [q("셋째")]);
  expect((await listQuestions(db, "u1", postingId)).map((x) => x.position)).toEqual([0, 1, 2]);
});

test("남의 공고는 not_found", async () => {
  const theirs = await addPosting("u2");
  expect(await addQuestions(db, "u1", theirs, [q("가")])).toEqual({ ok: false, reason: "not_found" });
  expect(await addQuestions(db, "u1", "없는-공고", [q("가")])).toEqual({ ok: false, reason: "not_found" });
});

test("11개째는 too_many이고 하나도 들어가지 않는다", async () => {
  const postingId = await addPosting();
  const many = (n: number) => Array.from({ length: n }, (_, i) => q(`문항 ${i}`));
  expect(await addQuestions(db, "u1", postingId, many(APPLICATION_LIMITS.questions - 1))).toMatchObject({ ok: true });
  expect(await addQuestions(db, "u1", postingId, many(2))).toEqual({ ok: false, reason: "too_many" });
  expect(await listQuestions(db, "u1", postingId)).toHaveLength(APPLICATION_LIMITS.questions - 1);
  expect(await addQuestions(db, "u1", postingId, many(1))).toMatchObject({ ok: true });
  expect(await addQuestions(db, "u1", postingId, many(1))).toEqual({ ok: false, reason: "too_many" });
});

test("문항 글을 고치면 version이 오르고 selection이 지워지며 draft는 남는다", async () => {
  const { id } = await oneQuestion();
  // 승인 뒤 쓴 답을 만든다
  const first = selection(0);
  await saveSelection(db, "u1", id, first);
  await approveSelection(db, "u1", id, [ref("e1")], first);
  expect(await saveDraft(db, "u1", id, draft(0), { version: 0, approved: [ref("e1")] })).toEqual({ ok: true });

  expect(await updateQuestion(db, "u1", id, q("새 문항 글"))).toEqual({ ok: true });
  const after = await getQuestion(db, "u1", id);
  expect(after).toMatchObject({ prompt: "새 문항 글", version: 1, selection: null });
  expect(after?.draft?.paragraphs[0].text).toBe("첫 문단");
});

test("제한만 고치면 selection이 남는다", async () => {
  const { id } = await oneQuestion();
  await saveSelection(db, "u1", id, selection(0));
  expect(await updateQuestion(db, "u1", id, q("지원 동기를 쓰세요", { charLimit: 800, countSpaces: false }))).toEqual({ ok: true });
  const after = await getQuestion(db, "u1", id);
  expect(after).toMatchObject({ version: 0, charLimit: 800, countSpaces: false });
  expect(after?.selection).not.toBeNull();
});

test("saveSelection은 version이 다르면 changed", async () => {
  const { id } = await oneQuestion();
  await updateQuestion(db, "u1", id, q("고친 글")); // version 1
  expect(await saveSelection(db, "u1", id, selection(0))).toEqual({ ok: false, reason: "changed" });
  expect((await getQuestion(db, "u1", id))?.selection).toBeNull();
  expect(await saveSelection(db, "u1", id, selection(1))).toEqual({ ok: true });
  expect(await saveSelection(db, "u1", "없는-문항", selection(0))).toEqual({ ok: false, reason: "not_found" });
});

test("approveSelection은 selection이 읽은 것과 같을 때만 승인한다", async () => {
  const { id } = await oneQuestion();
  const first = selection(0);
  await saveSelection(db, "u1", id, first);
  const now = new Date("2026-11-18T09:00:00.000Z");
  expect(await approveSelection(db, "u1", id, [ref("e1")], first, now)).toEqual({ ok: true });
  expect((await getQuestion(db, "u1", id))?.selection).toMatchObject({
    approved: [ref("e1")],
    approvedAt: now.toISOString(),
  });
  // 다른 탭에서 다시 골랐다면 예전 것을 읽은 승인은 막힌다
  await saveSelection(db, "u1", id, selection(0, { noMatch: true, picks: [] }));
  expect(await approveSelection(db, "u1", id, [ref("e1")], first, now)).toEqual({ ok: false, reason: "changed" });
  expect(await approveSelection(db, "u1", "없는-문항", [ref("e1")], first, now)).toEqual({ ok: false, reason: "not_found" });
});

test("다시 고르면 승인이 지워지고 답은 그대로다", async () => {
  const { id } = await oneQuestion();
  const first = selection(0);
  await saveSelection(db, "u1", id, first);
  await approveSelection(db, "u1", id, [ref("e1")], first);
  await saveDraft(db, "u1", id, draft(0), { version: 0, approved: [ref("e1")] });
  expect(await saveSelection(db, "u1", id, selection(0))).toEqual({ ok: true });
  const after = await getQuestion(db, "u1", id);
  expect(after?.selection).toMatchObject({ approved: null, approvedAt: null });
  expect(after?.draft).not.toBeNull();
});

test("saveDraft는 승인이 바뀌었으면 changed", async () => {
  const { id } = await oneQuestion();
  const first = selection(0);
  await saveSelection(db, "u1", id, first);
  await approveSelection(db, "u1", id, [ref("e1")], first);
  // 읽은 뒤 다시 골라 승인이 지워졌다
  await saveSelection(db, "u1", id, selection(0));
  expect(await saveDraft(db, "u1", id, draft(0), { version: 0, approved: [ref("e1")] })).toEqual({ ok: false, reason: "changed" });
  expect((await getQuestion(db, "u1", id))?.draft).toBeNull();
  // 문항 글이 바뀐 경우도 막힌다
  const second = selection(0);
  await saveSelection(db, "u1", id, second);
  await approveSelection(db, "u1", id, [ref("e1")], second);
  await updateQuestion(db, "u1", id, q("고친 글"));
  expect(await saveDraft(db, "u1", id, draft(0), { version: 0, approved: [ref("e1")] })).toEqual({ ok: false, reason: "changed" });
  expect(await saveDraft(db, "u1", "없는-문항", draft(0), { version: 0, approved: [] })).toEqual({ ok: false, reason: "not_found" });
});

test("replaceDraft는 draft가 expected와 다르면 changed", async () => {
  const { id } = await oneQuestion();
  const first = selection(0);
  await saveSelection(db, "u1", id, first);
  await approveSelection(db, "u1", id, [ref("e1")], first);
  const d1 = draft(0);
  await saveDraft(db, "u1", id, d1, { version: 0, approved: [ref("e1")] });
  const d2 = draft(0, { paragraphs: [{ text: "고친 문단", sources: ["e1"], edited: true }] });
  expect(await replaceDraft(db, "u1", id, d1, d2)).toEqual({ ok: true });
  expect((await getQuestion(db, "u1", id))?.draft?.paragraphs[0].text).toBe("고친 문단");
  // 예전 것을 읽은 쪽은 막힌다
  expect(await replaceDraft(db, "u1", id, d1, draft(0, { shortage: "x" }))).toEqual({ ok: false, reason: "changed" });
  expect(await replaceDraft(db, "u1", "없는-문항", d1, d2)).toEqual({ ok: false, reason: "not_found" });
});

test("지원에서 보류로 바꿔도 listQuestions는 문항을 돌려준다", async () => {
  const { postingId } = await oneQuestion();
  expect(await setStatus(db, "u1", postingId, "hold")).toEqual({ ok: true });
  expect(await listQuestions(db, "u1", postingId)).toHaveLength(1);
  expect(await addQuestions(db, "u1", postingId, [q("더")])).toEqual({ ok: false, reason: "not_apply" });
});

test("지원이 아닌 공고의 문항은 고치거나 지우지 못한다", async () => {
  const { postingId, id } = await oneQuestion();
  expect(await setStatus(db, "u1", postingId, "hold")).toEqual({ ok: true });
  expect(await updateQuestion(db, "u1", id, q("바꿈"))).toEqual({ ok: false, reason: "not_apply" });
  expect(await deleteQuestion(db, "u1", id)).toEqual({ ok: false, reason: "not_apply" });
  expect(await getQuestion(db, "u1", id)).toMatchObject({ prompt: "지원 동기를 쓰세요", version: 0 });
});

test("다른 사용자의 문항은 읽히지도 고쳐지지도 않는다", async () => {
  const { postingId, id } = await oneQuestion();
  const first = selection(0);
  await saveSelection(db, "u1", id, first);
  expect(await getQuestion(db, "u2", id)).toBeNull();
  expect(await listQuestions(db, "u2", postingId)).toEqual([]);
  expect(await updateQuestion(db, "u2", id, q("바꿈"))).toEqual({ ok: false, reason: "not_found" });
  expect(await saveSelection(db, "u2", id, selection(0))).toEqual({ ok: false, reason: "not_found" });
  expect(await approveSelection(db, "u2", id, [ref("e1")], first)).toEqual({ ok: false, reason: "not_found" });
  expect(await saveDraft(db, "u2", id, draft(0), { version: 0, approved: [] })).toEqual({ ok: false, reason: "not_found" });
  expect(await replaceDraft(db, "u2", id, draft(0), draft(0))).toEqual({ ok: false, reason: "not_found" });
  expect(await deleteQuestion(db, "u2", id)).toEqual({ ok: false, reason: "not_found" });
  expect(await getQuestion(db, "u1", id)).toMatchObject({ prompt: "지원 동기를 쓰세요", version: 0 });
  expect((await getQuestion(db, "u1", id))?.selection?.approved).toBeNull();
});

test("문항을 지운다", async () => {
  const { postingId, id } = await oneQuestion();
  expect(await deleteQuestion(db, "u1", id)).toEqual({ ok: true });
  expect(await listQuestions(db, "u1", postingId)).toEqual([]);
  expect(await deleteQuestion(db, "u1", id)).toEqual({ ok: false, reason: "not_found" });
});

test("공고를 지우면 문항도 지워진다", async () => {
  const { postingId, id } = await oneQuestion();
  expect(await deletePosting(db, "u1", postingId)).toEqual({ ok: true });
  expect(await getQuestion(db, "u1", id)).toBeNull();
});
