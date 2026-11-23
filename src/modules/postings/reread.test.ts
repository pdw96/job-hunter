import { beforeEach, expect, test } from "vitest";
import { createTestDb } from "@/db/test-db";
import type { Db } from "@/db/types";
import { createFakeAi } from "@/modules/ai/fake-client";
import { user } from "@/modules/auth/schema";
import { createTrack } from "@/modules/tracks/repo";
import type { SurveyInput } from "@/modules/tracks/survey";
import { validatePosting } from "./input";
import { createPosting, getPosting, updatePosting } from "./repo";
import { rereadPosting } from "./reread";

let db: Db;
let trackId: string;
const today = "2026-11-17";
const now = new Date("2026-11-17T03:00:00Z");

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

const rawText = "가나다 주식회사 백엔드 개발자 채용\n제출 서류: 이력서, 포트폴리오\n1. 지원 동기를 쓰시오 (500자)";
const input = (over: Record<string, unknown> = {}) => {
  const checked = validatePosting({
    company: "가나다 주식회사",
    title: "백엔드 개발자",
    deadline: "2026-11-30",
    isRolling: false,
    locationText: "서울 강남구",
    regions: ["seoul"],
    careerType: "experienced",
    minYears: 3,
    employmentType: "regular",
    url: "",
    rawText,
    companyNote: "",
    ...over,
  });
  if (!checked.ok) throw new Error(JSON.stringify(checked.errors));
  return checked.value;
};
// AI는 다른 회사·마감을 말해도 된다. 다시 읽기는 서류와 문항만 쓴다
const answer = (over: Record<string, unknown> = {}) => ({
  company: "다른 회사",
  title: "다른 직무",
  deadline: "2027-01-01",
  isRolling: false,
  locationText: "부산",
  regions: ["busan"],
  careerType: "new",
  minYears: -1,
  employmentType: "contract",
  hasDetails: true,
  documents: [
    { kind: "resume", label: "이력서" },
    { kind: "portfolio", label: "포트폴리오" },
  ],
  questions: [{ prompt: "지원 동기를 쓰시오", charLimit: 500, countSpaces: true }],
  ...over,
});

async function addPosting(userId = "u1") {
  const result = await createPosting(db, userId, trackId, input());
  if (!result.ok) throw new Error(result.reason);
  return result.id;
}

beforeEach(async () => {
  delete process.env.AI_MONTHLY_LIMIT_USD;
  db = await createTestDb();
  await db.insert(user).values([
    { id: "u1", name: "A", email: "u1@example.com" },
    { id: "u2", name: "B", email: "u2@example.com" },
  ]);
  const track = await createTrack(db, "u1", survey);
  if (!track.ok) throw new Error(track.reason);
  trackId = track.id;
});

test("서류와 문항만 저장하고 회사·마감은 그대로", async () => {
  const id = await addPosting();
  const before = await getPosting(db, "u1", id);
  const result = await rereadPosting(db, createFakeAi([answer()]), "u1", id, today, now);
  expect(result).toEqual({
    ok: true,
    found: {
      documents: [
        { kind: "resume", label: "이력서" },
        { kind: "portfolio", label: "포트폴리오" },
      ],
      questions: [{ prompt: "지원 동기를 쓰시오", charLimit: 500, countSpaces: true }],
    },
  });
  const after = await getPosting(db, "u1", id);
  expect(after?.foundDocuments).toHaveLength(2);
  expect(after?.foundQuestions).toHaveLength(1);
  expect(after).toMatchObject({
    company: "가나다 주식회사",
    title: "백엔드 개발자",
    deadline: "2026-11-30",
    regions: ["seoul"],
    careerType: "experienced",
    employmentType: "regular",
    status: before?.status,
  });
});

test("AI가 답하는 사이 원문을 고쳤으면 changed", async () => {
  const id = await addPosting();
  // AI가 답하는 사이에 다른 탭에서 원문을 고친 것으로 흉내 낸다
  const ai = createFakeAi([
    async () => {
      await updatePosting(db, "u1", id, input({ rawText: `${rawText}\n추가 안내` }));
      return answer();
    },
  ]);
  expect(await rereadPosting(db, ai, "u1", id, today, now)).toEqual({ ok: false, reason: "changed" });
  expect((await getPosting(db, "u1", id))?.foundDocuments).toBeNull();
});

test("남의 공고는 not_found이고 AI를 부르지 않는다", async () => {
  const id = await addPosting();
  const ai = createFakeAi([answer()]);
  expect(await rereadPosting(db, ai, "u2", id, today, now)).toEqual({ ok: false, reason: "not_found" });
  expect(ai.requests).toHaveLength(0);
});

test("AI가 실패하면 이유를 돌려주고 저장하지 않는다", async () => {
  const id = await addPosting();
  expect(await rereadPosting(db, createFakeAi([{ fail: "refused" }]), "u1", id, today, now)).toEqual({ ok: false, reason: "refused" });
  expect((await getPosting(db, "u1", id))?.foundDocuments).toBeNull();
});
