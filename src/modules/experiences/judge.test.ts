import { beforeEach, expect, test } from "vitest";
import { createTestDb } from "@/db/test-db";
import type { Db } from "@/db/types";
import { createFakeAi } from "@/modules/ai/fake-client";
import { aiUsage } from "@/modules/ai/schema";
import { user } from "@/modules/auth/schema";
import type { ExperienceInput } from "./input";
import { approvePhrase, dismissPhrase, judgeExperience, listEvidenceTodos } from "./judge";
import { closeRubricItem, confirmExperience, createExperience, getExperience, updateExperience } from "./repo";

let db: Db;
const now = new Date("2026-11-17T03:00:00Z");

const job: ExperienceInput = {
  name: "결제 시스템 개편",
  kind: "project",
  organization: "가나다 주식회사",
  role: "백엔드 개발",
  startMonth: "2023-03",
  endMonth: "2023-11",
  isOngoing: false,
  situation: "장애가 잦았다. 담당자 연락처 010-1234-5678",
  actions: "결제 승인 API를 다시 설계했다",
  result: "장애가 줄었다",
  metrics: [{ text: "월 장애 5건에서 1건", basis: "사내 장애 보고서" }],
  notDone: "프론트엔드는 하지 않았다",
  bannedPhrases: ["혼자 구축"],
  evidenceNote: null,
  tags: [],
};
const school: ExperienceInput = { ...job, name: "한국대", kind: "school", startMonth: "2015-03", endMonth: "2019-02", metrics: [] };

const met = { status: "met", note: "" };
const allMet = { role: met, level: met, metrics: met, evidence: met, phraseCandidates: [] as string[] };
const mixed = {
  role: met,
  level: { status: "unmet", note: "어디까지 직접 했는지 알려 주세요" },
  metrics: met,
  evidence: { status: "unmet", note: "장애 보고서가 어디에 있는지 적어 주세요" },
  phraseCandidates: ["혼자 구축", "풀스택 개발", " 풀스택 개발 ", "전체 설계"],
};

beforeEach(async () => {
  delete process.env.AI_MONTHLY_LIMIT_USD;
  db = await createTestDb();
  await db.insert(user).values([
    { id: "u1", name: "홍길동", email: "u1@example.com" },
    { id: "u2", name: "B", email: "u2@example.com" },
  ]);
});

test("판정이 항목 상태와 보완 방안으로 저장되고, 본인 확인은 바뀌지 않는다", async () => {
  const id = await createExperience(db, "u1", job);
  expect(await judgeExperience(db, createFakeAi([mixed]), "u1", id, now)).toEqual({ ok: true });
  const found = await getExperience(db, "u1", id);
  expect(found?.rubric).toEqual({
    period: { status: "met", note: null },
    role: { status: "met", note: null },
    level: { status: "unmet", note: "어디까지 직접 했는지 알려 주세요" },
    metrics: { status: "met", note: null },
    evidence: { status: "unmet", note: "장애 보고서가 어디에 있는지 적어 주세요" },
  });
  expect(found?.judgedAt).toEqual(now);
  expect(found?.state).toBe("unconfirmed");
});

test("본인 역할과 수준이 충족으로 판정된 기록을 확인하면 확인됨이 된다", async () => {
  const id = await createExperience(db, "u1", job);
  await judgeExperience(db, createFakeAi([{ ...allMet, evidence: { status: "unmet", note: "자료 필요" } }]), "u1", id, now);
  await confirmExperience(db, "u1", id);
  expect((await getExperience(db, "u1", id))?.state).toBe("confirmed");
});

test("판정은 이미 한 본인 확인을 풀지 않는다", async () => {
  const id = await createExperience(db, "u1", job);
  await confirmExperience(db, "u1", id);
  await judgeExperience(db, createFakeAi([allMet]), "u1", id, now);
  expect((await getExperience(db, "u1", id))?.state).toBe("confirmed");
});

test("닫은 항목과 적용하지 않는 항목은 AI가 뭐라고 하든 그대로이고, 기간은 건드리지 않는다", async () => {
  const id = await createExperience(db, "u1", { ...school, endMonth: null });
  await closeRubricItem(db, "u1", id, "metrics");
  const unmet = { status: "unmet", note: "보완 필요" };
  await judgeExperience(db, createFakeAi([{ role: unmet, level: unmet, metrics: unmet, evidence: met, phraseCandidates: [] }]), "u1", id, now);
  const rubric = (await getExperience(db, "u1", id))?.rubric;
  expect(rubric?.role.status).toBe("na");
  expect(rubric?.level.status).toBe("na");
  expect(rubric?.metrics.status).toBe("closed");
  expect(rubric?.evidence.status).toBe("met");
  expect(rubric?.period.status).toBe("unmet");
});

test("판정을 기다리는 사이 내용이 바뀌면 changed이고 아무것도 반영되지 않는다", async () => {
  const id = await createExperience(db, "u1", job);
  const ai = createFakeAi([
    async () => {
      // AI가 답하기 전에 사용자가 내용을 고쳤다
      await updateExperience(db, "u1", id, { ...job, actions: "전혀 다른 내용" });
      return allMet;
    },
  ]);
  expect(await judgeExperience(db, ai, "u1", id, now)).toEqual({ ok: false, reason: "changed" });
  const found = await getExperience(db, "u1", id);
  expect(found?.rubric.role.status).toBe("unjudged");
  expect(found?.judgedAt).toBeNull();
});

