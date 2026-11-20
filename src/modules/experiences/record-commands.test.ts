import { beforeEach, afterEach, expect, test, vi } from "vitest";
import { createTestDb } from "@/db/test-db";
import type { Db } from "@/db/types";
import { user } from "@/modules/auth/schema";
import { createTrack } from "@/modules/tracks/repo";
import type { SurveyInput } from "@/modules/tracks/survey";
import { findClaims, subjectOfJob } from "./claims";
import { createFact, getFact } from "./facts-repo";
import { createFakeAi } from "@/modules/ai/fake-client";
import { getInterview } from "./interview";
import { startSceneInterview } from "./scene-interview";
import {
  answerClaimCommand,
  confirmSceneCommand,
  answerSceneInterviewCommand,
  decideScenePhrase,
  deleteFactCommand,
  draftSceneCommand,
  importRecordsCommand,
  deleteSceneCommand,
  judgeSceneCommand,
  saveFact,
  saveScene,
  setFactConfirmed,
  setSceneRubricClosed,
  startSceneInterviewCommand,
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
  expect(await deleteFactCommand(db, "u1", "job", j.id)).toEqual({ ok: false, message: "사례 1개가 있습니다. 사례를 먼저 지우거나 다른 곳으로 옮겨 주세요" });
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
const q = (message: string, enough = false) => ({ message, enough });
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
  const iv1 = await startSceneInterview(db, createFakeAi([q("?")]), "u1", { head: { kind: "job", id: j.id } });
  const iv2 = await startSceneInterview(db, createFakeAi([q("?")]), "u1", { head: { kind: "job", id: j.id } });
  if (!iv1.ok || !iv2.ok) throw new Error();
  const ai = createFakeAi([allMet]);
  const saved = await saveScene(db, ai, "u1", null, sceneIn({ kind: "job", id: j.id }), {}, iv1.id);
  expect(saved.ok).toBe(true);
  expect(ai.requests).toHaveLength(1);
  if (!saved.ok) return;
  const got = await getScene(db, "u1", saved.id);
  expect(got?.judgedAt).not.toBeNull();
  expect(got?.source).toBe("interview");
  expect((await getInterview(db, "u1", iv1.id))?.status).toBe("done");
  const failing = createFakeAi([{ fail: "unavailable" }]);
  const again = await saveScene(db, failing, "u1", null, sceneIn({ kind: "job", id: j.id }, { title: "둘째" }), {}, iv2.id);
  expect(again.ok).toBe(true);
  expect(failing.requests).toHaveLength(1);
});

test("장면: 없는 인터뷰나 빈 인터뷰 id면 판정하지 않고 출처도 인터뷰로 두지 않는다", async () => {
  const j = await createFact(db, "u1", "job", job);
  if (!j.ok) throw new Error();
  const ai = createFakeAi([]);
  for (const interviewId of ["none", ""]) {
    const saved = await saveScene(db, ai, "u1", null, sceneIn({ kind: "job", id: j.id }), {}, interviewId);
    expect(saved.ok).toBe(true);
    if (saved.ok) expect((await getScene(db, "u1", saved.id))?.source).toBe("manual");
  }
  // 남의 인터뷰도 없는 것과 같다
  const theirs = await createFact(db, "u2", "job", job);
  if (!theirs.ok) throw new Error();
  const iv = await startSceneInterview(db, createFakeAi([q("?")]), "u2", { head: { kind: "job", id: theirs.id } });
  if (!iv.ok) throw new Error();
  const saved = await saveScene(db, ai, "u1", null, sceneIn({ kind: "job", id: j.id }), {}, iv.id);
  if (saved.ok) expect((await getScene(db, "u1", saved.id))?.source).toBe("manual");
  expect((await getInterview(db, "u2", iv.id))?.status).toBe("active");
  expect(ai.requests).toHaveLength(0);
});

