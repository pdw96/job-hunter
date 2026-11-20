import { beforeEach, afterEach, expect, test, vi } from "vitest";
import { createTestDb } from "@/db/test-db";
import type { Db } from "@/db/types";
import { user } from "@/modules/auth/schema";
import { createTrack } from "@/modules/tracks/repo";
import type { SurveyInput } from "@/modules/tracks/survey";
import { findClaims, subjectOfJob } from "./claims";
import { createFact, getFact } from "./facts-repo";
import { createFakeAi } from "@/modules/ai/fake-client";
import {
  answerClaimCommand,
  confirmSceneCommand,
  decideScenePhrase,
  deleteFactCommand,
  deleteSceneCommand,
  judgeSceneCommand,
  saveFact,
  saveScene,
  setFactConfirmed,
  setSceneRubricClosed,
  unconfirmSceneCommand,
} from "./record-commands";
import { insertRecordClaims, listRecordClaims } from "./record-claims-repo";
import type { JobInput } from "./record-input";
import { createScene, getScene } from "./scenes-repo";

let db: Db;

const OFF = "아직 열리지 않은 기능입니다";
const school = { schoolName: "한국대학교", location: "서울", degree: "bachelor", major: "컴퓨터공학", startMonth: "2015-03", endMonth: "2019-02", status: "graduated", gpa: null, gpaScale: null };
const job: JobInput = {
  company: "가나다 주식회사",
  department: null,
  title: null,
  employment: "regular",
  startMonth: "2022-01",
  endMonth: "2023-12",
  isOngoing: false,
  duties: ["주간 보고서 30건 작성 주도"],
  bannedPhrases: [],
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

beforeEach(async () => {
  vi.stubEnv("NEW_RECORDS", "1");
  db = await createTestDb();
  await db.insert(user).values([
    { id: "u1", name: "A", email: "u1@example.com" },
    { id: "u2", name: "B", email: "u2@example.com" },
  ]);
});
afterEach(() => vi.unstubAllEnvs());

test("스위치가 꺼져 있으면 저장하지 않고 안내한다", async () => {
  vi.stubEnv("NEW_RECORDS", "");
  const result = await saveFact(db, "u1", "education", null, school, {});
  expect(result).toEqual({ ok: false, errors: {}, message: OFF });
  expect(await deleteFactCommand(db, "u1", "education", "x")).toEqual({ ok: false, message: OFF });
  expect(await setFactConfirmed(db, "u1", "education", "x", true)).toEqual({ ok: false, message: OFF });
  expect(await answerClaimCommand(db, "u1", "x", "confirm")).toEqual({ ok: false, message: OFF });
  vi.stubEnv("NEW_RECORDS", "1");
  const { listFacts } = await import("./facts-repo");
  expect((await listFacts(db, "u1")).education).toEqual([]);
});

test("잘못된 입력은 칸별 오류, 알 수 없는 종류는 찾을 수 없음", async () => {
  const bad = await saveFact(db, "u1", "education", null, { ...school, schoolName: "" }, {});
  expect(bad.ok).toBe(false);
  if (!bad.ok) expect(bad.errors.schoolName).toBeTruthy();
  expect(await saveFact(db, "u1", "nope" as never, null, school, {})).toEqual({ ok: false, errors: {}, message: "기록을 찾을 수 없습니다" });
});

test("올바른 입력은 저장되고 범위도 저장된다. 고치면 같은 id", async () => {
  const t = await createTrack(db, "u1", survey);
  if (!t.ok) throw new Error(t.reason);
  const saved = await saveFact(db, "u1", "education", null, school, { [t.id]: "summary" });
  expect(saved.ok).toBe(true);
  if (!saved.ok) return;
  const fact = await getFact(db, "u1", "education", saved.id);
  expect(fact?.value.schoolName).toBe("한국대학교");
  expect(fact?.trackScopes).toEqual({ [t.id]: "summary" });
  const again = await saveFact(db, "u1", "education", saved.id, { ...school, major: "수학" }, {});
  expect(again).toEqual({ ok: true, id: saved.id });
  expect((await getFact(db, "u1", "education", saved.id))?.value.major).toBe("수학");
  expect(await saveFact(db, "u2", "education", saved.id, school, {})).toEqual({ ok: false, errors: {}, message: "기록을 찾을 수 없습니다" });
  expect(await saveFact(db, "u1", "education", null, school, "bad")).toMatchObject({ ok: false, message: "트랙별 사용 범위를 다시 골라 주세요" });
});

test("없는 소속의 프로젝트는 소속을 찾을 수 없음", async () => {
  const result = await saveFact(db, "u1", "project", null, { name: "p", parent: { kind: "job", id: "none" }, startMonth: null, endMonth: null, isOngoing: false, role: null, tools: [], summary: null, bannedPhrases: [] }, {});
  expect(result).toEqual({ ok: false, errors: {}, message: "소속을 찾을 수 없습니다" });
});

test("장면이 달린 경력은 지울 수 없다", async () => {
  const j = await createFact(db, "u1", "job", job);
  if (!j.ok) throw new Error();
  const s = await createScene(db, "u1", { head: { kind: "job", id: j.id }, title: "장면", startMonth: null, endMonth: null, isOngoing: false, situation: null, judgment: null, actions: null, result: null, lessons: null, metrics: [], notDone: null, bannedPhrases: [], evidenceNote: null, tags: [] });
  expect(s.ok).toBe(true);
  expect(await deleteFactCommand(db, "u1", "job", j.id)).toEqual({ ok: false, message: "장면 1개가 있습니다. 장면을 먼저 지우거나 다른 곳으로 옮겨 주세요" });
  expect(await getFact(db, "u1", "job", j.id)).not.toBeNull();
  const e = await createFact(db, "u1", "education", school as never);
  if (!e.ok) throw new Error();
  expect(await deleteFactCommand(db, "u1", "education", e.id)).toEqual({ ok: true });
  expect(await deleteFactCommand(db, "u1", "education", e.id)).toEqual({ ok: false, message: "기록을 찾을 수 없습니다" });
});

test("열린 줄이 남은 경력은 맞음 불가, 줄에 답하면 가능, 고치기로 확인을 풀 수 있다", async () => {
  const j = await createFact(db, "u1", "job", job, { source: "import" });
  if (!j.ok) throw new Error();
  await insertRecordClaims(db, "u1", { kind: "job", id: j.id }, findClaims(subjectOfJob(job)));
  expect(await setFactConfirmed(db, "u1", "job", j.id, true)).toEqual({ ok: false, message: "줄 확인이 남아 있습니다" });
  const claims = await listRecordClaims(db, "u1", { kind: "job", id: j.id });
  for (const c of claims) expect(await answerClaimCommand(db, "u1", c.id, "confirm")).toEqual({ ok: true });
  expect(await setFactConfirmed(db, "u1", "job", j.id, true)).toEqual({ ok: true });
  expect((await getFact(db, "u1", "job", j.id))?.isConfirmed).toBe(true);
  expect(await setFactConfirmed(db, "u1", "job", j.id, false)).toEqual({ ok: true });
  expect(await answerClaimCommand(db, "u1", claims[0].id, "unknown")).toEqual({ ok: false, message: "이 줄에는 그 답을 할 수 없습니다" });
  expect(await answerClaimCommand(db, "u2", claims[0].id, "confirm")).toEqual({ ok: false, message: "기록을 찾을 수 없습니다" });
});

// ---- 장면 ----
const sceneIn = (head: { kind: "job" | "project" | "activity"; id: string }, over: Record<string, unknown> = {}) => ({
  head, title: "결제 장애 대응", startMonth: null, endMonth: null, isOngoing: false, situation: "장애가 잦았다", judgment: null,
  actions: "승인 API를 다시 설계했다", result: null, lessons: null, metrics: [], notDone: null, bannedPhrases: [], evidenceNote: null, tags: [], ...over,
});
const met = { status: "met", note: "" };
const allMet = { role: met, level: met, metrics: met, evidence: met, phraseCandidates: ["혼자 구축"] };
async function jobWithScene(over: Record<string, unknown> = {}, source: "manual" | "import" = "manual") {
  const j = await createFact(db, "u1", "job", job, { source });
  if (!j.ok) throw new Error();
  const s = await saveScene(db, createFakeAi([]), "u1", null, sceneIn({ kind: "job", id: j.id }, over), {});
  if (!s.ok) throw new Error(JSON.stringify(s));
  return { jobId: j.id, sceneId: s.id };
}

test("장면: 스위치가 꺼져 있으면 모든 장면 명령이 거절된다", async () => {
  vi.stubEnv("NEW_RECORDS", "");
  const ai = createFakeAi([]);
  expect(await saveScene(db, ai, "u1", null, sceneIn({ kind: "job", id: "x" }), {})).toEqual({ ok: false, errors: {}, message: OFF });
  expect(await deleteSceneCommand(db, "u1", "x")).toEqual({ ok: false, message: OFF });
  expect(await confirmSceneCommand(db, "u1", "x", true)).toEqual({ ok: false, message: OFF });
  expect(await unconfirmSceneCommand(db, "u1", "x")).toEqual({ ok: false, message: OFF });
  expect(await judgeSceneCommand(db, ai, "u1", "x")).toEqual({ ok: false, message: OFF });
  expect(await setSceneRubricClosed(db, "u1", "x", "metrics", true)).toEqual({ ok: false, message: OFF });
  expect(await decideScenePhrase(db, "u1", "x", "p", true)).toEqual({ ok: false, message: OFF });
  expect(ai.requests).toHaveLength(0);
});

test("장면: 저장 검사, 남의 머리, 고치기, 범위", async () => {
  const { jobId, sceneId } = await jobWithScene();
  const ai = createFakeAi([]);
  const bad = await saveScene(db, ai, "u1", null, sceneIn({ kind: "job", id: jobId }, { title: "" }), {});
  expect(bad.ok).toBe(false);
  if (!bad.ok) expect(bad.errors.title).toBeTruthy();
  expect(await saveScene(db, ai, "u2", null, sceneIn({ kind: "job", id: jobId }), {})).toEqual({
    ok: false, errors: {}, message: "회사·프로젝트·활동을 찾을 수 없습니다",
  });
  expect(await saveScene(db, ai, "u2", sceneId, sceneIn({ kind: "job", id: jobId }), {})).toEqual({
    ok: false, errors: {}, message: "기록을 찾을 수 없습니다",
  });
  expect(await saveScene(db, ai, "u1", null, sceneIn({ kind: "job", id: jobId }), "bad")).toMatchObject({ ok: false, message: "트랙별 사용 범위를 다시 골라 주세요" });
  const t = await createTrack(db, "u1", survey);
  if (!t.ok) throw new Error(t.reason);
  expect(await saveScene(db, ai, "u1", sceneId, sceneIn({ kind: "job", id: jobId }, { title: "새 제목" }), { [t.id]: "summary" })).toEqual({ ok: true, id: sceneId });
  const got = await getScene(db, "u1", sceneId);
  expect(got?.title).toBe("새 제목");
  expect(got?.trackScopes).toEqual({ [t.id]: "summary" });
  expect(ai.requests).toHaveLength(0);
});

test("장면: 인터뷰로 만든 초안은 인터뷰를 끝내고 판정을 한 번 돌린다. 판정이 실패해도 저장된다", async () => {
  const j = await createFact(db, "u1", "job", job);
  if (!j.ok) throw new Error();
  const ai = createFakeAi([allMet]);
  const saved = await saveScene(db, ai, "u1", null, sceneIn({ kind: "job", id: j.id }), {}, "iv1");
  expect(saved.ok).toBe(true);
  expect(ai.requests).toHaveLength(1);
  if (!saved.ok) return;
  expect((await getScene(db, "u1", saved.id))?.judgedAt).not.toBeNull();
  const failing = createFakeAi([{ fail: "unavailable" }]);
  const again = await saveScene(db, failing, "u1", null, sceneIn({ kind: "job", id: j.id }, { title: "둘째" }), {}, "iv2");
  expect(again.ok).toBe(true);
  expect(failing.requests).toHaveLength(1);
});

test("장면: 머리까지 확인, 머리에 열린 줄이 있으면 둘 다 미확인", async () => {
  const ok = await jobWithScene();
  expect(await confirmSceneCommand(db, "u1", ok.sceneId, true)).toEqual({ ok: true });
  expect((await getScene(db, "u1", ok.sceneId))?.isConfirmed).toBe(true);
  expect((await getFact(db, "u1", "job", ok.jobId))?.isConfirmed).toBe(true);

  const open = await jobWithScene({}, "import");
  await insertRecordClaims(db, "u1", { kind: "job", id: open.jobId }, findClaims(subjectOfJob(job)));
  expect(await confirmSceneCommand(db, "u1", open.sceneId, true)).toEqual({ ok: false, message: "회사 정보에 줄 확인이 남아 있습니다" });
  expect((await getScene(db, "u1", open.sceneId))?.isConfirmed).toBe(false);
  expect((await getFact(db, "u1", "job", open.jobId))?.isConfirmed).toBe(false);
  // 장면만 확인하는 것은 된다
  expect(await confirmSceneCommand(db, "u1", open.sceneId, false)).toEqual({ ok: true });
  expect(await unconfirmSceneCommand(db, "u1", open.sceneId)).toEqual({ ok: true });
  expect((await getScene(db, "u1", open.sceneId))?.isConfirmed).toBe(false);
  expect(await confirmSceneCommand(db, "u2", open.sceneId, false)).toEqual({ ok: false, message: "기록을 찾을 수 없습니다" });
});

test("장면: 판정, 닫기, 후보 결정, 지우기", async () => {
  const { sceneId } = await jobWithScene();
  const ai = createFakeAi([allMet, { fail: "over_limit" }]);
  expect(await judgeSceneCommand(db, ai, "u1", sceneId)).toEqual({ ok: true });
  expect((await getScene(db, "u1", sceneId))?.phraseCandidates).toEqual(["혼자 구축"]);
  expect(await judgeSceneCommand(db, ai, "u1", sceneId)).toEqual({ ok: false, message: "이번 달 AI 사용 한도에 닿았습니다. 다음 달에 다시 쓸 수 있습니다" });
  expect(await judgeSceneCommand(db, ai, "u2", sceneId)).toEqual({ ok: false, message: "기록을 찾을 수 없습니다" });

  expect(await setSceneRubricClosed(db, "u1", sceneId, "metrics", true)).toEqual({ ok: true });
  expect((await getScene(db, "u1", sceneId))?.rubric.metrics.status).toBe("closed");
  expect(await setSceneRubricClosed(db, "u1", sceneId, "role", true)).toEqual({ ok: false, message: "이 항목은 닫을 수 없습니다" });
  expect(await setSceneRubricClosed(db, "u1", sceneId, "metrics", false)).toEqual({ ok: true });

  expect(await decideScenePhrase(db, "u1", sceneId, "혼자 구축", true)).toEqual({ ok: true });
  expect((await getScene(db, "u1", sceneId))?.bannedPhrases).toEqual(["혼자 구축"]);
  expect(await decideScenePhrase(db, "u1", sceneId, "없는 표현", false)).toEqual({ ok: false, message: "후보를 찾을 수 없습니다" });

  expect(await deleteSceneCommand(db, "u2", sceneId)).toEqual({ ok: false, message: "기록을 찾을 수 없습니다" });
  expect(await deleteSceneCommand(db, "u1", sceneId)).toEqual({ ok: true });
  expect(await getScene(db, "u1", sceneId)).toBeNull();
});