test("다른 사용자의 기록은 not_found이고 AI를 부르지 않는다", async () => {
  const id = await createExperience(db, "u1", job);
  const ai = createFakeAi([allMet]);
  expect(await judgeExperience(db, ai, "u2", id, now)).toEqual({ ok: false, reason: "not_found" });
  expect(ai.requests).toHaveLength(0);
});

test("AI에게 보내는 글에 사용자 id·이름·이메일이 없고 기록 안의 전화번호는 가려진다", async () => {
  const id = await createExperience(db, "u1", job);
  const ai = createFakeAi([allMet]);
  await judgeExperience(db, ai, "u1", id, now);
  const sent = JSON.stringify(ai.requests[0]);
  expect(sent).not.toContain("u1@example.com");
  expect(sent).not.toContain("홍길동");
  expect(sent).not.toContain(id);
  expect(sent).not.toContain("010-1234-5678");
  expect(sent).toContain("[전화번호]");
  expect(sent).toContain("결제 승인 API를 다시 설계했다");
  expect(sent).toContain("프론트엔드는 하지 않았다");
});

test("후보는 공백을 지우고 중복·이미 금지된 것·거절한 것을 빼고 저장한다", async () => {
  const id = await createExperience(db, "u1", job);
  await judgeExperience(db, createFakeAi([mixed]), "u1", id, now);
  expect((await getExperience(db, "u1", id))?.phraseCandidates).toEqual(["풀스택 개발", "전체 설계"]);

  expect(await dismissPhrase(db, "u1", id, "전체 설계")).toEqual({ ok: true });
  await judgeExperience(db, createFakeAi([mixed]), "u1", id, now);
  expect((await getExperience(db, "u1", id))?.phraseCandidates).toEqual(["풀스택 개발"]);
});

test("후보를 승인하면 금지 목록으로 옮겨지고 본인 확인은 유지된다", async () => {
  const id = await createExperience(db, "u1", school);
  await judgeExperience(db, createFakeAi([{ ...allMet, phraseCandidates: ["수석 졸업"] }]), "u1", id, now);
  await confirmExperience(db, "u1", id);
  expect(await approvePhrase(db, "u1", id, "수석 졸업")).toEqual({ ok: true });
  const found = await getExperience(db, "u1", id);
  expect(found?.bannedPhrases).toEqual(["혼자 구축", "수석 졸업"]);
  expect(found?.phraseCandidates).toEqual([]);
  expect(found?.state).toBe("confirmed");
});

test("후보에 없는 글은 승인할 수 없고, 남의 기록의 후보는 다룰 수 없다", async () => {
  const id = await createExperience(db, "u1", job);
  await judgeExperience(db, createFakeAi([mixed]), "u1", id, now);
  expect(await approvePhrase(db, "u1", id, "내가 지어낸 표현")).toEqual({ ok: false, reason: "not_found" });
  expect(await approvePhrase(db, "u2", id, "풀스택 개발")).toEqual({ ok: false, reason: "not_found" });
  expect(await dismissPhrase(db, "u2", id, "풀스택 개발")).toEqual({ ok: false, reason: "not_found" });
  expect((await getExperience(db, "u1", id))?.bannedPhrases).toEqual(["혼자 구축"]);
});

test("한도를 넘으면 over_limit, AI가 거절하면 refused이고 기록은 바뀌지 않는다", async () => {
  const id = await createExperience(db, "u1", job);
  expect(await judgeExperience(db, createFakeAi([{ fail: "refused" }]), "u1", id, now)).toEqual({ ok: false, reason: "refused" });
  process.env.AI_MONTHLY_LIMIT_USD = "0";
  expect(await judgeExperience(db, createFakeAi([allMet]), "u1", id, now)).toEqual({ ok: false, reason: "over_limit" });
  expect((await getExperience(db, "u1", id))?.rubric.role.status).toBe("unjudged");
});

test("판정할 때마다 사용량이 judge로 기록된다", async () => {
  const id = await createExperience(db, "u1", job);
  await judgeExperience(db, createFakeAi([allMet]), "u1", id, now);
  expect((await db.select().from(aiUsage)).map((row) => row.purpose)).toEqual(["judge"]);
});

test("내용을 고치면 판정과 후보가 지워지고, 거절한 후보 목록은 남는다", async () => {
  const id = await createExperience(db, "u1", job);
  await judgeExperience(db, createFakeAi([mixed]), "u1", id, now);
  await dismissPhrase(db, "u1", id, "전체 설계");
  await updateExperience(db, "u1", id, { ...job, result: "바뀐 결과" });
  const found = await getExperience(db, "u1", id);
  expect(found?.rubric.level).toEqual({ status: "unjudged", note: null });
  expect(found?.phraseCandidates).toEqual([]);
  expect(found?.judgedAt).toBeNull();
  expect(found?.dismissedPhrases).toEqual(["전체 설계"]);
});

test("증빙 할 일은 본인의 증빙 미달 기록만 보완 방안과 함께 준다", async () => {
  const a = await createExperience(db, "u1", job);
  const b = await createExperience(db, "u1", school);
  const other = await createExperience(db, "u2", job);
  await judgeExperience(db, createFakeAi([mixed]), "u1", a, now);
  await judgeExperience(db, createFakeAi([allMet]), "u1", b, now);
  await judgeExperience(db, createFakeAi([mixed]), "u2", other, now);
  expect(await listEvidenceTodos(db, "u1")).toEqual([
    { id: a, name: "결제 시스템 개편", note: "장애 보고서가 어디에 있는지 적어 주세요" },
  ]);
});
