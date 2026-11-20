import { eq } from "drizzle-orm";
import { beforeEach, expect, test } from "vitest";
import { createTestDb } from "@/db/test-db";
import type { Db } from "@/db/types";
import { user } from "@/modules/auth/schema";
import { findClaims, subjectOfJob, subjectOfProject, subjectOfScene } from "./claims";
import { confirmFact, createFact, getFact, updateFact } from "./facts-repo";
import type { JobInput, ProjectInput, SceneInput } from "./record-input";
import {
  answerRecordClaim,
  countOpenRecordClaims,
  hasOpenRecordClaims,
  insertRecordClaims,
  listRecordClaims,
} from "./record-claims-repo";
import { getScene, createScene } from "./scenes-repo";
import { recordClaims, scenes } from "./schema";

let db: Db;

const job: JobInput = {
  company: "가나다 주식회사",
  department: null,
  title: "사원",
  employment: "regular",
  startMonth: "2022-01",
  endMonth: "2023-12",
  isOngoing: false,
  duties: ["물류센터 출고 일정 관리", "주간 보고서 30건 작성 주도"],
  bannedPhrases: [],
};
const project: ProjectInput = {
  name: "결제 개편",
  parent: null,
  startMonth: "2021-01",
  endMonth: "2021-06",
  isOngoing: false,
  role: null,
  tools: [],
  summary: "결제 승인 속도를 2배 높였다.",
  bannedPhrases: [],
};

// 가져온 경력 하나와 그 주장들을 만든다
async function importJob(userId = "u1", input = job) {
  const r = await createFact(db, userId, "job", input, { source: "import" });
  if (!r.ok) throw new Error(r.reason);
  await insertRecordClaims(db, userId, { kind: "job", id: r.id }, findClaims(subjectOfJob(input)));
  return r.id;
}
async function importProject(userId = "u1", input = project) {
  const r = await createFact(db, userId, "project", input, { source: "import" });
  if (!r.ok) throw new Error(r.reason);
  await insertRecordClaims(db, userId, { kind: "project", id: r.id }, findClaims(subjectOfProject(input)));
  return r.id;
}
const byQuote = async (kind: "job" | "project", id: string, part: string, userId = "u1") => {
  const found = (await listRecordClaims(db, userId, { kind, id })).find((claim) => claim.quote.includes(part));
  if (!found) throw new Error(`주장 없음: ${part}`);
  return found;
};

beforeEach(async () => {
  db = await createTestDb();
  await db.insert(user).values([
    { id: "u1", name: "A", email: "u1@example.com" },
    { id: "u2", name: "B", email: "u2@example.com" },
  ]);
});

test("경력의 담당 업무 줄에서 찾은 주장이 저장되고 열린 수가 주인별로 센다", async () => {
  const jobId = await importJob();
  const projectId = await importProject();
  const claims = await listRecordClaims(db, "u1", { kind: "job", id: jobId });
  expect(claims.map((c) => [c.kind, c.quote, c.phrase, c.status])).toEqual([["metric", "주간 보고서 30건 작성 주도", "주도", "pending"]]);
  expect(await countOpenRecordClaims(db, "u1")).toEqual({ [jobId]: 1, [projectId]: 1 });
  expect(await countOpenRecordClaims(db, "u2")).toEqual({});
});

test("다른 사용자의 것은 읽히지 않고 답할 수도 없다", async () => {
  const jobId = await importJob();
  expect(await listRecordClaims(db, "u2", { kind: "job", id: jobId })).toEqual([]);
  const claim = await byQuote("job", jobId, "30건");
  expect(await answerRecordClaim(db, "u2", claim.id, "confirm")).toEqual({ ok: false, reason: "not_found" });
  expect((await byQuote("job", jobId, "30건")).status).toBe("pending");
});

test("경력 주장에 맞음 → confirmed, 모름 → needs_fix(수치 줄이 없다)", async () => {
  const jobId = await importJob();
  const claim = await byQuote("job", jobId, "30건");
  expect(await answerRecordClaim(db, "u1", claim.id, "unknown")).toEqual({ ok: true, status: "needs_fix" });
  expect(await hasOpenRecordClaims(db, { kind: "job", id: jobId })).toBe(true);
  expect(await answerRecordClaim(db, "u1", claim.id, "confirm")).toEqual({ ok: true, status: "confirmed" });
  expect(await hasOpenRecordClaims(db, { kind: "job", id: jobId })).toBe(false);
  // 닫힌 주장에는 다시 답할 수 없다
  expect(await answerRecordClaim(db, "u1", claim.id, "wrong")).toEqual({ ok: false, reason: "not_allowed" });
});

