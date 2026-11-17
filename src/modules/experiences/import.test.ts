import { beforeEach, expect, test } from "vitest";
import { createTestDb } from "@/db/test-db";
import type { Db } from "@/db/types";
import { createFakeAi } from "@/modules/ai/fake-client";
import { aiUsage } from "@/modules/ai/schema";
import { user } from "@/modules/auth/schema";
import { listClaims } from "./claims-repo";
import { importExperiences } from "./import";
import { getExperience, listExperiences, toInput, updateExperience } from "./repo";

let db: Db;
const now = new Date("2026-11-17T03:00:00Z");

const source = `결제 시스템 개편 프로젝트 (2023.03 ~ 2023.11)
결제 승인 API 개선 프로젝트를 주도하며 핵심 역할을 수행했다. 장애가 80% 감소했다.
연락처 010-1234-5678

한국대학교 컴퓨터공학과 (2015.03 ~ 2019.02)`;

const record = (over: Record<string, unknown> = {}) => ({
  name: "결제 시스템 개편 프로젝트",
  kind: "project",
  organization: "",
  role: "",
  startMonth: "2023-03",
  endMonth: "2023-11",
  isOngoing: false,
  situation: "",
  actions: "결제 승인 API 개선 프로젝트를 주도하며 핵심 역할을 수행했다.",
  result: "장애가 80% 감소했다.",
  metrics: [],
  notDone: "",
  evidenceNote: "",
  tags: [],
  bannedPhrases: [],
  roleClaims: ["핵심 역할을 수행"],
  ...over,
});
const school = record({
  name: "한국대학교 컴퓨터공학과",
  kind: "school",
  startMonth: "2015-03",
  endMonth: "2019-02",
  actions: "",
  result: "",
  roleClaims: [],
});

beforeEach(async () => {
  delete process.env.AI_MONTHLY_LIMIT_USD;
  db = await createTestDb();
  await db.insert(user).values({ id: "u1", name: "홍길동", email: "u1@example.com" });
});

test("초안이 미확인 기록으로 저장되고, 가져온 기록으로 표시되며, 주장이 함께 만들어진다", async () => {
  const result = await importExperiences(db, createFakeAi([{ records: [record(), school], more: false }]), "u1", source, now);
  expect(result).toMatchObject({ ok: true, skipped: 0, more: false });
  if (!result.ok) return;
  expect(result.created.map((item) => item.name)).toEqual(["결제 시스템 개편 프로젝트", "한국대학교 컴퓨터공학과"]);

  const first = await getExperience(db, "u1", result.created[0].id);
  expect(first).toMatchObject({ source: "import", state: "unconfirmed", bannedPhrases: [] });
  const claims = await listClaims(db, "u1", result.created[0].id);
  expect(claims.map((claim) => [claim.kind, claim.origin, claim.quote, claim.status])).toEqual([
    ["period", "code", "2023-03 ~ 2023-11", "pending"],
    ["role", "code", "결제 승인 API 개선 프로젝트를 주도하며 핵심 역할을 수행했다.", "pending"],
    ["metric", "code", "장애가 80% 감소했다.", "pending"],
    ["role", "ai", "핵심 역할을 수행", "pending"],
  ]);
  expect(result.created[0].claimCount).toBe(4);
  expect(result.created[1].claimCount).toBe(1); // 학력은 기간만
});

test("형식이 틀린 초안은 건너뛰고 나머지는 저장한다", async () => {
  const broken = record({ name: "", startMonth: "2023-13" });
  const result = await importExperiences(db, createFakeAi([{ records: [broken, school], more: false }]), "u1", source, now);
  expect(result).toMatchObject({ ok: true, skipped: 1 });
  expect((await listExperiences(db, "u1")).map((item) => item.name)).toEqual(["한국대학교 컴퓨터공학과"]);
});

test("원본에 없던 숫자가 든 구절의 주장은 처음부터 고쳐야 할 것으로 시작한다", async () => {
  // 숫자만 비교하므로, 원본의 다른 곳에 같은 숫자가 있으면(예: 3월의 3) 잡지 못한다. 그래서 원본에 없는 7을 쓴다
  const invented = record({ result: "장애가 80% 감소했다. 처리 속도를 7배 높였다.", endMonth: "2024-01" });
  const result = await importExperiences(db, createFakeAi([{ records: [invented], more: false }]), "u1", source, now);
  if (!result.ok) throw new Error(result.reason);
  const claims = await listClaims(db, "u1", result.created[0].id);
  const status = (part: string) => claims.find((claim) => claim.quote.includes(part))?.status;
  expect(status("7배")).toBe("needs_fix");
  expect(status("2024-01")).toBe("needs_fix");
  expect(status("80%")).toBe("pending");
});

test("AI가 짚은 구절 중 초안에 없는 것은 버린다", async () => {
  const result = await importExperiences(
    db,
    createFakeAi([{ records: [record({ roleClaims: ["전사적 혁신을 이끌었다", "핵심 역할을 수행"] })], more: false }]),
    "u1",
    source,
    now,
  );
  if (!result.ok) throw new Error(result.reason);
  const ai = (await listClaims(db, "u1", result.created[0].id)).filter((claim) => claim.origin === "ai");
  expect(ai.map((claim) => claim.quote)).toEqual(["핵심 역할을 수행"]);
});

test("원본의 연락처는 가려져 전달되고, 사용자 이름과 이메일은 보내지 않으며, 사용량이 import로 기록된다", async () => {
  const ai = createFakeAi([{ records: [school], more: false }]);
  await importExperiences(db, ai, "u1", source, now);
  const sent = JSON.stringify(ai.requests[0]);
  expect(sent).not.toContain("010-1234-5678");
  expect(sent).toContain("[전화번호]");
  expect(sent).not.toContain("홍길동");
  expect(sent).not.toContain("u1@example.com");
  expect((await db.select().from(aiUsage)).map((row) => row.purpose)).toEqual(["import"]);
});

