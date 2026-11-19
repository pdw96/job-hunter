import { beforeEach, expect, test } from "vitest";
import { createTestDb } from "@/db/test-db";
import type { Db } from "@/db/types";
import { user } from "@/modules/auth/schema";
import { createPosting, deletePosting } from "@/modules/postings/repo";
import { validatePosting } from "@/modules/postings/input";
import { createTrack } from "@/modules/tracks/repo";
import type { SurveyInput } from "@/modules/tracks/survey";
import { getSubmission, insertSubmission, isLocked, latestSubmission, listSubmissions, reopenSubmission, withPostingLock } from "./submission-repo";
import type { SubmissionContent } from "./types";

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

const submitted = (company = "가나다 주식회사"): SubmissionContent => ({
  posting: { company, title: "백엔드 개발자", url: null, deadline: "2026-11-30", isRolling: false, rawText: "채용 공고 본문", companyNote: null },
  resume: null,
  answers: [
    {
      prompt: "지원 동기",
      charLimit: 500,
      countSpaces: true,
      paragraphs: [{ text: "결제 개편 경험", sources: [{ experienceId: "e1", name: "결제 개편" }], edited: false }],
    },
    { prompt: "성장 과정", charLimit: null, countSpaces: false, paragraphs: [] },
  ],
});
const now = new Date("2026-11-19T00:00:00.000Z");
const later = new Date("2026-11-20T00:00:00.000Z");

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

test("처음 넣으면 1번이고, 같은 번호로 다시 넣으면 changed이며 잠긴다", async () => {
  const postingId = await addPosting();
  expect(await insertSubmission(db, "u1", postingId, 0, submitted(), now)).toEqual({ ok: true, number: 1 });
  expect(await insertSubmission(db, "u1", postingId, 0, submitted(), now)).toEqual({ ok: false, reason: "changed" });
  const latest = await latestSubmission(db, "u1", postingId);
  expect(latest?.number).toBe(1);
  expect(isLocked(latest)).toBe(true);
  expect(isLocked(null)).toBe(false);
});

test("잠긴 채로는 못 넣고, 다시 열면 다음 번호로 넣는다", async () => {
  const postingId = await addPosting();
  await insertSubmission(db, "u1", postingId, 0, submitted(), now);
  expect(await insertSubmission(db, "u1", postingId, 1, submitted(), now)).toEqual({ ok: false, reason: "changed" });
  expect(await reopenSubmission(db, "u1", postingId, 1, later)).toEqual({ ok: true });
  expect(isLocked(await latestSubmission(db, "u1", postingId))).toBe(false);
  expect(await reopenSubmission(db, "u1", postingId, 1, later)).toEqual({ ok: false, reason: "changed" });
  expect(await insertSubmission(db, "u1", postingId, 1, submitted("다른 회사"), later)).toEqual({ ok: true, number: 2 });
  const list = await listSubmissions(db, "u1", postingId);
  expect(list.map((s) => s.number)).toEqual([1, 2]);
  expect(list[0].reopenedAt).toEqual(later);
  expect(list[1].reopenedAt).toBeNull();
  expect("content" in list[0]).toBe(false);
});

test("넣은 내용을 그대로 읽는다", async () => {
  const postingId = await addPosting();
  const c = submitted();
  await insertSubmission(db, "u1", postingId, 0, c, now);
  const got = await getSubmission(db, "u1", postingId, 1);
  expect(got?.content).toEqual(c);
  expect(got?.submittedAt).toEqual(now);
  expect(await getSubmission(db, "u1", postingId, 2)).toBeNull();
});

test("다른 사용자는 보지도 바꾸지도 못한다", async () => {
  const postingId = await addPosting();
  await insertSubmission(db, "u1", postingId, 0, submitted(), now);
  expect(await listSubmissions(db, "u2", postingId)).toEqual([]);
  expect(await getSubmission(db, "u2", postingId, 1)).toBeNull();
  expect(await latestSubmission(db, "u2", postingId)).toBeNull();
  expect(await reopenSubmission(db, "u2", postingId, 1, later)).toEqual({ ok: false, reason: "changed" });
  expect(await insertSubmission(db, "u2", postingId, 0, submitted(), now)).toEqual({ ok: false, reason: "not_found" });
  expect(isLocked(await latestSubmission(db, "u1", postingId))).toBe(true);
});

test("공고를 지우면 제출본도 없어지고 더는 넣지 못한다", async () => {
  const postingId = await addPosting();
  await insertSubmission(db, "u1", postingId, 0, submitted(), now);
  expect(await deletePosting(db, "u1", postingId)).toEqual({ ok: true });
  expect(await listSubmissions(db, "u1", postingId)).toEqual([]);
  expect(await insertSubmission(db, "u1", postingId, 0, submitted(), now)).toEqual({ ok: false, reason: "not_found" });
});

test("withPostingLock은 같은 공고의 두 작업을 겹치지 않게 한 줄로 세운다", async () => {
  const postingId = await addPosting();
  const log: string[] = [];
  const run = (name: string) =>
    withPostingLock(db, postingId, async () => {
      log.push(`${name}-start`);
      await new Promise((resolve) => setTimeout(resolve, 20));
      log.push(`${name}-end`);
      return name;
    });
  const results = await Promise.all([run("a"), run("b")]);
  expect(results).toEqual(["a", "b"]);
  expect([
    ["a-start", "a-end", "b-start", "b-end"],
    ["b-start", "b-end", "a-start", "a-end"],
  ]).toContainEqual(log);
});