test("경력 주장에 과장임 → 경력의 금지 표현에 들어가고 needs_fix", async () => {
  const jobId = await importJob();
  const claim = await byQuote("job", jobId, "30건");
  expect(await answerRecordClaim(db, "u1", claim.id, "exaggerated")).toEqual({ ok: true, status: "needs_fix" });
  const fact = await getFact(db, "u1", "job", jobId);
  expect(fact?.value.bannedPhrases).toEqual(["주도"]);
});

test("프로젝트 주장에 과장임·모름도 같은 규칙이다", async () => {
  const projectId = await importProject("u1", { ...project, summary: "결제 승인 속도를 2배 높이는 일을 주도했다." });
  const claim = await byQuote("project", projectId, "2배");
  expect(await answerRecordClaim(db, "u1", claim.id, "exaggerated")).toEqual({ ok: true, status: "needs_fix" });
  expect((await getFact(db, "u1", "project", projectId))?.value.bannedPhrases).toEqual(["주도"]);
});

test("금지 표현이 가득 차면 banned_full", async () => {
  const full = Array.from({ length: 30 }, (_, i) => `표현${i}`);
  const jobId = await importJob("u1", { ...job, bannedPhrases: full });
  const claim = await byQuote("job", jobId, "30건");
  expect(await answerRecordClaim(db, "u1", claim.id, "exaggerated")).toEqual({ ok: false, reason: "banned_full" });
  expect((await byQuote("job", jobId, "30건")).status).toBe("pending");
});

test("담당 업무 줄을 고쳐 구절이 사라지면 needs_fix → fixed, 열린 주장이 없으면 미확인으로 남는다", async () => {
  const jobId = await importJob();
  const claim = await byQuote("job", jobId, "30건");
  await answerRecordClaim(db, "u1", claim.id, "wrong");
  const r = await updateFact(db, "u1", "job", jobId, { ...job, duties: ["물류센터 출고 일정 관리", "주간 보고서 작성"] });
  expect(r).toEqual({ ok: true });
  expect((await listRecordClaims(db, "u1", { kind: "job", id: jobId })).map((c) => c.status)).toEqual(["fixed"]);
  expect((await getFact(db, "u1", "job", jobId))?.isConfirmed).toBe(false);
});

test("고친 뒤에도 열린 주장이 남으면 확인이 풀리고, 맞음을 눌러도 claims_pending", async () => {
  const jobId = await importJob();
  // 확인된 상태를 만든다(주장은 닫아 두었다가 다시 열리게 한다)
  const claim = await byQuote("job", jobId, "30건");
  await answerRecordClaim(db, "u1", claim.id, "confirm");
  expect(await confirmFact(db, "u1", "job", jobId)).toEqual({ ok: true });
  // 새 줄에 새 주장이 생기면 열린 주장이 남아 확인이 풀린다
  await updateFact(db, "u1", "job", jobId, { ...job, duties: [...job.duties, "신규 거래처 12곳 발굴"] });
  expect((await getFact(db, "u1", "job", jobId))?.isConfirmed).toBe(false);
  expect(await confirmFact(db, "u1", "job", jobId)).toEqual({ ok: false, reason: "claims_pending" });
  expect(await confirmFact(db, "u2", "job", jobId)).toEqual({ ok: false, reason: "not_found" });
});

test("직접 만든 경력은 고쳐도 주장을 만들지 않는다", async () => {
  const r = await createFact(db, "u1", "job", job);
  if (!r.ok) throw new Error(r.reason);
  await updateFact(db, "u1", "job", r.id, { ...job, duties: ["주간 보고서 30건 작성 주도"] });
  expect(await db.select().from(recordClaims).where(eq(recordClaims.jobId, r.id))).toEqual([]);
  expect(await confirmFact(db, "u1", "job", r.id)).toEqual({ ok: true });
});

test("남의 경력에는 주장을 넣을 수 없다", async () => {
  const jobId = await importJob();
  await insertRecordClaims(db, "u2", { kind: "job", id: jobId }, [{ kind: "metric", quote: "거래처 12곳", phrase: null, origin: "code" }]);
  expect(await db.select().from(recordClaims).where(eq(recordClaims.jobId, jobId))).toHaveLength(1);
  expect(await countOpenRecordClaims(db, "u2")).toEqual({});
});

