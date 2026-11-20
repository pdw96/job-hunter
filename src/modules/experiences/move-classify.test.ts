import { beforeEach, expect, test } from "vitest";
import { createTestDb } from "@/db/test-db";
import type { Db } from "@/db/types";
import { createFakeAi } from "@/modules/ai/fake-client";
import { user } from "@/modules/auth/schema";
import { type ClassifyRecord, defaultRole, requestClassify, type RoleChoice, settleRoles } from "./move-classify";
import type { Kind } from "./options";

let db: Db;
const now = new Date("2026-11-20T03:00:00Z");

beforeEach(async () => {
  delete process.env.AI_MONTHLY_LIMIT_USD;
  db = await createTestDb();
  await db.insert(user).values({ id: "u1", name: "A", email: "u1@example.com" });
});

const rec = (name: string, kind: Kind, over: Partial<ClassifyRecord> = {}): ClassifyRecord => ({
  name,
  kind,
  organization: null,
  role: null,
  startMonth: "2022-03",
  endMonth: "2023-02",
  isOngoing: false,
  body: "",
  ...over,
});

test("기록 전부를 별명으로 한 번에 보낸다. 정해진 칸과 본문 앞 300자만, 첫 줄은 [옮기기: 정리]", async () => {
  const ai = createFakeAi([{ records: [] }]);
  const records = [
    rec("한빛대학교", "school", { organization: "한빛대학교" }),
    rec("한빛전자 영업", "job", { organization: "한빛전자", role: "영업 사원", isOngoing: true, endMonth: null, body: "가".repeat(400) }),
    rec("정보처리기사", "certificate", { startMonth: "2021-06", endMonth: null }),
  ];
  const result = await requestClassify(db, ai, "u1", records, now);
  expect(result.ok).toBe(true);
  const [request] = ai.requests;
  expect(request).toMatchObject({ purpose: "migrate", effort: "medium", maxTokens: 16000 });
  const text = request.messages[0].text;
  expect(text.split("\n")[0]).toBe("[옮기기: 정리]");
  expect(text).toContain("R1 | 이름: 한빛대학교 | 구분: 학력 | 소속: 한빛대학교 | 역할: 없음 | 기간: 2022-03 ~ 2023-02");
  expect(text).toContain("R2 | 이름: 한빛전자 영업 | 구분: 재직 | 소속: 한빛전자 | 역할: 영업 사원 | 기간: 2022-03 ~ 진행 중");
  // 자격은 취득 월 하나
  expect(text).toContain("R3 | 이름: 정보처리기사 | 구분: 자격 | 소속: 없음 | 역할: 없음 | 기간: 2021-06");
  expect(text).toContain(`본문: ${"가".repeat(300)}`);
  expect(text).not.toContain("가".repeat(301));
});

test("빠지거나 두 번 나온 별명, 구분에 맞지 않는 역할은 기본값(프로젝트·기타·재직은 head, 나머지는 fact)이 된다", async () => {
  const records = [rec("한빛대학교", "school"), rec("한빛전자", "job"), rec("재고 시스템", "project"), rec("봉사", "other"), rec("공백", "gap")];
  const ai = createFakeAi([
    {
      records: [
        { record: "R1", role: "head", ref: null }, // 학력은 head가 될 수 없다
        { record: "R2", role: "fact", ref: null }, // 재직은 fact가 될 수 없다
        { record: "R3", role: "scene", ref: "R2" },
        { record: "R3", role: "head", ref: null }, // 두 번 나왔다
        { record: "R9", role: "head", ref: null }, // 모르는 별명
        { record: "R5", role: "fact", ref: "R1" }, // fact의 ref는 버린다
      ],
    },
  ]);
  const result = await requestClassify(db, ai, "u1", records, now);
  expect(result).toEqual({
    ok: true,
    roles: [
      { role: "fact", ref: null },
      { role: "head", ref: null },
      { role: "head", ref: null },
      { role: "head", ref: null }, // 빠졌다
      { role: "fact", ref: null },
    ],
  });
  expect(defaultRole("job")).toBe("head");
  expect(defaultRole("certificate")).toBe("fact");
});

