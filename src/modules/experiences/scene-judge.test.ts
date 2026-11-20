import { beforeEach, expect, test } from "vitest";
import { createTestDb } from "@/db/test-db";
import type { Db } from "@/db/types";
import { createFakeAi } from "@/modules/ai/fake-client";
import { user } from "@/modules/auth/schema";
import { createFact } from "./facts-repo";
import type { JobInput, SceneInput } from "./record-input";
import { approveScenePhrase, dismissScenePhrase, judgeScene, listSceneEvidenceTodos } from "./scene-judge";
import { closeSceneRubricItem, confirmScene, createScene, getScene, updateScene } from "./scenes-repo";

let db: Db;
let jobId: string;
const now = new Date("2026-11-17T03:00:00Z");

const job: JobInput = {
  company: "가나다 주식회사",
  department: "결제팀",
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
  situation: "장애가 잦았다. 담당자 연락처 010-1234-5678",
  judgment: "원인을 먼저 가렸다",
  actions: "승인 API를 다시 설계했다",
  result: "장애가 줄었다",
  lessons: null,
  metrics: [{ text: "월 장애 5건에서 1건", basis: "사내 장애 보고서" }],
  notDone: "프론트엔드는 하지 않았다",
  bannedPhrases: ["혼자 구축"],
  evidenceNote: "보고서는 공유 드라이브에 있음",
  tags: [],
  ...over,
});
const met = { status: "met", note: "" };
const allMet = { role: met, level: met, metrics: met, evidence: met, phraseCandidates: [] as string[] };
const mixed = {
  role: met,
  level: { status: "unmet", note: "어디까지 직접 했는지 알려 주세요" },
  metrics: met,
  evidence: { status: "unmet", note: "장애 보고서가 어디에 있는지 적어 주세요" },
  phraseCandidates: ["혼자 구축", "풀스택 개발", " 풀스택 개발 ", "전체 설계"],
};

async function make(userId = "u1", over: Partial<SceneInput> = {}) {
  const r = await createScene(db, userId, scene({ kind: "job", id: jobId }, over));
  if (!r.ok) throw new Error(r.reason);
  return r.id;
}

beforeEach(async () => {
  delete process.env.AI_MONTHLY_LIMIT_USD;
  db = await createTestDb();
  await db.insert(user).values([
    { id: "u1", name: "홍길동", email: "u1@example.com" },
    { id: "u2", name: "B", email: "u2@example.com" },
  ]);
  const a = await createFact(db, "u1", "job", job);
  if (!a.ok) throw new Error("job");
  jobId = a.id;
});

test("판정이 역할·수준에 반영되고 judgedAt이 차며 본인 확인은 바뀌지 않는다", async () => {
  const id = await make();
  expect(await judgeScene(db, createFakeAi([mixed]), "u1", id, now)).toEqual({ ok: true });
  const found = await getScene(db, "u1", id);
  expect(found?.rubric).toEqual({
    period: { status: "met", note: null },
    role: { status: "met", note: null },
    level: { status: "unmet", note: "어디까지 직접 했는지 알려 주세요" },
    metrics: { status: "met", note: null },
    evidence: { status: "unmet", note: "장애 보고서가 어디에 있는지 적어 주세요" },
  });
  expect(found?.judgedAt).toEqual(now);
  expect(found?.isConfirmed).toBe(false);
});

test("이미 확인한 장면은 판정해도 확인이 유지된다", async () => {
  const id = await make();
  await confirmScene(db, "u1", id);
  await judgeScene(db, createFakeAi([allMet]), "u1", id, now);
  expect((await getScene(db, "u1", id))?.state).toBe("confirmed");
});

test("닫은 항목은 AI가 뭐라고 하든 그대로이고 기간은 건드리지 않는다", async () => {
  const id = await make();
  await closeSceneRubricItem(db, "u1", id, "metrics");
  const unmet = { status: "unmet", note: "보완 필요" };
  await judgeScene(db, createFakeAi([{ role: unmet, level: met, metrics: unmet, evidence: met, phraseCandidates: [] }]), "u1", id, now);
  const rubric = (await getScene(db, "u1", id))?.rubric;
  expect(rubric?.metrics.status).toBe("closed");
  expect(rubric?.role.status).toBe("unmet");
  expect(rubric?.period.status).toBe("met");
});

