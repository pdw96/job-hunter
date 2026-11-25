import { eq } from "drizzle-orm";
import { beforeEach, expect, test } from "vitest";
import { createTestDb } from "@/db/test-db";
import type { Db } from "@/db/types";
import { user } from "@/modules/auth/schema";
import { createTrack } from "@/modules/tracks/repo";
import type { SurveyInput } from "@/modules/tracks/survey";
import { findClaims, subjectOfScene } from "./claims";
import { createFact, getFact } from "./facts-repo";
import type { CourseInput, EducationInput, JobInput, SceneInput } from "./record-input";
import { insertRecordClaims, listRecordClaims } from "./record-claims-repo";
import {
  closeSceneRubricItem,
  confirmScene,
  createScene,
  deleteScene,
  getScene,
  listScenes,
  reopenSceneRubricItem,
  setSceneTrackScope,
  unconfirmScene,
  updateScene,
} from "./scenes-repo";
import { scenes } from "./schema";

let db: Db;
let jobId: string;
let otherJobId: string;

const job: JobInput = {
  company: "가나다 주식회사",
  department: null,
  title: "사원",
  employment: "regular",
  startMonth: "2022-03",
  endMonth: "2024-08",
  isOngoing: false,
  duties: ["출고 일정 관리"],
  bannedPhrases: [],
};
const scene = (head: SceneInput["head"], over: Partial<SceneInput> = {}): SceneInput => ({
  head,
  title: "결제 장애 대응",
  startMonth: null,
  endMonth: null,
  isOngoing: false,
  situation: "결제 장애가 잦았다",
  judgment: null,
  actions: "승인 API를 다시 설계했다",
  result: "장애가 줄었다",
  lessons: null,
  metrics: [{ text: "월 장애 5건에서 1건", basis: "장애 보고서" }],
  notDone: null,
  bannedPhrases: ["혼자 구축"],
  evidenceNote: null,
  tags: [],
  ...over,
});
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

async function make(userId = "u1", input?: Partial<SceneInput>, head = jobId) {
  const r = await createScene(db, userId, scene({ kind: "job", id: head }, input));
  if (!r.ok) throw new Error(r.reason);
  return r.id;
}

beforeEach(async () => {
  db = await createTestDb();
  await db.insert(user).values([
    { id: "u1", name: "A", email: "u1@example.com" },
    { id: "u2", name: "B", email: "u2@example.com" },
  ]);
  const a = await createFact(db, "u1", "job", job);
  const b = await createFact(db, "u2", "job", job);
  if (!a.ok || !b.ok) throw new Error("job");
  jobId = a.id;
  otherJobId = b.id;
});

test("만들면 미확인이고 기간은 머리로 판정한다", async () => {
  const id = await make();
  const found = await getScene(db, "u1", id);
  expect(found?.isConfirmed).toBe(false);
  expect(found?.state).toBe("unconfirmed");
  expect(found?.contentVersion).toBe(0);
  expect(found?.rubric.period).toEqual({ status: "met", note: null });
  expect(found?.head).toEqual({ kind: "job", id: jobId });
  expect(found?.source).toBe("manual");
});

test("머리에 기간이 없고 장면에도 없으면 기간 미달", async () => {
  const noPeriod = await createFact(db, "u1", "job", { ...job, startMonth: null, endMonth: null });
  if (!noPeriod.ok) throw new Error("job");
  const id = await make("u1", {}, noPeriod.id);
  expect((await getScene(db, "u1", id))?.rubric.period.status).toBe("unmet");
});

test("남의 머리에는 장면을 만들거나 옮길 수 없다", async () => {
  expect(await createScene(db, "u1", scene({ kind: "job", id: otherJobId }))).toEqual({ ok: false, reason: "not_found" });
  expect(await createScene(db, "u1", scene({ kind: "project", id: "없는-id" }))).toEqual({ ok: false, reason: "not_found" });
  const id = await make();
  expect(await updateScene(db, "u1", id, scene({ kind: "job", id: otherJobId }))).toEqual({ ok: false, reason: "not_found" });
  expect((await getScene(db, "u1", id))?.head.id).toBe(jobId);
});