test("scene의 ref는 head인 기록, duplicate의 ref는 같은 구분의 duplicate가 아닌 기록이어야 한다", async () => {
  const records = [
    rec("한빛전자", "job"), // R1 head
    rec("성과 사례 1", "project"), // R2 scene → R1
    rec("성과 사례 2", "project"), // R3 scene → R2(장면이라 안 됨)
    rec("한빛대학교", "school"), // R4 fact
    rec("한빛대학교", "school"), // R5 duplicate → R4
    rec("한빛대학교(중복)", "school"), // R6 duplicate → R5(duplicate라 안 됨)
    rec("재고 시스템", "project"), // R7 duplicate → R4(다른 구분이라 안 됨)
    rec("자기", "project"), // R8 scene → R8(자기 자신은 안 됨)
  ];
  const ai = createFakeAi([
    {
      records: [
        { record: "R1", role: "head", ref: null },
        { record: "R2", role: "scene", ref: "R1" },
        { record: "R3", role: "scene", ref: "R2" },
        { record: "R4", role: "fact", ref: null },
        { record: "R5", role: "duplicate", ref: "R4" },
        { record: "R6", role: "duplicate", ref: "R5" },
        { record: "R7", role: "duplicate", ref: "R4" },
        { record: "R8", role: "scene", ref: "R8" },
      ],
    },
  ]);
  const result = await requestClassify(db, ai, "u1", records, now);
  if (!result.ok) throw new Error(result.reason);
  expect(result.roles).toEqual([
    { role: "head", ref: null },
    { role: "scene", ref: 0 },
    { role: "head", ref: null },
    { role: "fact", ref: null },
    { role: "duplicate", ref: 3 },
    { role: "fact", ref: null },
    { role: "head", ref: null },
    { role: "head", ref: null },
  ]);
});

test("AI 호출이 실패하면 그 까닭을 돌려준다", async () => {
  const result = await requestClassify(db, createFakeAi([{ fail: "unavailable" }]), "u1", [rec("a", "school"), rec("b", "school")], now);
  expect(result).toEqual({ ok: false, reason: "unavailable" });
});

// ---- 같은 기록 중 남길 것 ----

const info = (confirmed: boolean, length: number, minute: number) => ({ confirmed, length, createdAt: new Date(now.getTime() + minute * 60_000) });

test("같은 기록 중에서는 확인된 것 → 본문이 긴 것 → 먼저 만든 것을 남기고, 남는 것이 짝의 역할을 이어받는다", () => {
  // R1(head) ← R2(duplicate, 더 김), R3(scene → R1)
  const roles: RoleChoice[] = [
    { role: "head", ref: null },
    { role: "duplicate", ref: 0 },
    { role: "scene", ref: 0 },
  ];
  expect(settleRoles([info(false, 10, 0), info(false, 50, 1), info(false, 5, 2)], roles)).toEqual([
    { role: "duplicate", ref: 1 },
    { role: "head", ref: null },
    { role: "scene", ref: 1 }, // 장면은 남는 머리로
  ]);
  // 확인된 것이 짧아도 먼저
  expect(settleRoles([info(true, 10, 0), info(false, 50, 1), info(false, 5, 2)], roles)).toEqual(roles);
  // 길이가 같으면 먼저 만든 것
  expect(settleRoles([info(false, 10, 5), info(false, 10, 1), info(false, 5, 2)], roles)[1]).toEqual({ role: "head", ref: null });
});

test("같은 기록이 셋이어도 하나만 남고, 장면의 짝이면 남는 것이 같은 머리의 장면이 된다", () => {
  const roles: RoleChoice[] = [
    { role: "head", ref: null }, // R1 머리
    { role: "scene", ref: 0 }, // R2 장면
    { role: "duplicate", ref: 1 }, // R3 = R2
    { role: "duplicate", ref: 1 }, // R4 = R2
  ];
  expect(settleRoles([info(false, 1, 0), info(false, 10, 1), info(false, 30, 2), info(false, 20, 3)], roles)).toEqual([
    { role: "head", ref: null },
    { role: "duplicate", ref: 2 },
    { role: "scene", ref: 0 },
    { role: "duplicate", ref: 2 },
  ]);
});

