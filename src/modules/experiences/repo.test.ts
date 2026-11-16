import { eq } from "drizzle-orm";
import { beforeEach, expect, test } from "vitest";
import { createTestDb } from "@/db/test-db";
import type { Db } from "@/db/types";
import { user } from "@/modules/auth/schema";
import { createTrack } from "@/modules/tracks/repo";
import { tracks } from "@/modules/tracks/schema";
import type { SurveyInput } from "@/modules/tracks/survey";
import type { ExperienceInput } from "./input";
import {
  closeRubricItem,
  confirmExperience,
  countExperiences,
  createExperience,
  deleteExperience,
  getExperience,
  getTrackScopes,
  listExperiences,
  reopenRubricItem,
  setTrackScope,
  unconfirmExperience,
  updateExperience,
} from "./repo";
import { experiences, trackScopes } from "./schema";

let db: Db;
let t1: string; // u1의 트랙
let t2: string; // u2의 트랙

const job: ExperienceInput = {
  name: "결제 시스템 개편",
  kind: "project",
  organization: "가나다 주식회사",
  role: "백엔드 개발",
  startMonth: "2023-03",
  endMonth: "2023-11",
  isOngoing: false,
  situation: "장애가 잦았다",
  actions: "결제 승인 API를 다시 설계했다",
  result: "장애가 줄었다",
  metrics: [{ text: "월 장애 5건에서 1건", basis: "사내 장애 보고서" }],
  notDone: "프론트엔드는 하지 않았다",
  bannedPhrases: ["혼자 구축"],
  evidenceNote: null,
  tags: ["결제"],
};

const school: ExperienceInput = {
  ...job,
  name: "한국대학교 컴퓨터공학과",
  kind: "school",
  startMonth: "2015-03",
  endMonth: "2019-02",
  metrics: [],
};

const survey: SurveyInput = {
  name: "개발",
  majorCode: "20",
  jobs: [{ ncsCode: "20010202", customName: null }],
  applicantType: "new",
  experienceMonths: null,
  regions: ["seoul"],
  salaryMin: null,
  employmentTypes: ["regular"],
  importanceOrder: ["jobMatch", "location", "experience", "field", "preferred"],
  extraAnswers: {},
};

async function track(userId: string) {
  const result = await createTrack(db, userId, survey);
  if (!result.ok) throw new Error(result.reason);
  return result.id;
}

beforeEach(async () => {
  db = await createTestDb();
  await db.insert(user).values([
    { id: "u1", name: "A", email: "u1@example.com" },
    { id: "u2", name: "B", email: "u2@example.com" },
  ]);
  t1 = await track("u1");
  t2 = await track("u2");
});

test("만든 기록을 본인이 다시 읽으면 입력과 같고 처음에는 미확인이다", async () => {
  const id = await createExperience(db, "u1", job);
  const found = await getExperience(db, "u1", id);
  expect(found).toMatchObject({ ...job, id, state: "unconfirmed" });
  expect(found?.rubric.period.status).toBe("met");
  expect(found?.rubric.role.status).toBe("unjudged");
});

test("다른 사용자의 기록은 읽히지 않고 목록에도 없다", async () => {
  const id = await createExperience(db, "u1", job);
  expect(await getExperience(db, "u2", id)).toBeNull();
  expect(await listExperiences(db, "u2")).toEqual([]);
  expect(await countExperiences(db, "u2")).toBe(0);
});

test("다른 사용자의 기록은 고치기·지우기·확인·닫기·범위 설정이 모두 not_found이고 원래 값이 그대로다", async () => {
  const id = await createExperience(db, "u1", job);
  const notFound = { ok: false, reason: "not_found" };
  expect(await updateExperience(db, "u2", id, { ...job, name: "탈취" })).toEqual(notFound);
  expect(await deleteExperience(db, "u2", id)).toEqual(notFound);
  expect(await confirmExperience(db, "u2", id)).toEqual(notFound);
  expect(await unconfirmExperience(db, "u2", id)).toEqual(notFound);
  expect(await closeRubricItem(db, "u2", id, "metrics")).toEqual(notFound);
  expect(await reopenRubricItem(db, "u2", id, "metrics")).toEqual(notFound);
  expect(await setTrackScope(db, "u2", id, t2, "exclude")).toEqual(notFound);
  const found = await getExperience(db, "u1", id);
  expect(found).toMatchObject({ name: job.name, state: "unconfirmed" });
  expect(found?.rubric.metrics.status).toBe("unjudged");
});

test("재직·프로젝트 기록은 확인해도 AI 판정 전에는 부분 확인이다", async () => {
  const id = await createExperience(db, "u1", job);
  expect(await confirmExperience(db, "u1", id)).toEqual({ ok: true });
  expect((await getExperience(db, "u1", id))?.state).toBe("partial");
});

test("학력 기록은 기간을 채우고 확인하면 확인됨이다", async () => {
  const id = await createExperience(db, "u1", school);
  await confirmExperience(db, "u1", id);
  expect((await getExperience(db, "u1", id))?.state).toBe("confirmed");
  await unconfirmExperience(db, "u1", id);
  expect((await getExperience(db, "u1", id))?.state).toBe("unconfirmed");
});

