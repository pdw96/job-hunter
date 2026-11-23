import { beforeEach, expect, test } from "vitest";
import { createTestDb } from "@/db/test-db";
import type { Db } from "@/db/types";
import { user } from "@/modules/auth/schema";
import { validatePosting } from "@/modules/postings/input";
import { createPosting, deletePosting } from "@/modules/postings/repo";
import { createTrack } from "@/modules/tracks/repo";
import type { SurveyInput } from "@/modules/tracks/survey";
import { type Answer, createAnswer, listAnswersByIds, listReusable } from "./answers-repo";

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

type NewAnswer = Omit<Answer, "id" | "createdAt">;
const motive = (answer: string, over: Partial<NewAnswer> = {}): NewAnswer => ({
  topic: "motive",
  question: "왜 지원했나요?",
  answer,
  postingId: null,
  company: "(주)가나다",
  companyKey: "가나다",
  ...over,
});
const growth = (answer: string, over: Partial<NewAnswer> = {}): NewAnswer => ({
  topic: "growth",
  question: "어떻게 자랐나요?",
  answer,
  postingId: null,
  company: "라마바",
  companyKey: null,
  ...over,
});
const at = (day: number) => new Date(`2026-11-${String(day).padStart(2, "0")}T03:00:00Z`);

beforeEach(async () => {
  db = await createTestDb();
  await db.insert(user).values([
    { id: "u1", name: "A", email: "u1@example.com" },
    { id: "u2", name: "B", email: "u2@example.com" },
  ]);
  const track = await createTrack(db, "u1", survey);
  if (!track.ok) throw new Error(track.reason);
  trackId = track.id;
});

test("listAnswersByIds는 ids 순서이고 없는 id는 빠진다", async () => {
  const a = await createAnswer(db, "u1", motive("첫 답"), at(1));
  const b = await createAnswer(db, "u1", growth("둘째 답"), at(2));
  const list = await listAnswersByIds(db, "u1", [b, "없는 id", a]);
  expect(list.map((x) => x.id)).toEqual([b, a]);
  expect(list[1]).toEqual({ ...motive("첫 답"), id: a, createdAt: at(1) });
  expect(await listAnswersByIds(db, "u1", [])).toEqual([]);
});

test("listReusable은 주제마다 최근 2개, 같은 글은 한 번", async () => {
  await createAnswer(db, "u1", motive("가장 옛 답"), at(1));
  await createAnswer(db, "u1", motive("둘째 답"), at(2));
  await createAnswer(db, "u1", motive("최근 답"), at(3));
  await createAnswer(db, "u1", motive("최근 답"), at(4));
  await createAnswer(db, "u1", growth("성장 답"), at(5));
  const map = await listReusable(db, "u1", ["motive", "growth"], "가나다", []);
  expect(map.get("motive")?.map((a) => a.answer)).toEqual(["최근 답", "둘째 답"]);
  expect(map.get("growth")?.map((a) => a.answer)).toEqual(["성장 답"]);
  // 묻지 않은 주제는 담지 않는다
  expect((await listReusable(db, "u1", ["growth"], "가나다", [])).has("motive")).toBe(false);
});

test("회사에 묶인 답은 같은 companyKey에서만", async () => {
  await createAnswer(db, "u1", motive("가나다 지원동기"), at(1));
  expect((await listReusable(db, "u1", ["motive"], "가나다", [])).get("motive")?.map((a) => a.answer)).toEqual(["가나다 지원동기"]);
  expect((await listReusable(db, "u1", ["motive"], "가나다랩", [])).get("motive") ?? []).toEqual([]);
});

test("회사에 묶이지 않은 답은 어느 공고에서나", async () => {
  await createAnswer(db, "u1", growth("성장 답"), at(1));
  expect((await listReusable(db, "u1", ["growth"], "아무회사", [])).get("growth")?.map((a) => a.answer)).toEqual(["성장 답"]);
});

test("exceptIds는 빠진다", async () => {
  const a = await createAnswer(db, "u1", growth("붙인 답"), at(2));
  await createAnswer(db, "u1", growth("다른 답"), at(1));
  expect((await listReusable(db, "u1", ["growth"], "", [a])).get("growth")?.map((x) => x.answer)).toEqual(["다른 답"]);
});

test("공고를 지워도 답은 남고 postingId가 null", async () => {
  const checked = validatePosting({
    company: "(주)가나다",
    title: "백엔드 개발자",
    deadline: "2026-11-30",
    isRolling: false,
    locationText: "서울",
    regions: ["seoul"],
    careerType: "experienced",
    minYears: 3,
    employmentType: "regular",
    url: null,
    rawText: "가나다 백엔드 개발자 채용",
    companyNote: "",
  });
  if (!checked.ok) throw new Error("공고 입력 오류");
  const posting = await createPosting(db, "u1", trackId, checked.value);
  if (!posting.ok) throw new Error(posting.reason);
  const id = await createAnswer(db, "u1", motive("답", { postingId: posting.id }));
  await deletePosting(db, "u1", posting.id);
  const [answer] = await listAnswersByIds(db, "u1", [id]);
  expect(answer).toMatchObject({ id, postingId: null, company: "(주)가나다", answer: "답" });
});

test("다른 사용자의 답은 읽히지 않는다", async () => {
  const id = await createAnswer(db, "u1", growth("내 답"));
  expect(await listAnswersByIds(db, "u2", [id])).toEqual([]);
  expect((await listReusable(db, "u2", ["growth"], "", [])).get("growth") ?? []).toEqual([]);
});