test("판정하는 사이 내용을 고치면 changed이고 아무것도 반영되지 않는다", async () => {
  const id = await make();
  const ai = createFakeAi([
    async () => {
      await updateScene(db, "u1", id, scene({ kind: "job", id: jobId }, { actions: "전혀 다른 내용" }));
      return allMet;
    },
  ]);
  expect(await judgeScene(db, ai, "u1", id, now)).toEqual({ ok: false, reason: "changed" });
  const found = await getScene(db, "u1", id);
  expect(found?.rubric.role.status).toBe("unjudged");
  expect(found?.judgedAt).toBeNull();
});

test("다른 사용자의 장면은 not_found이고 AI를 부르지 않는다", async () => {
  const id = await make();
  const ai = createFakeAi([allMet]);
  expect(await judgeScene(db, ai, "u2", id, now)).toEqual({ ok: false, reason: "not_found" });
  expect(ai.requests).toHaveLength(0);
});

test("보낸 글에 머리의 회사 이름과 장면 내용이 있고 증빙 메모도 있으며 금지 표현·연락처·사용자 정보는 없다", async () => {
  const id = await make();
  const ai = createFakeAi([allMet]);
  await judgeScene(db, ai, "u1", id, now);
  const sent = JSON.stringify(ai.requests[0]);
  expect(ai.requests[0].purpose).toBe("judge");
  expect(sent).toContain("가나다 주식회사");
  expect(sent).toContain("결제팀");
  expect(sent).toContain("2022-03 ~ 2024-08");
  expect(sent).toContain("승인 API를 다시 설계했다");
  expect(sent).toContain("원인을 먼저 가렸다");
  expect(sent).toContain("증빙·확인 메모");
  expect(sent).toContain("공유 드라이브");
  expect(sent).not.toContain("혼자 구축");
  expect(sent).not.toContain("010-1234-5678");
  expect(sent).not.toContain("u1@example.com");
  expect(sent).not.toContain(id);
});

test("후보는 공백을 지우고 중복·금지된 것·거절한 것을 빼고 저장한다", async () => {
  const id = await make();
  await judgeScene(db, createFakeAi([mixed]), "u1", id, now);
  expect((await getScene(db, "u1", id))?.phraseCandidates).toEqual(["풀스택 개발", "전체 설계"]);
  expect(await dismissScenePhrase(db, "u1", id, "전체 설계")).toEqual({ ok: true });
  await judgeScene(db, createFakeAi([mixed]), "u1", id, now);
  expect((await getScene(db, "u1", id))?.phraseCandidates).toEqual(["풀스택 개발"]);
});

test("후보를 승인하면 금지 목록으로 옮겨지고 확인은 유지된다", async () => {
  const id = await make();
  await judgeScene(db, createFakeAi([mixed]), "u1", id, now);
  await confirmScene(db, "u1", id);
  expect(await approveScenePhrase(db, "u1", id, "풀스택 개발")).toEqual({ ok: true });
  const found = await getScene(db, "u1", id);
  expect(found?.bannedPhrases).toEqual(["혼자 구축", "풀스택 개발"]);
  expect(found?.phraseCandidates).toEqual(["전체 설계"]);
  expect(found?.isConfirmed).toBe(true);
  expect(await approveScenePhrase(db, "u1", id, "없는 후보")).toEqual({ ok: false, reason: "not_found" });
  expect(await approveScenePhrase(db, "u2", id, "전체 설계")).toEqual({ ok: false, reason: "not_found" });
  expect(await dismissScenePhrase(db, "u2", id, "전체 설계")).toEqual({ ok: false, reason: "not_found" });
});

test("증빙 할 일은 본인의 증빙 미달 장면만 보완 방안과 함께 준다", async () => {
  const a = await make();
  await judgeScene(db, createFakeAi([mixed]), "u1", a, now);
  const b = await make("u1", { title: "다른 장면" });
  await judgeScene(db, createFakeAi([allMet]), "u1", b, now);
  expect(await listSceneEvidenceTodos(db, "u1")).toEqual([
    { id: a, name: "결제 장애 대응", note: "장애 보고서가 어디에 있는지 적어 주세요" },
  ]);
  expect(await listSceneEvidenceTodos(db, "u2")).toEqual([]);
});