test("장면: 프로젝트 머리에 열린 줄이 있으면 프로젝트 정보라고 알린다", async () => {
  const p = await createFact(
    db, "u1", "project",
    { name: "리뉴얼", parent: null, startMonth: null, endMonth: null, isOngoing: false, role: null, tools: [], summary: "TF를 주도했다", bannedPhrases: [] },
    { source: "import" },
  );
  if (!p.ok) throw new Error();
  await insertRecordClaims(db, "u1", { kind: "project", id: p.id }, [{ kind: "role", quote: "TF를 주도했다", phrase: "주도", origin: "code" }]);
  const s = await saveScene(db, createFakeAi([]), "u1", null, sceneIn({ kind: "project", id: p.id }), {});
  if (!s.ok) throw new Error();
  expect(await confirmSceneCommand(db, "u1", s.id, true)).toEqual({ ok: false, message: "프로젝트 정보에 줄 확인이 남아 있습니다" });
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

// ---- 사례 인터뷰와 가져오기 ----
const draftAnswer = {
  title: "결제 장애 대응", startMonth: "", endMonth: "", isOngoing: false, situation: "장애가 잦았다", judgment: "",
  actions: "로그를 모아 원인을 찾았다", result: "", lessons: "", metrics: [], notDone: "", evidenceNote: "", tags: [],
};

test("사례 인터뷰: 스위치, 머리 고르기, 답, 정리", async () => {
  vi.stubEnv("NEW_RECORDS", "");
  const off = createFakeAi([]);
  expect(await startSceneInterviewCommand(db, off, "u1", { head: "job:x" })).toEqual({ ok: false, message: OFF });
  expect(await answerSceneInterviewCommand(db, off, "u1", "x", "답")).toEqual({ ok: false, message: OFF });
  expect(await draftSceneCommand(db, off, "u1", "x")).toEqual({ ok: false, message: OFF });
  expect(await importRecordsCommand(db, off, "u1", { text: "글" })).toEqual({ ok: false, message: OFF });
  vi.stubEnv("NEW_RECORDS", "1");

  const j = await createFact(db, "u1", "job", job);
  if (!j.ok) throw new Error();
  const none = createFakeAi([]);
  expect(await startSceneInterviewCommand(db, none, "u1", {})).toEqual({ ok: false, message: "사례를 붙일 회사·프로젝트·활동을 골라 주세요" });
  expect(await startSceneInterviewCommand(db, none, "u2", { head: `job:${j.id}` })).toEqual({ ok: false, message: "기록을 찾을 수 없습니다" });
  expect(await startSceneInterviewCommand(db, none, "u1", { head: "school:1" })).toEqual({ ok: false, message: "사례를 붙일 회사·프로젝트·활동을 골라 주세요" });
  expect(none.requests).toHaveLength(0);

  const started = await startSceneInterviewCommand(db, createFakeAi([q("어떤 일이었나요?")]), "u1", { head: `job:${j.id}` });
  expect(started.ok).toBe(true);
  if (!started.ok) return;
  expect(await draftSceneCommand(db, createFakeAi([]), "u1", started.id)).toEqual({ ok: false, message: "아직 답한 내용이 없습니다" });
  expect(await answerSceneInterviewCommand(db, createFakeAi([q("결과는요?", true)]), "u1", started.id, "장애 원인을 찾았어요")).toEqual({
    ok: true, message: "결과는요?", suggestFinish: true,
  });
  expect(await answerSceneInterviewCommand(db, createFakeAi([]), "u1", started.id, " ")).toEqual({ ok: false, message: "답을 입력해 주세요 (4,000자까지)" });
  const drafted = await draftSceneCommand(db, createFakeAi([draftAnswer]), "u1", started.id);
  expect(drafted).toMatchObject({ ok: true, sceneId: null, draft: { head: { kind: "job", id: j.id }, title: "결제 장애 대응" } });
  expect(await draftSceneCommand(db, createFakeAi([{ fail: "over_limit" }]), "u1", started.id)).toEqual({
    ok: false, message: "이번 달 AI 사용 한도에 닿았습니다. 다음 달에 다시 쓸 수 있습니다",
  });
});

test("사례 인터뷰: 보완 인터뷰는 장면 id를 돌려준다", async () => {
  const { sceneId } = await jobWithScene();
  const started = await startSceneInterviewCommand(db, createFakeAi([q("?")]), "u1", { sceneId });
  if (!started.ok) throw new Error(started.message);
  await answerSceneInterviewCommand(db, createFakeAi([q("?")]), "u1", started.id, "실제로는 둘이 했어요");
  expect(await draftSceneCommand(db, createFakeAi([draftAnswer]), "u1", started.id)).toMatchObject({ ok: true, sceneId });
  expect(await startSceneInterviewCommand(db, createFakeAi([]), "u2", { sceneId })).toEqual({ ok: false, message: "기록을 찾을 수 없습니다" });
});

test("새 가져오기: 빈 글, 성공, 한도", async () => {
  const ai = createFakeAi([]);
  expect(await importRecordsCommand(db, ai, "u1", { text: "  " })).toEqual({ ok: false, message: "가져올 글을 붙여 넣거나 파일을 골라 주세요" });
  expect(await importRecordsCommand(db, ai, "u1", { text: "글", file: { name: "a.exe", bytes: new Uint8Array([1]) } })).toEqual({
    ok: false, message: "지원하지 않는 파일입니다. PDF, 워드(.docx), 글 파일(.md, .txt, .csv)만 올릴 수 있습니다",
  });
  const answer = {
    education: [], courses: [], gaps: [], projects: [], activities: [], more: false,
    credentials: [{ type: "license", name: "정보처리기사", issuer: "", month: "", score: "" }],
    jobs: [],
  };
  const ok = await importRecordsCommand(db, createFakeAi([answer]), "u1", { text: "정보처리기사" });
  expect(ok).toMatchObject({ ok: true, skipped: 0, more: false, created: [{ kind: "credential", name: "정보처리기사" }] });
  const limit = await importRecordsCommand(db, createFakeAi([{ fail: "over_limit" }]), "u1", { text: "정보처리기사" });
  expect(limit).toMatchObject({ ok: false, stop: true });
  const empty = await importRecordsCommand(db, createFakeAi([{ ...answer, credentials: [] }]), "u1", { text: "안녕하세요" });
  expect(empty).toMatchObject({ ok: false, empty: true });
});
