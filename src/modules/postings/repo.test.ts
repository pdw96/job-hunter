import { beforeEach, expect, test } from "vitest";
import { createTestDb } from "@/db/test-db";
import type { Db } from "@/db/types";
import { user } from "@/modules/auth/schema";
import { createTrack, updateTrack } from "@/modules/tracks/repo";
import type { SurveyInput } from "@/modules/tracks/survey";
import { validatePosting } from "./input";
import type { PostingAnalysis, AppliedScore } from "./analysis";
import {
  applyToPosting,
  countPostings,
  createPosting,
  deletePosting,
  findSimilar,
  getPosting,
  listPostings,
  saveAnalysis,
  setExcludeOverride,
  setStatus,
  sortByDeadline,
  updatePosting,
} from "./repo";

let db: Db;
let trackId: string;
let otherTrackId: string;
const today = "2026-11-17";

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
  url: "https://example.com/jobs/1",
  rawText: "가나다 주식회사 백엔드 개발자 채용",
  companyNote: "",
};
const input = (over: Record<string, unknown> = {}) => {
  const checked = validatePosting({ ...raw, ...over });
  if (!checked.ok) throw new Error(JSON.stringify(checked.errors));
  return checked.value;
};
async function add(over: Record<string, unknown> = {}, userId = "u1", track = trackId) {
  const result = await createPosting(db, userId, track, input(over));
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
  otherTrackId = theirs.id;
});

test("공고를 저장하고 다시 읽는다. 관심 상태로 시작한다", async () => {
  const id = await add();
  expect(await getPosting(db, "u1", id)).toMatchObject({
    company: "가나다 주식회사",
    deadline: "2026-11-30",
    regions: ["seoul"],
    minYears: 3,
    companyNote: null,
    status: "interest",
    excludeOverride: false,
    trackId,
  });
});

test("남의 트랙이나 없는 트랙에는 넣을 수 없다", async () => {
  expect(await createPosting(db, "u1", otherTrackId, input())).toEqual({ ok: false, reason: "invalid_track" });
  expect(await createPosting(db, "u1", "없는-트랙", input())).toEqual({ ok: false, reason: "invalid_track" });
});

test("다른 사용자의 공고는 읽거나 고치거나 지울 수 없다", async () => {
  const id = await add();
  expect(await getPosting(db, "u2", id)).toBeNull();
  expect(await updatePosting(db, "u2", id, input({ company: "바꿈" }))).toEqual({ ok: false, reason: "not_found" });
  expect(await setStatus(db, "u2", id, "excluded")).toEqual({ ok: false, reason: "not_found" });
  expect(await setExcludeOverride(db, "u2", id, true)).toEqual({ ok: false, reason: "not_found" });
  expect(await deletePosting(db, "u2", id)).toEqual({ ok: false, reason: "not_found" });
  expect(await listPostings(db, "u2", trackId, today)).toEqual([]);
  expect((await getPosting(db, "u1", id))?.company).toBe("가나다 주식회사");
});

test("목록은 마감이 가까운 순, 마감일 없는 것, 마감이 지난 것 순이다", async () => {
  await add({ company: "지남", deadline: "2026-11-01" });
  await add({ company: "먼 마감", deadline: "2026-12-20" });
  await add({ company: "상시", isRolling: true });
  await add({ company: "가까운 마감", deadline: "2026-11-18" });
  await add({ company: "더 전에 지남", deadline: "2026-10-01" });
  expect((await listPostings(db, "u1", trackId, today)).map((posting) => posting.company)).toEqual([
    "가까운 마감",
    "먼 마감",
    "상시",
    "지남",
    "더 전에 지남",
  ]);
});

test("마감일이 같으면 나중에 넣은 것이 앞에 온다", () => {
  const list = [
    { deadline: "2026-11-20", createdAt: new Date("2026-11-01"), name: "먼저" },
    { deadline: "2026-11-20", createdAt: new Date("2026-11-02"), name: "나중" },
  ];
  expect(sortByDeadline(list, today).map((item) => item.name)).toEqual(["나중", "먼저"]);
});

test("내용을 고치면 그래도 진행 표시가 풀린다", async () => {
  const id = await add();
  await setExcludeOverride(db, "u1", id, true);
  expect((await getPosting(db, "u1", id))?.excludeOverride).toBe(true);
  await updatePosting(db, "u1", id, input({ minYears: 9 }));
  expect(await getPosting(db, "u1", id)).toMatchObject({ minYears: 9, excludeOverride: false });
});

test("보류와 제외로 바꿀 수 있다", async () => {
  const id = await add();
  expect(await setStatus(db, "u1", id, "hold")).toEqual({ ok: true });
  expect((await getPosting(db, "u1", id))?.status).toBe("hold");
  await setStatus(db, "u1", id, "interest");
  expect((await getPosting(db, "u1", id))?.status).toBe("interest");
});

