import { eq } from "drizzle-orm";
import { beforeEach, expect, test } from "vitest";
import { createTestDb } from "@/db/test-db";
import type { Db } from "@/db/types";
import { user } from "@/modules/auth/schema";
import { createPosting, deletePosting } from "@/modules/postings/repo";
import { validatePosting } from "@/modules/postings/input";
import { createTrack } from "@/modules/tracks/repo";
import { tracks } from "@/modules/tracks/schema";
import type { SurveyInput } from "@/modules/tracks/survey";
import {
  getCommonResume,
  getResume,
  getTailoredResume,
  insertCommonResume,
  saveResumeContent,
  saveTailoredContent,
  saveTailoredSelection,
} from "./resume-repo";
import type { ResumeContent, ResumeSelection } from "./types";

let db: Db;
let trackId: string;
let otherTrack: string;

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
async function addPosting(userId = "u1") {
  const checked = validatePosting(raw);
  if (!checked.ok) throw new Error("공고 입력 오류");
  const created = await createPosting(db, userId, userId === "u1" ? trackId : otherTrack, checked.value);
  if (!created.ok) throw new Error(created.reason);
  return created.id;
}

const content = (text = "첫 줄", commonVersion: number | null = null): ResumeContent => ({
  entries: [
    {
      experienceId: "e1",
      contentVersion: 0,
      kind: "project",
      heading: { name: "결제 개편", organization: "가나다", role: "백엔드", period: "2023.03 ~ 2023.11" },
      detail: "full",
      emphasized: false,
      lines: [{ text, edited: false }],
      writtenAt: "2026-11-18T00:00:00.000Z",
    },
  ],
  commonVersion,
});
const selection = (over: Partial<ResumeSelection> = {}): ResumeSelection => ({
  picks: [{ experienceId: "e1", contentVersion: 0, why: "결제 경험이 맞는다" }],
  noMatch: false,
  selectedAt: "2026-11-18T00:00:00.000Z",
  ...over,
});
async function common(userId = "u1") {
  const result = await insertCommonResume(db, userId, userId === "u1" ? trackId : otherTrack, content());
  if (!result.ok) throw new Error(result.reason);
  return result.id;
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

test("공통본은 트랙마다 하나이고 두 번째는 exists", async () => {
  const id = await common();
  expect(await insertCommonResume(db, "u1", trackId, content("둘째"))).toEqual({ ok: false, reason: "exists" });
  const resume = await getCommonResume(db, "u1", trackId);
  expect(resume).toMatchObject({ id, trackId, postingId: null, version: 0, selection: null });
  expect(resume?.content).toEqual(content());
});

test("공통본이 동시에 만들어져도 하나만 남고 나머지는 exists", async () => {
  const results = await Promise.all([
    insertCommonResume(db, "u1", trackId, content("가")),
    insertCommonResume(db, "u1", trackId, content("나")),
  ]);
  expect(results.filter((r) => r.ok)).toHaveLength(1);
  expect(results.filter((r) => !r.ok)).toEqual([{ ok: false, reason: "exists" }]);
});

test("남의 트랙에는 공통본을 만들 수 없다", async () => {
  expect(await insertCommonResume(db, "u1", otherTrack, content())).toEqual({ ok: false, reason: "not_found" });
  expect(await getCommonResume(db, "u2", otherTrack)).toBeNull();
});

test("saveResumeContent는 version이 같을 때만 저장하고 version을 올린다", async () => {
  const id = await common();
  expect(await saveResumeContent(db, "u1", id, content("고침"), 0)).toEqual({ ok: true, version: 1 });
  expect(await saveResumeContent(db, "u1", id, content("또 고침"), 1)).toEqual({ ok: true, version: 2 });
  const resume = await getResume(db, "u1", id);
  expect(resume?.version).toBe(2);
  expect(resume?.content?.entries[0].lines[0].text).toBe("또 고침");
});

test("saveResumeContent는 version이 다르면 changed이고 없으면 not_found", async () => {
  const id = await common();
  await saveResumeContent(db, "u1", id, content("고침"), 0);
  expect(await saveResumeContent(db, "u1", id, content("늦은 저장"), 0)).toEqual({ ok: false, reason: "changed" });
  expect((await getResume(db, "u1", id))?.content?.entries[0].lines[0].text).toBe("고침");
  expect(await saveResumeContent(db, "u1", "없는-id", content(), 0)).toEqual({ ok: false, reason: "not_found" });
});

test("saveTailoredSelection은 없으면 만들고 있으면 selection만 바꾼다", async () => {
  const postingId = await addPosting();
  const first = await saveTailoredSelection(db, "u1", postingId, trackId, selection());
  expect(first.ok).toBe(true);
  const created = await getTailoredResume(db, "u1", postingId);
  expect(created).toMatchObject({ trackId, postingId, version: 1, content: null });
  expect(created?.selection).toEqual(selection());

  const filled = await saveTailoredContent(db, "u1", postingId, trackId, content("맞춤", 0), 1);
  expect(filled).toEqual({ ok: true, version: 2 });

  const second = await saveTailoredSelection(db, "u1", postingId, trackId, selection({ noMatch: true, picks: [] }));
  expect(second).toEqual({ ok: true, id: created?.id });
  const after = await getTailoredResume(db, "u1", postingId);
  expect(after?.version).toBe(3);
  expect(after?.selection).toEqual(selection({ noMatch: true, picks: [] }));
  expect(after?.content?.entries[0].lines[0].text).toBe("맞춤"); // 내용은 그대로
});

test("saveTailoredContent(null)는 행이 없으면 만들고 내용이 비어 있으면 채운다", async () => {
  const postingId = await addPosting();
  const created = await saveTailoredContent(db, "u1", postingId, trackId, content("복사", 0), null);
  expect(created).toEqual({ ok: true, version: 1 });
  expect((await getTailoredResume(db, "u1", postingId))?.selection).toBeNull();

  const other = await addPosting();
  await saveTailoredSelection(db, "u1", other, trackId, selection());
  const filled = await saveTailoredContent(db, "u1", other, trackId, content("채움", 0), null);
  expect(filled).toEqual({ ok: true, version: 2 });
  expect((await getTailoredResume(db, "u1", other))?.selection).toEqual(selection()); // 선택은 남는다
});

test("saveTailoredContent(null)는 내용이 이미 있으면 changed", async () => {
  const postingId = await addPosting();
  await saveTailoredContent(db, "u1", postingId, trackId, content("첫 내용", 0), null);
  expect(await saveTailoredContent(db, "u1", postingId, trackId, content("덮어쓰기", 0), null)).toEqual({
    ok: false,
    reason: "changed",
  });
  expect((await getTailoredResume(db, "u1", postingId))?.content?.entries[0].lines[0].text).toBe("첫 내용");
});

test("saveTailoredContent(숫자)는 version이 같을 때만 덮어쓴다", async () => {
  const postingId = await addPosting();
  await saveTailoredContent(db, "u1", postingId, trackId, content("첫 내용", 0), null); // version 1
  expect(await saveTailoredContent(db, "u1", postingId, trackId, content("다시", 0), 0)).toEqual({ ok: false, reason: "changed" });
  expect(await saveTailoredContent(db, "u1", postingId, trackId, content("다시", 0), 1)).toEqual({ ok: true, version: 2 });
  const none = await addPosting();
  expect(await saveTailoredContent(db, "u1", none, trackId, content(), 3)).toEqual({ ok: false, reason: "not_found" });
});

test("다른 사용자의 이력서는 get*로 읽히지 않고 save*로 고쳐지지 않는다", async () => {
  const id = await common("u2");
  const theirPosting = await addPosting("u2");
  await saveTailoredContent(db, "u2", theirPosting, otherTrack, content("남의 맞춤", 0), null);

  expect(await getResume(db, "u1", id)).toBeNull();
  expect(await getCommonResume(db, "u1", otherTrack)).toBeNull();
  expect(await getTailoredResume(db, "u1", theirPosting)).toBeNull();
  expect(await saveResumeContent(db, "u1", id, content("침범"), 0)).toEqual({ ok: false, reason: "not_found" });
  expect((await getResume(db, "u2", id))?.version).toBe(0);

  // 남의 공고에 내 맞춤본을 만들거나 고칠 수 없다(남의 행은 건드려지지 않는다)
  const forged = await saveTailoredContent(db, "u1", theirPosting, trackId, content("침범", 0), 1);
  expect(forged.ok).toBe(false);
  const theirs = await getTailoredResume(db, "u2", theirPosting);
  expect(theirs?.content?.entries[0].lines[0].text).toBe("남의 맞춤");
});

test("공고를 지우면 맞춤본이, 트랙을 지우면 공통본이 지워진다", async () => {
  const commonId = await common();
  const postingId = await addPosting();
  await saveTailoredContent(db, "u1", postingId, trackId, content("맞춤", 0), null);
  const tailored = await getTailoredResume(db, "u1", postingId);

  await deletePosting(db, "u1", postingId);
  expect(await getResume(db, "u1", tailored!.id)).toBeNull();
  expect(await getResume(db, "u1", commonId)).not.toBeNull();

  await db.delete(tracks).where(eq(tracks.id, trackId));
  expect(await getResume(db, "u1", commonId)).toBeNull();
});