test("AI가 거절하거나 한도를 넘으면 아무것도 저장되지 않는다", async () => {
  expect(await importExperiences(db, createFakeAi([{ fail: "refused" }]), "u1", source, now)).toEqual({ ok: false, reason: "refused" });
  process.env.AI_MONTHLY_LIMIT_USD = "0";
  expect(await importExperiences(db, createFakeAi([{ records: [school], more: false }]), "u1", source, now)).toEqual({
    ok: false,
    reason: "over_limit",
  });
  expect(await listExperiences(db, "u1")).toEqual([]);
});

test("기록은 12건까지만 만들고, 더 있으면 more로 알린다", async () => {
  const many = Array.from({ length: 15 }, (_, i) => record({ name: `프로젝트 ${i + 1}`, roleClaims: [] }));
  const result = await importExperiences(db, createFakeAi([{ records: many, more: false }]), "u1", source, now);
  expect(result).toMatchObject({ ok: true, more: true });
  expect(await listExperiences(db, "u1")).toHaveLength(12);
});

test("초안이 하나도 없으면 nothing_found다", async () => {
  expect(await importExperiences(db, createFakeAi([{ records: [], more: false }]), "u1", source, now)).toEqual({
    ok: false,
    reason: "nothing_found",
  });
});

test("산출 근거에 원본에 없던 숫자가 있으면 그 근거는 버린다", async () => {
  const draft = record({
    metrics: [
      { text: "장애가 80% 감소했다.", basis: "고객 73명 설문 결과" },
      { text: "장애 80% 감소", basis: "2023년 장애 기록" },
    ],
  });
  const result = await importExperiences(db, createFakeAi([{ records: [draft], more: false }]), "u1", source, now);
  if (!result.ok) throw new Error("가져오기 실패");
  expect((await getExperience(db, "u1", result.created[0].id))?.metrics).toEqual([
    { text: "장애가 80% 감소했다.", basis: null },
    { text: "장애 80% 감소", basis: "2023년 장애 기록" },
  ]);
});

test("긴 문장 뒤쪽에 지어낸 숫자가 있어도 고쳐야 할 주장으로 잡힌다", async () => {
  const long = `${"결제 승인 과정을 개선했다 ".repeat(20)}그 결과 응답 시간이 47% 줄었다.`;
  const result = await importExperiences(db, createFakeAi([{ records: [record({ result: long })], more: false }]), "u1", source, now);
  if (!result.ok) throw new Error("가져오기 실패");
  const claims = await listClaims(db, "u1", result.created[0].id);
  expect(claims.find((claim) => claim.quote.includes("47%"))?.status).toBe("needs_fix");
});

test("주장으로 훑지 않는 칸에 지어낸 숫자가 있으면 그 구절도 고쳐야 할 주장이 되고, 고치면 닫힌다", async () => {
  const draft = record({ evidenceNote: "고객 73명 설문 결과" });
  const result = await importExperiences(db, createFakeAi([{ records: [draft], more: false }]), "u1", source, now);
  if (!result.ok) throw new Error("가져오기 실패");
  const id = result.created[0].id;
  const claim = (await listClaims(db, "u1", id)).find((item) => item.quote === "고객 73명 설문 결과");
  expect(claim?.status).toBe("needs_fix");

  const current = await getExperience(db, "u1", id);
  if (!current) throw new Error("기록 없음");
  await updateExperience(db, "u1", id, { ...toInput(current), evidenceNote: null });
  expect((await listClaims(db, "u1", id)).find((item) => item.id === claim?.id)?.status).toBe("fixed");
});

test("금지 표현은 원본에 글자 그대로 있는 것만 받는다", async () => {
  const notion = `${source}\n\n## [하위 페이지] 사용 금지 표현\n- 🚫 "전 품목" (→ 6~15개 품목)\n- 🚫 "ERP 구축 주도"`;
  const draft = record({ bannedPhrases: ["전 품목", "ERP 구축 주도", "AI가 지어낸 표현", " 전 품목 "] });
  const result = await importExperiences(db, createFakeAi([{ records: [draft], more: false }]), "u1", notion, now);
  if (!result.ok) throw new Error("가져오기 실패");
  expect((await getExperience(db, "u1", result.created[0].id))?.bannedPhrases).toEqual(["전 품목", "ERP 구축 주도"]);
});

test("한도를 넘긴 초안은 버리지 않고 한도에 맞춰 저장하며, 본문이 잘렸으면 알린다", async () => {
  const draft = record({
    actions: `${"결제 승인 과정을 개선했다. ".repeat(400)}`,
    tags: [...Array.from({ length: 14 }, (_, index) => `태그${index}`), "가".repeat(40)],
    organization: "가".repeat(150),
    roleClaims: [],
  });
  const result = await importExperiences(db, createFakeAi([{ records: [draft, school], more: false }]), "u1", source, now);
  if (!result.ok) throw new Error("가져오기 실패");
  expect(result.skipped).toBe(0);
  expect(result.created.map((item) => item.trimmed)).toEqual([true, false]);
  const saved = await getExperience(db, "u1", result.created[0].id);
  expect(saved?.actions?.length).toBeGreaterThan(3990); // 끝의 공백은 저장할 때 다듬어진다
  expect(saved?.actions?.length).toBeLessThanOrEqual(4000);
  expect(saved?.tags).toHaveLength(10);
  expect(saved?.organization?.length).toBe(100);
});
