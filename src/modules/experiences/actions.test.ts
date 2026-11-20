import { beforeEach, expect, test, vi } from "vitest";
import { createTestDb } from "@/db/test-db";
import type { Db } from "@/db/types";
import { user } from "@/modules/auth/schema";
import type { ExperienceInput } from "./input";
import { createExperience } from "./repo";
import { claims, experiences, interviews, trackScopes } from "./schema";

// 옛 기록 쓰기 액션은 바꾸기(5-4) 뒤 아무것도 쓰지 않고 안내만 돌려준다
const holder = vi.hoisted(() => ({ db: null as unknown as Db }));
vi.mock("@/db", () => ({
  get db() {
    return holder.db;
  },
}));
vi.mock("@/lib/session", () => ({
  requireUser: async () => ({ id: "u1", name: "A", isAdmin: false }),
  requireAdmin: async () => ({ id: "u1", name: "A", isAdmin: true }),
}));
vi.mock("@/modules/ai/provider", () => ({ ai: { call: () => Promise.reject(new Error("AI를 부르면 안 된다")) } }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const actions = await import("./actions");
const CLOSED = "경험 기록이 새 구조로 바뀌었습니다";

const input: ExperienceInput = {
  name: "주문 조회 개선",
  kind: "project",
  organization: null,
  role: null,
  startMonth: "2023-03",
  endMonth: "2023-11",
  isOngoing: false,
  situation: null,
  actions: "쿼리를 고쳤다",
  result: null,
  metrics: [],
  notDone: null,
  bannedPhrases: [],
  evidenceNote: null,
  tags: [],
};

beforeEach(async () => {
  holder.db = await createTestDb();
  await holder.db.insert(user).values({ id: "u1", name: "A", email: "u1@example.com" });
  await createExperience(holder.db, "u1", input);
});

async function rowCounts() {
  const db = holder.db;
  return {
    experiences: (await db.select().from(experiences)).length,
    scopes: (await db.select().from(trackScopes)).length,
    interviews: (await db.select().from(interviews)).length,
    claims: (await db.select().from(claims)).length,
  };
}

test("saveExperienceAction은 안내를 돌려주고 옛 표에 행을 만들지 않는다", async () => {
  const before = await rowCounts();
  const result = await actions.saveExperienceAction();
  expect(result).toEqual({ ok: false, errors: {}, message: CLOSED });
  expect(await rowCounts()).toEqual(before);
});

test("옛 기록 쓰기 액션은 모두 안내를 돌려주고 아무것도 바꾸지 않는다", async () => {
  const [before] = await holder.db.select().from(experiences);
  const results = [
    await actions.saveExperienceAction(),
    await actions.deleteExperienceAction(),
    await actions.setConfirmedAction(),
    await actions.setRubricClosedAction(),
    await actions.judgeAction(),
    await actions.decidePhraseAction(),
    await actions.startInterviewAction(),
    await actions.startExperienceInterviewAction(),
    await actions.answerInterviewAction(),
    await actions.draftInterviewAction(),
    await actions.importAction(),
    await actions.answerClaimAction(),
  ];
  for (const result of results) expect(result).toMatchObject({ ok: false, message: CLOSED });
  const [after] = await holder.db.select().from(experiences);
  expect(after).toEqual(before);
  expect((await rowCounts()).interviews).toBe(0);
});