test("내용을 고치면 미확인이 되고 contentVersion이 오르며 닫은 수치는 유지된다", async () => {
  const id = await make();
  await closeSceneRubricItem(db, "u1", id, "metrics");
  await confirmScene(db, "u1", id);
  expect((await getScene(db, "u1", id))?.isConfirmed).toBe(true);
  await updateScene(db, "u1", id, scene({ kind: "job", id: jobId }, { result: "장애가 크게 줄었다" }));
  const found = await getScene(db, "u1", id);
  expect(found?.isConfirmed).toBe(false);
  expect(found?.contentVersion).toBe(1);
  expect(found?.rubric.metrics.status).toBe("closed");
  expect(found?.rubric.role.status).toBe("unjudged");
});

test("내용이 아닌 칸(태그, 금지 표현)만 고치면 확인과 버전이 그대로다", async () => {
  const id = await make();
  await confirmScene(db, "u1", id);
  await updateScene(db, "u1", id, scene({ kind: "job", id: jobId }, { tags: ["결제"], bannedPhrases: [] }));
  const found = await getScene(db, "u1", id);
  expect(found?.isConfirmed).toBe(true);
  expect(found?.contentVersion).toBe(0);
  expect(found?.tags).toEqual(["결제"]);
});

test("머리를 바꾸는 것은 내용 변경이다", async () => {
  const id = await make();
  await confirmScene(db, "u1", id);
  const second = await createFact(db, "u1", "job", { ...job, company: "라마바" });
  if (!second.ok) throw new Error("job");
  await updateScene(db, "u1", id, scene({ kind: "job", id: second.id }));
  const found = await getScene(db, "u1", id);
  expect(found?.head.id).toBe(second.id);
  expect(found?.isConfirmed).toBe(false);
  expect(found?.contentVersion).toBe(1);
});

test("확인한 뒤 state는 루브릭에 따라 partial 또는 confirmed", async () => {
  const id = await make();
  expect(await confirmScene(db, "u1", id)).toEqual({ ok: true });
  expect((await getScene(db, "u1", id))?.state).toBe("partial"); // 역할·수준 미판정
  await db
    .update(scenes)
    .set({ rubric: { ...(await getScene(db, "u1", id))!.rubric, role: { status: "met", note: null }, level: { status: "met", note: null } } })
    .where(eq(scenes.id, id));
  expect((await getScene(db, "u1", id))?.state).toBe("confirmed");
  await unconfirmScene(db, "u1", id);
  expect((await getScene(db, "u1", id))?.state).toBe("unconfirmed");
});

test("withHead면 머리도 함께 확인된다", async () => {
  const id = await make();
  expect(await confirmScene(db, "u1", id, { withHead: true })).toEqual({ ok: true });
  expect((await getFact(db, "u1", "job", jobId))?.isConfirmed).toBe(true);
  expect((await getScene(db, "u1", id))?.isConfirmed).toBe(true);
});

test("머리에 열린 주장이 있으면 head_claims_pending이고 장면도 그대로다", async () => {
  const imported = await createFact(db, "u1", "job", job, { source: "import" });
  if (!imported.ok) throw new Error("job");
  await insertRecordClaims(db, "u1", { kind: "job", id: imported.id }, [
    { kind: "role", quote: "출고 일정 관리", phrase: null, origin: "code" },
  ]);
  const id = await make("u1", {}, imported.id);
  expect(await confirmScene(db, "u1", id, { withHead: true })).toEqual({ ok: false, reason: "head_claims_pending" });
  expect((await getScene(db, "u1", id))?.isConfirmed).toBe(false);
  expect((await getFact(db, "u1", "job", imported.id))?.isConfirmed).toBe(false);
  // 머리를 따로 확인하지 않는 확인은 된다
  expect(await confirmScene(db, "u1", id)).toEqual({ ok: true });
});

test("장면에 열린 주장이 있으면 claims_pending", async () => {
  const id = await make();
  await insertRecordClaims(db, "u1", { kind: "scene", id }, findClaims(subjectOfScene(scene({ kind: "job", id: jobId }))));
  expect(await confirmScene(db, "u1", id)).toEqual({ ok: false, reason: "claims_pending" });
  expect((await getScene(db, "u1", id))?.isConfirmed).toBe(false);
});