// 장면에 딸린 주장
const sceneInput = (headId: string, over: Partial<SceneInput> = {}): SceneInput => ({
  head: { kind: "job", id: headId },
  title: "결제 장애 대응",
  startMonth: null,
  endMonth: null,
  isOngoing: false,
  situation: "장애가 잦았다",
  judgment: null,
  actions: "승인 API를 설계했다",
  result: "장애가 줄었다",
  lessons: null,
  metrics: [{ text: "월 장애 5건에서 1건", basis: "보고서" }, { text: "응답 속도 30% 개선", basis: null }],
  notDone: null,
  bannedPhrases: [],
  evidenceNote: null,
  tags: [],
  ...over,
});
async function importScene(userId = "u1", over: Partial<SceneInput> = {}) {
  const head = await createFact(db, userId, "job", job);
  if (!head.ok) throw new Error(head.reason);
  const input = sceneInput(head.id, over);
  const r = await createScene(db, userId, input, { source: "import" });
  if (!r.ok) throw new Error(r.reason);
  await insertRecordClaims(db, userId, { kind: "scene", id: r.id }, findClaims(subjectOfScene(input)));
  return r.id;
}
const sceneClaim = async (sceneId: string, part: string, userId = "u1") => {
  const found = (await listRecordClaims(db, userId, { kind: "scene", id: sceneId })).find((c) => c.quote.includes(part));
  if (!found) throw new Error(`주장 없음: ${part}`);
  return found;
};

test("장면 주장에 unknown → 그 수치 줄이 지워지고 장면이 미확인·contentVersion+1", async () => {
  const id = await importScene();
  const claim = await sceneClaim(id, "30%");
  expect(claim.kind).toBe("metric");
  await db.update(scenes).set({ confirmedAt: new Date() }).where(eq(scenes.id, id));
  expect(await answerRecordClaim(db, "u1", claim.id, "unknown")).toEqual({ ok: true, status: "removed" });
  const found = await getScene(db, "u1", id);
  expect(found?.metrics).toEqual([{ text: "월 장애 5건에서 1건", basis: "보고서" }]);
  expect(found?.isConfirmed).toBe(false);
  expect(found?.contentVersion).toBe(1);
  expect(found?.rubric.period.status).toBe("met");
  expect((await listRecordClaims(db, "u1", { kind: "scene", id })).find((c) => c.quote.includes("30%"))?.status).toBe("removed");
});

test("장면 본문에도 같은 구절이 남아 있으면 수치 줄만 지우고 주장은 고쳐야 함으로 둔다", async () => {
  const id = await importScene("u1", { result: "응답 속도 30% 개선" });
  const claim = await sceneClaim(id, "30%");
  expect(await answerRecordClaim(db, "u1", claim.id, "unknown")).toEqual({ ok: true, status: "needs_fix" });
  expect((await getScene(db, "u1", id))?.metrics).toHaveLength(1);
});

test("장면 주장에 exaggerated → 장면의 금지 표현에 들어가고 내용은 그대로", async () => {
  const id = await importScene("u1", { result: "프로젝트를 주도하며 장애가 줄었다" });
  const roleClaim = (await listRecordClaims(db, "u1", { kind: "scene", id })).find((c) => c.phrase);
  if (!roleClaim?.phrase) throw new Error("과장 주장 없음");
  await db.update(scenes).set({ confirmedAt: new Date() }).where(eq(scenes.id, id));
  expect(await answerRecordClaim(db, "u1", roleClaim.id, "exaggerated")).toEqual({ ok: true, status: "needs_fix" });
  const found = await getScene(db, "u1", id);
  expect(found?.bannedPhrases).toContain(roleClaim.phrase);
  expect(found?.contentVersion).toBe(0);
  expect(found?.isConfirmed).toBe(true);
});

test("장면 주장의 confirm은 상태만 바꾸고, 수치가 아닌 주장의 unknown은 거절된다", async () => {
  const id = await importScene();
  const metric = await sceneClaim(id, "5건");
  expect(await answerRecordClaim(db, "u1", metric.id, "confirm")).toEqual({ ok: true, status: "confirmed" });
  expect(await answerRecordClaim(db, "u1", metric.id, "confirm")).toEqual({ ok: false, reason: "not_allowed" });
  const period = (await listRecordClaims(db, "u1", { kind: "scene", id })).find((c) => c.kind === "period");
  if (period) expect(await answerRecordClaim(db, "u1", period.id, "unknown")).toEqual({ ok: false, reason: "not_allowed" });
});

test("다른 사용자의 장면 주장은 not_found이고 장면은 그대로다", async () => {
  const id = await importScene();
  const claim = await sceneClaim(id, "30%");
  expect(await answerRecordClaim(db, "u2", claim.id, "unknown")).toEqual({ ok: false, reason: "not_found" });
  expect((await getScene(db, "u1", id))?.metrics).toHaveLength(2);
});