// ---- 같은 기록의 기간 검사 (검토) ----

const pairAnswer = { records: [{ record: "R1", role: "head", ref: null }, { record: "R2", role: "duplicate", ref: "R1" }] };
const pairOf = async (a: ClassifyRecord, b: ClassifyRecord, answer: unknown = pairAnswer) => {
  const result = await requestClassify(db, createFakeAi([answer]), "u1", [a, b], now);
  if (!result.ok) throw new Error(result.reason);
  return result.roles[1];
};

test("같은 회사라도 기간이 겹치지 않는 두 재직은 같은 기록으로 받지 않는다", async () => {
  const first = rec("한빛전자", "job", { startMonth: "2018-01", endMonth: "2019-12" });
  const second = rec("한빛전자", "job", { startMonth: "2021-03", endMonth: "2023-02" });
  expect(await pairOf(first, second)).toEqual({ role: "head", ref: null });
});

test("시작 월이 달라도 기간이 겹치면 같은 기록으로 받는다. 진행 중이거나 끝 월이 없으면 끝이 열린 것으로 본다", async () => {
  const total = rec("한빛전자 영업 총괄", "job", { startMonth: "2020-03", endMonth: "2024-02" });
  expect(await pairOf(total, rec("한빛전자 영업 전담", "job", { startMonth: "2021-01", endMonth: "2022-12" }))).toEqual({ role: "duplicate", ref: 0 });
  expect(await pairOf(total, rec("한빛전자", "job", { startMonth: "2023-05", endMonth: null, isOngoing: true }))).toEqual({ role: "duplicate", ref: 0 });
  expect(await pairOf(rec("한빛전자", "job", { startMonth: "2019-01", endMonth: null }), rec("한빛전자", "job", { startMonth: "2024-01", endMonth: "2024-06" }))).toEqual({
    role: "duplicate",
    ref: 0,
  });
  // 어느 한쪽에 시작 월이 없으면 기간으로 막지 않는다
  expect(await pairOf(total, rec("한빛전자", "job", { startMonth: null, endMonth: null }))).toEqual({ role: "duplicate", ref: 0 });
});

test("자격은 취득 월 하나로 보아, 달이 다르면 같은 기록으로 받지 않는다", async () => {
  const answer = { records: [{ record: "R1", role: "fact", ref: null }, { record: "R2", role: "duplicate", ref: "R1" }] };
  const cert = (month: string) => rec("정보처리기사", "certificate", { startMonth: month, endMonth: null });
  expect(await pairOf(cert("2021-06"), cert("2021-06"), answer)).toEqual({ role: "duplicate", ref: 0 });
  expect(await pairOf(cert("2021-06"), cert("2023-11"), answer)).toEqual({ role: "fact", ref: null });
});

test("scene의 ref가 같은 기록(duplicate)이면 그 짝이 head일 때 짝으로 잇는다", async () => {
  const records = [rec("한빛전자 총괄", "job"), rec("한빛전자 전담", "job"), rec("성과 사례", "project"), rec("성과 사례 2", "project")];
  const ai = createFakeAi([
    {
      records: [
        { record: "R1", role: "head", ref: null },
        { record: "R2", role: "duplicate", ref: "R1" },
        { record: "R3", role: "scene", ref: "R2" }, // 같은 기록을 가리킴 → R1로
        { record: "R4", role: "duplicate", ref: "R3" }, // 장면의 짝
      ],
    },
  ]);
  const result = await requestClassify(db, ai, "u1", records, now);
  if (!result.ok) throw new Error(result.reason);
  expect(result.roles.slice(0, 3)).toEqual([
    { role: "head", ref: null },
    { role: "duplicate", ref: 0 },
    { role: "scene", ref: 0 },
  ]);
});