test("가져온 장면은 고치면 주장을 맞추고 열린 주장이 남으면 확인이 풀린다", async () => {
  const input = scene({ kind: "job", id: jobId }, { metrics: [] });
  const r = await createScene(db, "u1", input, { source: "import" });
  if (!r.ok) throw new Error("scene");
  await confirmScene(db, "u1", r.id);
  await updateScene(db, "u1", r.id, { ...input, tags: ["x"], result: "처리 시간을 30% 줄였다" });
  expect((await getScene(db, "u1", r.id))?.isConfirmed).toBe(false);
  const claims = await listRecordClaims(db, "u1", { kind: "scene", id: r.id });
  expect(claims.some((c) => c.kind === "metric" && c.quote.includes("30%"))).toBe(true);
});

test("수치 닫기와 다시 열기는 수치·증빙만 된다", async () => {
  const id = await make();
  expect(await closeSceneRubricItem(db, "u1", id, "role")).toEqual({ ok: false, reason: "not_allowed" });
  expect(await closeSceneRubricItem(db, "u1", id, "evidence")).toEqual({ ok: true });
  expect((await getScene(db, "u1", id))?.rubric.evidence.status).toBe("closed");
  expect(await reopenSceneRubricItem(db, "u1", id, "evidence")).toEqual({ ok: true });
  expect((await getScene(db, "u1", id))?.rubric.evidence.status).toBe("unjudged");
  expect(await closeSceneRubricItem(db, "u2", id, "evidence")).toEqual({ ok: false, reason: "not_found" });
});

test("목록은 시작 월 최근 순이고 지우면 주장도 사라진다", async () => {
  const a = await make("u1", { title: "A", startMonth: "2023-01", endMonth: "2023-02" });
  const b = await make("u1", { title: "B", startMonth: "2024-01", endMonth: "2024-02" });
  const c = await make("u1", { title: "C" });
  expect((await listScenes(db, "u1")).map((s) => s.id)).toEqual([b, a, c]);
  await insertRecordClaims(db, "u1", { kind: "scene", id: a }, [{ kind: "metric", quote: "30%", phrase: null, origin: "code" }]);
  expect(await deleteScene(db, "u1", a)).toEqual({ ok: true });
  expect(await getScene(db, "u1", a)).toBeNull();
  expect(await deleteScene(db, "u1", a)).toEqual({ ok: false, reason: "not_found" });
});

test("트랙별 범위는 본인 장면과 본인 트랙만", async () => {
  const created = await createTrack(db, "u1", survey);
  if (!created.ok) throw new Error(created.reason);
  const t1 = created.id;
  const id = await make();
  expect(await setSceneTrackScope(db, "u1", id, t1, "summary")).toEqual({ ok: true });
  expect((await getScene(db, "u1", id))?.trackScopes).toEqual({ [t1]: "summary" });
  expect(await setSceneTrackScope(db, "u2", id, t1, "exclude")).toEqual({ ok: false, reason: "not_found" });
});

test("다른 사용자의 장면은 읽히지 않고 바뀌지 않는다", async () => {
  const id = await make();
  expect(await getScene(db, "u2", id)).toBeNull();
  expect(await listScenes(db, "u2")).toEqual([]);
  expect(await updateScene(db, "u2", id, scene({ kind: "job", id: otherJobId }))).toEqual({ ok: false, reason: "not_found" });
  expect(await confirmScene(db, "u2", id)).toEqual({ ok: false, reason: "not_found" });
  expect(await unconfirmScene(db, "u2", id)).toEqual({ ok: false, reason: "not_found" });
  expect(await deleteScene(db, "u2", id)).toEqual({ ok: false, reason: "not_found" });
  expect((await getScene(db, "u1", id))?.isConfirmed).toBe(false);
});

