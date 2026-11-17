import { beforeEach, expect, test } from "vitest";
import { createTestDb } from "@/db/test-db";
import type { Db } from "@/db/types";
import { user } from "@/modules/auth/schema";
import type { ExperienceInput } from "@/modules/experiences/input";
import { confirmExperience, createExperience, unconfirmExperience, updateExperience } from "@/modules/experiences/repo";
import { createTrack } from "@/modules/tracks/repo";
import type { SurveyInput } from "@/modules/tracks/survey";
import type { PostingAnalysis } from "./analysis";
import { applyWithCurrentScore } from "./apply";
import { validatePosting } from "./input";
import { createPosting, getPosting, saveAnalysis } from "./repo";

let db: Db;
let trackId: string;
const now = new Date("2026-11-20T03:00:00Z");
const rawText = "자격 요건\n- Java 실무 경력 3년 이상\n우대 사항\n- 대용량 트래픽 경험";

// 배점: 직무 일치 30, 근무지 25, 경력 요건 20, 분야 15, 우대 요건 10. 경력 30개월
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
  metrics: [],
  notDone: "",
  bannedPhrases: [],
  evidenceNote: "",
  tags: [],
};

async function addPosting(userId = "u1") {
  const checked = validatePosting({
    company: "가나다 주식회사",
    title: "백엔드 개발자",
    deadline: "2026-11-30",
    isRolling: false,
    locationText: "서울",
    regions: ["seoul"],
    careerType: "experienced",
    minYears: 3,
    employmentType: "regular",
    url: "",
    rawText,
    companyNote: "",
  });
  if (!checked.ok) throw new Error(JSON.stringify(checked.errors));
  const result = await createPosting(db, userId, trackId, checked.value);
  if (!result.ok) throw new Error(result.reason);
  return result.id;
}

const analysis = (experienceId: string, contentVersion = 0): PostingAnalysis => ({
  field: { level: "same_job", reason: "같은 직무" },
  requirements: [
    {
      kind: "required",
      text: "Java 실무 경력 3년 이상",
      quote: "Java 실무 경력 3년 이상",
      quoteFound: true,
      evidence: [{ experienceId, contentVersion, level: "partial", why: "Java 결제 API 설계" }],
    },
    { kind: "preferred", text: "대용량 트래픽 경험", quote: "대용량 트래픽 경험", quoteFound: true, evidence: [] },
  ],
  analyzedAt: "2026-11-18T01:00:00.000Z",
});

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

test("analysis가 없으면 no_analysis", async () => {
  const id = await addPosting();
  expect(await applyWithCurrentScore(db, "u1", id, now)).toEqual({ ok: false, reason: "no_analysis" });
  expect((await getPosting(db, "u1", id))?.status).toBe("interest");
});

test("지원하면 지금의 경험으로 계산한 점수와 배점이 저장되고 상태가 지원이 된다", async () => {
  const experienceId = await createExperience(db, "u1", job);
  await confirmExperience(db, "u1", experienceId);
  const id = await addPosting();
  await saveAnalysis(db, "u1", id, analysis(experienceId), { rawText, companyNote: null });

  // 근거 경험의 확인을 풀면 그 근거는 빠진다
  await unconfirmExperience(db, "u1", experienceId);
  expect(await applyWithCurrentScore(db, "u1", id, now)).toEqual({ ok: true });

  const saved = await getPosting(db, "u1", id);
  expect(saved?.status).toBe("apply");
  // 직무 일치 0, 경력 요건 0.7(6개월 모자람), 우대 0 → (0·30 + 0.7·20 + 0·10) / 60 = 23
  expect(saved?.appliedScore).toEqual({
    desire: 100,
    fit: 23,
    criteria: {
      jobMatch: { score: 0, weight: 30 },
      location: { score: 1, weight: 25 },
      experience: { score: 0.7, weight: 20 },
      field: { score: 1, weight: 15 },
      preferred: { score: 0, weight: 10 },
    },
    analyzedAt: "2026-11-18T01:00:00.000Z",
    appliedAt: now.toISOString(),
  });
});

test("근거 경험이 확인되어 있으면 그 근거가 점수에 들어간다", async () => {
  const experienceId = await createExperience(db, "u1", job);
  await confirmExperience(db, "u1", experienceId);
  const id = await addPosting();
  await saveAnalysis(db, "u1", id, analysis(experienceId), { rawText, companyNote: null });

  await applyWithCurrentScore(db, "u1", id, now);
  // 직무 일치 0.5 → (0.5·30 + 0.7·20) / 60 = 48
  expect((await getPosting(db, "u1", id))?.appliedScore).toMatchObject({ fit: 48, criteria: { jobMatch: { score: 0.5 } } });
});

test("맞댄 뒤 근거 경험의 내용을 고쳐 다시 확인했으면 그 근거는 점수에 들어가지 않는다", async () => {
  const experienceId = await createExperience(db, "u1", job);
  await confirmExperience(db, "u1", experienceId);
  const id = await addPosting();
  await saveAnalysis(db, "u1", id, analysis(experienceId), { rawText, companyNote: null });

  // Java를 빼고 고친 뒤 다시 확인한다(내용 버전이 오른다)
  await updateExperience(db, "u1", experienceId, { ...job, actions: "Python으로 정산 배치를 만들었다" });
  await confirmExperience(db, "u1", experienceId);
  expect(await applyWithCurrentScore(db, "u1", id, now)).toEqual({ ok: true });

  // 직무 일치 0 → (0.7·20) / 60 = 23
  expect((await getPosting(db, "u1", id))?.appliedScore).toMatchObject({ fit: 23, criteria: { jobMatch: { score: 0 } } });
});

test("이미 지원한 공고는 다시 지원해도 지원할 때의 점수와 날짜가 바뀌지 않는다", async () => {
  const experienceId = await createExperience(db, "u1", job);
  await confirmExperience(db, "u1", experienceId);
  const id = await addPosting();
  await saveAnalysis(db, "u1", id, analysis(experienceId), { rawText, companyNote: null });
  await applyWithCurrentScore(db, "u1", id, now);
  const first = (await getPosting(db, "u1", id))?.appliedScore;
  expect(first).toMatchObject({ fit: 48, appliedAt: now.toISOString() });

  // 다른 탭에 남은 예전 화면에서 한 번 더 누른 경우. 그사이 근거 경험의 확인을 풀었다
  await unconfirmExperience(db, "u1", experienceId);
  expect(await applyWithCurrentScore(db, "u1", id, new Date("2026-11-25T03:00:00Z"))).toEqual({ ok: true });
  expect((await getPosting(db, "u1", id))?.appliedScore).toEqual(first);
});

test("남의 공고는 not_found", async () => {
  const id = await addPosting();
  await saveAnalysis(db, "u1", id, analysis("없음"), { rawText, companyNote: null });
  expect(await applyWithCurrentScore(db, "u2", id, now)).toEqual({ ok: false, reason: "not_found" });
  expect(await applyWithCurrentScore(db, "u1", "없는-공고", now)).toEqual({ ok: false, reason: "not_found" });
  expect((await getPosting(db, "u1", id))?.status).toBe("interest");
});