test("같은 회사와 직무의 공고를 띄어쓰기와 대소문자를 무시하고 찾는다", async () => {
  const id = await add({ company: "ABC 테크", title: "백엔드 개발자" });
  await add({ company: "ABC 테크", title: "프론트엔드 개발자" });
  expect((await findSimilar(db, "u1", trackId, "abc테크", "백엔드  개발자")).map((item) => item.id)).toEqual([id]);
  expect(await findSimilar(db, "u1", trackId, "abc테크", "백엔드 개발자", id)).toEqual([]);
  expect(await findSimilar(db, "u2", otherTrackId, "ABC 테크", "백엔드 개발자")).toEqual([]);
});

test("트랙별 공고 수를 센다. 지우면 줄어든다", async () => {
  const id = await add();
  await add({ company: "다른 회사" });
  expect(await countPostings(db, "u1")).toEqual({ [trackId]: 2 });
  expect(await deletePosting(db, "u1", id)).toEqual({ ok: true });
  expect(await countPostings(db, "u1")).toEqual({ [trackId]: 1 });
  expect(await countPostings(db, "u2")).toEqual({});
});

const analysis: PostingAnalysis = {
  requirements: [
    { kind: "required", text: "백엔드 경력", quote: "백엔드 개발자", quoteFound: true, evidence: [] },
  ],
  field: { level: "same_job", reason: "같은 직무" },
  analyzedAt: "2026-11-17T00:00:00.000Z",
};
const readAs = { rawText: raw.rawText, companyNote: null };
const criteria = Object.fromEntries(
  ["jobMatch", "location", "experience", "field", "preferred"].map((k) => [k, { score: 1, weight: 0.2 }]),
) as AppliedScore["criteria"];
const applied: AppliedScore = {
  desire: 80,
  fit: 70,
  criteria,
  analyzedAt: analysis.analyzedAt,
  appliedAt: "2026-11-17T01:00:00.000Z",
};

test("saveAnalysis는 원문이 그대로일 때만 쓴다", async () => {
  const id = await add();
  expect(await saveAnalysis(db, "u1", id, analysis, readAs)).toEqual({ ok: true });
  expect((await getPosting(db, "u1", id))?.analysis).toEqual(analysis);

  const id2 = await add({ company: "둘째" });
  await updatePosting(db, "u1", id2, input({ company: "둘째", rawText: "바뀐 원문" }));
  expect(await saveAnalysis(db, "u1", id2, analysis, readAs)).toEqual({ ok: false, reason: "changed" });
  expect((await getPosting(db, "u1", id2))?.analysis).toBeNull();

  // 인재상 글이 달라져도 쓰지 않는다
  const id3 = await add({ company: "셋째" });
  expect(await saveAnalysis(db, "u1", id3, analysis, { ...readAs, companyNote: "도전" })).toEqual({
    ok: false,
    reason: "changed",
  });
  await updatePosting(db, "u1", id3, input({ company: "셋째", companyNote: "도전" }));
  expect(await saveAnalysis(db, "u1", id3, analysis, { ...readAs, companyNote: "도전" })).toEqual({ ok: true });
});

test("원문이나 인재상 글을 고치면 analysis가 지워지고, 마감일만 고치면 남는다", async () => {
  const id = await add();
  await saveAnalysis(db, "u1", id, analysis, readAs);
  await updatePosting(db, "u1", id, input({ deadline: "2026-12-31" }));
  expect((await getPosting(db, "u1", id))?.analysis).toEqual(analysis);
  await updatePosting(db, "u1", id, input({ companyNote: "새 인재상" }));
  expect((await getPosting(db, "u1", id))?.analysis).toBeNull();

  await saveAnalysis(db, "u1", id, analysis, { rawText: raw.rawText, companyNote: "새 인재상" });
  await updatePosting(db, "u1", id, input({ companyNote: "새 인재상", rawText: "다른 원문" }));
  expect((await getPosting(db, "u1", id))?.analysis).toBeNull();
});

test("applyToPosting 뒤 updateTrack으로 배점을 바꿔도 appliedScore는 그대로", async () => {
  const id = await add();
  expect(await applyToPosting(db, "u1", id, applied)).toEqual({ ok: true });
  await updateTrack(db, "u1", trackId, { ...survey, importanceOrder: ["preferred", "field", "experience", "location", "jobMatch"] });
  expect(await getPosting(db, "u1", id)).toMatchObject({ status: "apply", appliedScore: applied });
  await updatePosting(db, "u1", id, input({ rawText: "고친 원문" }));
  expect((await getPosting(db, "u1", id))?.appliedScore).toEqual(applied);
});

test("지원에서 관심으로 되돌려도 appliedScore는 남는다", async () => {
  const id = await add();
  await applyToPosting(db, "u1", id, applied);
  await setStatus(db, "u1", id, "interest");
  expect(await getPosting(db, "u1", id)).toMatchObject({ status: "interest", appliedScore: applied });
});

test("남의 공고에 saveAnalysis·applyToPosting은 not_found", async () => {
  const id = await add();
  expect(await saveAnalysis(db, "u2", id, analysis, readAs)).toEqual({ ok: false, reason: "not_found" });
  expect(await applyToPosting(db, "u2", id, applied)).toEqual({ ok: false, reason: "not_found" });
  expect(await getPosting(db, "u1", id)).toMatchObject({ analysis: null, appliedScore: null, status: "interest" });
});