test("증빙 메모만 고치면 증빙 판정이 처음으로 돌아가지만 확인과 내용 버전은 그대로다", async () => {
  const id = await make();
  await confirmScene(db, "u1", id);
  const set = async (evidence: { status: "unmet" | "met" | "closed"; note: string | null }) =>
    db.update(scenes).set({ rubric: { ...(await getScene(db, "u1", id))!.rubric, evidence }, judgedAt: new Date() }).where(eq(scenes.id, id));
  await set({ status: "unmet", note: "자료 필요" });
  await updateScene(db, "u1", id, scene({ kind: "job", id: jobId }, { evidenceNote: "보고서 공유 드라이브" }));
  let found = await getScene(db, "u1", id);
  expect(found?.rubric.evidence).toEqual({ status: "unjudged", note: null });
  expect(found?.judgedAt).toBeNull();
  expect(found?.isConfirmed).toBe(true);
  expect(found?.contentVersion).toBe(0);

  await set({ status: "closed", note: null });
  await updateScene(db, "u1", id, scene({ kind: "job", id: jobId }, { evidenceNote: "다른 메모" }));
  found = await getScene(db, "u1", id);
  expect(found?.rubric.evidence.status).toBe("closed");
  expect(found?.judgedAt).toBeNull();
});

const school: EducationInput = {
  schoolName: "가나대",
  location: null,
  degree: "bachelor",
  major: "컴퓨터공학",
  startMonth: "2022-03",
  endMonth: null,
  status: "enrolled",
  gpa: null,
  gpaScale: null,
};
const course: CourseInput = { name: "백엔드 부트캠프", institution: "다라캠프", startMonth: "2024-01", endMonth: null, hours: null, learned: null };

test("학교에 사례를 붙여 저장하고 읽는다", async () => {
  const f = await createFact(db, "u1", "education", school);
  if (!f.ok) throw new Error("education");
  const head = { kind: "education", id: f.id } as const;
  const r = await createScene(db, "u1", scene(head));
  if (!r.ok) throw new Error(r.reason);
  expect((await getScene(db, "u1", r.id))?.head).toEqual(head);
  expect((await listScenes(db, "u1")).map((s) => s.head)).toEqual([head]);
});

test("교육 과정에 사례를 붙여 저장하고 읽는다", async () => {
  const f = await createFact(db, "u1", "course", course);
  if (!f.ok) throw new Error("course");
  const head = { kind: "course", id: f.id } as const;
  const r = await createScene(db, "u1", scene(head));
  if (!r.ok) throw new Error(r.reason);
  expect((await getScene(db, "u1", r.id))?.head).toEqual(head);
  // 머리를 학교로 옮겨도 읽힌다
  const e = await createFact(db, "u1", "education", school);
  if (!e.ok) throw new Error("education");
  expect(await updateScene(db, "u1", r.id, scene({ kind: "education", id: e.id }))).toMatchObject({ ok: true });
  expect((await getScene(db, "u1", r.id))?.head).toEqual({ kind: "education", id: e.id });
});

test("남의 학교·교육 과정에는 사례를 붙일 수 없다", async () => {
  const e = await createFact(db, "u2", "education", school);
  const c = await createFact(db, "u2", "course", course);
  if (!e.ok || !c.ok) throw new Error("fact");
  const notFound = { ok: false, reason: "not_found" };
  expect(await createScene(db, "u1", scene({ kind: "education", id: e.id }))).toEqual(notFound);
  expect(await createScene(db, "u1", scene({ kind: "course", id: c.id }))).toEqual(notFound);
  const id = await make();
  expect(await updateScene(db, "u1", id, scene({ kind: "education", id: e.id }))).toEqual(notFound);
  expect((await getScene(db, "u1", id))?.head).toEqual({ kind: "job", id: jobId });
});

test("재학 중인 학교에 붙인 기간 없는 사례는 기간이 충족이다", async () => {
  const f = await createFact(db, "u1", "education", school);
  if (!f.ok) throw new Error("education");
  const r = await createScene(db, "u1", scene({ kind: "education", id: f.id }, { startMonth: null }));
  if (!r.ok) throw new Error(r.reason);
  expect((await getScene(db, "u1", r.id))?.rubric.period.status).toBe("met");
});