test("확인한 뒤 내용을 고치면 미확인으로 돌아간다", async () => {
  const id = await createExperience(db, "u1", school);
  await confirmExperience(db, "u1", id);
  await updateExperience(db, "u1", id, { ...school, situation: "내용을 바꿨다" });
  expect((await getExperience(db, "u1", id))?.state).toBe("unconfirmed");
});

test("이름·태그·증빙 메모·금지 표현만 고치면 확인이 유지된다", async () => {
  const id = await createExperience(db, "u1", school);
  await confirmExperience(db, "u1", id);
  await updateExperience(db, "u1", id, {
    ...school,
    name: "한국대 컴공",
    tags: ["학력"],
    evidenceNote: "졸업증명서",
    bannedPhrases: ["수석 졸업"],
  });
  const found = await getExperience(db, "u1", id);
  expect(found).toMatchObject({ name: "한국대 컴공", tags: ["학력"], state: "confirmed" });
});

test("기간을 지우면 기간 항목이 미달로 다시 계산된다", async () => {
  const id = await createExperience(db, "u1", school);
  await updateExperience(db, "u1", id, { ...school, endMonth: null });
  expect((await getExperience(db, "u1", id))?.rubric.period.status).toBe("unmet");
});

test("수치는 닫고 다시 열 수 있고, 닫은 것은 내용을 고쳐도 유지된다", async () => {
  const id = await createExperience(db, "u1", job);
  expect(await closeRubricItem(db, "u1", id, "metrics")).toEqual({ ok: true });
  await updateExperience(db, "u1", id, { ...job, result: "바뀐 결과" });
  expect((await getExperience(db, "u1", id))?.rubric.metrics.status).toBe("closed");
  expect(await reopenRubricItem(db, "u1", id, "metrics")).toEqual({ ok: true });
  expect((await getExperience(db, "u1", id))?.rubric.metrics.status).toBe("unjudged");
});

test("본인 역할과 기간은 닫을 수 없다", async () => {
  const id = await createExperience(db, "u1", job);
  expect(await closeRubricItem(db, "u1", id, "role")).toEqual({ ok: false, reason: "not_allowed" });
  expect(await closeRubricItem(db, "u1", id, "period")).toEqual({ ok: false, reason: "not_allowed" });
  expect((await getExperience(db, "u1", id))?.rubric.role.status).toBe("unjudged");
});

test("범위를 정하지 않은 트랙은 사용으로 읽히고, 정하면 바뀐다", async () => {
  const id = await createExperience(db, "u1", job);
  expect(await getTrackScopes(db, "u1", id)).toEqual({ [t1]: "use" });
  expect(await setTrackScope(db, "u1", id, t1, "summary")).toEqual({ ok: true });
  expect(await setTrackScope(db, "u1", id, t1, "exclude")).toEqual({ ok: true });
  expect(await getTrackScopes(db, "u1", id)).toEqual({ [t1]: "exclude" });
  expect(await db.select().from(trackScopes)).toHaveLength(1);
});

test("남의 트랙에는 범위를 설정할 수 없다", async () => {
  const id = await createExperience(db, "u1", job);
  expect(await setTrackScope(db, "u1", id, t2, "exclude")).toEqual({ ok: false, reason: "not_found" });
  expect(await db.select().from(trackScopes)).toEqual([]);
});

test("범위 설정은 본인 확인을 풀지 않는다", async () => {
  const id = await createExperience(db, "u1", school);
  await confirmExperience(db, "u1", id);
  await setTrackScope(db, "u1", id, t1, "summary");
  expect((await getExperience(db, "u1", id))?.state).toBe("confirmed");
});

test("목록은 시작 월이 최근인 순이고 시작 월이 없는 것은 맨 아래다", async () => {
  await createExperience(db, "u1", school); // 2015-03
  await createExperience(db, "u1", { ...job, name: "기간 없음", startMonth: null, endMonth: null });
  await createExperience(db, "u1", job); // 2023-03
  const list = await listExperiences(db, "u1");
  expect(list.map((e) => e.name)).toEqual([job.name, school.name, "기간 없음"]);
  expect(list[0]).toMatchObject({ kind: "project", state: "unconfirmed", startMonth: "2023-03" });
  expect(await countExperiences(db, "u1")).toBe(3);
});

test("지운 기록은 읽히지 않고 범위 행도 함께 지워진다", async () => {
  const id = await createExperience(db, "u1", job);
  await setTrackScope(db, "u1", id, t1, "exclude");
  expect(await deleteExperience(db, "u1", id)).toEqual({ ok: true });
  expect(await getExperience(db, "u1", id)).toBeNull();
  expect(await db.select().from(trackScopes)).toEqual([]);
});

test("트랙을 지우면 범위 행이, 사용자를 지우면 기록과 범위 행이 함께 지워진다", async () => {
  const id = await createExperience(db, "u1", job);
  await setTrackScope(db, "u1", id, t1, "exclude");
  await db.delete(tracks).where(eq(tracks.id, t1));
  expect(await db.select().from(trackScopes)).toEqual([]);
  await db.delete(user).where(eq(user.id, "u1"));
  expect(await db.select().from(experiences)).toEqual([]);
});
