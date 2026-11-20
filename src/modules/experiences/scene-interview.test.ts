import { eq } from "drizzle-orm";
import { beforeEach, expect, test } from "vitest";
import { createTestDb } from "@/db/test-db";
import type { Db } from "@/db/types";
import { createFakeAi } from "@/modules/ai/fake-client";
import { user } from "@/modules/auth/schema";
import { createFact, deleteFact } from "./facts-repo";
import { answerInterview, draftFromInterview, getInterview, startInterview } from "./interview";
import { INTERVIEW_SYSTEM } from "./prompts";
import { insertRecordClaims } from "./record-claims-repo";
import type { JobInput, SceneInput } from "./record-input";
import { answerSceneInterview, draftSceneFromInterview, startSceneInterview } from "./scene-interview";
import { createScene } from "./scenes-repo";
import { interviews, scenes } from "./schema";

let db: Db;
const now = new Date("2026-11-20T03:00:00Z");
const q = (message: string, enough = false) => ({ message, enough });

const job: JobInput = {
  company: "가나다물류",
  department: "운영팀",
  title: null,
  employment: "regular",
  startMonth: "2021-03",
  endMonth: "2023-08",
  isOngoing: false,
  duties: [],
  bannedPhrases: [],
};

// AI가 돌려주는 장면 초안(빈 칸은 빈 글)
const aiScene = {
  title: "배송 지연 문의 대응",
  startMonth: "",
  endMonth: "",
  isOngoing: false,
  situation: "배송 지연 문의가 몰렸다",
  judgment: "",
  actions: "지연된 주문을 지역별로 묶어 안내 문자를 보냈다",
  result: "문의가 30% 줄었다",
  lessons: "",
  metrics: [],
  notDone: "보상 기준은 팀장이 정했다",
  evidenceNote: "",
  tags: ["고객 응대"],
};

beforeEach(async () => {
  delete process.env.AI_MONTHLY_LIMIT_USD;
  db = await createTestDb();
  await db.insert(user).values([
    { id: "u1", name: "A", email: "u1@example.com" },
    { id: "u2", name: "B", email: "u2@example.com" },
  ]);
});

async function jobId(userId = "u1") {
  const created = await createFact(db, userId, "job", job);
  if (!created.ok) throw new Error("job");
  return created.id;
}

async function startedFor(head: string) {
  const result = await startSceneInterview(db, createFakeAi([q("어떤 일이었나요?")]), "u1", { head: { kind: "job", id: head } }, now);
  if (!result.ok) throw new Error(result.reason);
  return result.id;
}

test("머리 없이 시작하면 not_found이고 AI를 부르지 않는다", async () => {
  const ai = createFakeAi([q("?")]);
  expect(await startSceneInterview(db, ai, "u1", {}, now)).toEqual({ ok: false, reason: "not_found" });
  expect(ai.requests).toHaveLength(0);
});

test("남의 머리나 남의 장면으로는 시작할 수 없다", async () => {
  const theirs = await jobId("u2");
  const ai = createFakeAi([q("?"), q("?")]);
  expect(await startSceneInterview(db, ai, "u1", { head: { kind: "job", id: theirs } }, now)).toEqual({ ok: false, reason: "not_found" });
  const scene = await createScene(db, "u2", { ...sceneInput(theirs) });
  if (!scene.ok) throw new Error();
  expect(await startSceneInterview(db, ai, "u1", { sceneId: scene.id }, now)).toEqual({ ok: false, reason: "not_found" });
  expect(ai.requests).toHaveLength(0);
});

test("첫 질문을 받는 사이 머리나 사례가 지워지면(다시 옮기기 등) not_found이고 인터뷰를 만들지 않는다", async () => {
  const head = await jobId();
  const goneHead = createFakeAi([
    async () => {
      await db.delete(scenes).where(eq(scenes.jobId, head));
      expect(await deleteFact(db, "u1", "job", head)).toEqual({ ok: true });
      return q("어떤 일이었나요?");
    },
  ]);
  expect(await startSceneInterview(db, goneHead, "u1", { head: { kind: "job", id: head } }, now)).toEqual({ ok: false, reason: "not_found" });

  const other = await jobId();
  const scene = await createScene(db, "u1", { ...sceneInput(other) });
  if (!scene.ok) throw new Error();
  const goneScene = createFakeAi([
    async () => {
      await db.delete(scenes).where(eq(scenes.id, scene.id));
      return q("어떤 일이었나요?");
    },
  ]);
  expect(await startSceneInterview(db, goneScene, "u1", { sceneId: scene.id }, now)).toEqual({ ok: false, reason: "not_found" });
  expect(await db.select().from(interviews)).toHaveLength(0);
});

test("시작하면 머리 정보가 대화 앞머리에 들어가고, 인터뷰에 머리가 저장된다", async () => {
  const head = await jobId();
  const ai = createFakeAi([q("이 회사에서 있었던 일 하나를 골라 주세요")]);
  const result = await startSceneInterview(db, ai, "u1", { head: { kind: "job", id: head } }, now);
  expect(result).toMatchObject({ ok: true });
  if (!result.ok) return;
  expect(ai.requests[0]).toMatchObject({ purpose: "interview", system: INTERVIEW_SYSTEM });
  expect(ai.requests[0].messages[0].text).toContain("가나다물류");
  expect(ai.requests[0].messages[0].text).toContain("장면 하나");
  const [row] = await db.select().from(interviews).where(eq(interviews.id, result.id));
  expect(row).toMatchObject({ headKind: "job", headId: head, sceneId: null, experienceId: null });
  expect((await getInterview(db, "u1", result.id))?.head).toEqual({ kind: "job", id: head });
});

test("답하면 대화가 쌓이고, 매번 머리 정보를 함께 보낸다. 옛 인터뷰 함수로는 답할 수 없다", async () => {
  const id = await startedFor(await jobId());
  const ai = createFakeAi([q("본인이 한 일은요?")]);
  expect(await answerSceneInterview(db, ai, "u1", id, "배송 지연 문의를 맡았어요", now)).toEqual({
    ok: true,
    message: "본인이 한 일은요?",
    suggestFinish: false,
  });
  expect(ai.requests[0].messages[0].text).toContain("가나다물류");
  expect((await getInterview(db, "u1", id))?.messages).toHaveLength(3);
  expect(await answerSceneInterview(db, ai, "u2", id, "침입", now)).toEqual({ ok: false, reason: "not_found" });
  // 옛 경험 인터뷰 함수는 장면 인터뷰를 다루지 않는다(반대도 같다)
  const old = createFakeAi([q("?")]);
  expect(await answerInterview(db, old, "u1", id, "답", now)).toEqual({ ok: false, reason: "not_found" });
  expect(await draftFromInterview(db, old, "u1", id, now)).toEqual({ ok: false, reason: "not_found" });
  const experienceInterview = await startInterview(db, createFakeAi([q("?")]), "u1", {}, now);
  if (!experienceInterview.ok) throw new Error();
  expect(await answerSceneInterview(db, old, "u1", experienceInterview.id, "답", now)).toEqual({ ok: false, reason: "not_found" });
  expect(old.requests).toHaveLength(0);
});

test("정리한 초안의 머리는 인터뷰의 머리이고, 대화에 없던 숫자는 그 칸의 경고가 된다", async () => {
  const head = await jobId();
  const id = await startedFor(head);
  await answerSceneInterview(db, createFakeAi([q("결과는요?")]), "u1", id, "배송 지연 문의가 몰렸을 때 안내 문자를 보냈어요", now);
  const ai = createFakeAi([aiScene]);
  const result = await draftSceneFromInterview(db, ai, "u1", id, now);
  expect(ai.requests[0]).toMatchObject({ purpose: "extract_scene" });
  expect(ai.requests[0].messages[0].text).toContain("가나다물류");
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.draft.head).toEqual({ kind: "job", id: head });
  expect(result.draft.title).toBe("배송 지연 문의 대응");
  expect(result.draft.startMonth).toBeNull();
  expect(result.draft.bannedPhrases).toEqual([]);
  expect(result.warnings.result).toContain("30");
  expect(result.warnings.actions).toBeUndefined();
});

test("답이 없으면 empty, 머리가 지워졌으면 no_head, 남의 인터뷰는 not_found", async () => {
  const head = await jobId();
  const id = await startedFor(head);
  const ai = createFakeAi([aiScene]);
  expect(await draftSceneFromInterview(db, ai, "u1", id, now)).toEqual({ ok: false, reason: "empty" });
  await answerSceneInterview(db, createFakeAi([q("?")]), "u1", id, "답했어요", now);
  expect(await draftSceneFromInterview(db, ai, "u2", id, now)).toEqual({ ok: false, reason: "not_found" });
  expect(await deleteFact(db, "u1", "job", head)).toEqual({ ok: true });
  expect(await draftSceneFromInterview(db, ai, "u1", id, now)).toEqual({ ok: false, reason: "no_head" });
  expect(ai.requests).toHaveLength(0);
});

test("AI가 실패하면 그 사유를 돌려준다", async () => {
  const id = await startedFor(await jobId());
  await answerSceneInterview(db, createFakeAi([q("?")]), "u1", id, "답했어요", now);
  expect(await draftSceneFromInterview(db, createFakeAi([{ fail: "refused" }]), "u1", id, now)).toEqual({ ok: false, reason: "refused" });
});

function sceneInput(head: string, over: Partial<SceneInput> = {}): SceneInput {
  return {
    head: { kind: "job", id: head },
    title: "결제 장애 대응",
    startMonth: null,
    endMonth: null,
    isOngoing: false,
    situation: "장애가 잦았다",
    judgment: null,
    actions: "로그를 모아 원인을 찾았다",
    result: "장애가 월 5건에서 1건으로 줄었다",
    lessons: null,
    metrics: [],
    notDone: null,
    bannedPhrases: ["혼자 구축"],
    evidenceNote: null,
    tags: [],
    ...over,
  };
}

test("보완 인터뷰는 장면, 고칠 구절, 미달 항목을 함께 보내고 초안은 그 장면의 머리와 금지 표현을 쓴다", async () => {
  const head = await jobId();
  const scene = await createScene(db, "u1", sceneInput(head));
  if (!scene.ok) throw new Error();
  await insertRecordClaims(db, "u1", { kind: "scene", id: scene.id }, [
    { kind: "metric", quote: "장애가 월 5건에서 1건으로 줄었다", phrase: null, origin: "code", status: "needs_fix" },
  ]);
  const rubric = {
    period: { status: "met", note: null },
    role: { status: "unmet", note: "본인이 직접 한 일을 나눠 주세요" },
    level: { status: "met", note: null },
    metrics: { status: "unjudged", note: null },
    evidence: { status: "unjudged", note: null },
  } as const;
  await db.update(scenes).set({ rubric: rubric as never }).where(eq(scenes.id, scene.id));

  const ai = createFakeAi([q("실제 장애 건수는 어땠나요?")]);
  const started = await startSceneInterview(db, ai, "u1", { sceneId: scene.id }, now);
  expect(started.ok).toBe(true);
  if (!started.ok) return;
  const context = ai.requests[0].messages[0].text;
  expect(context).toContain("보완하는 인터뷰");
  expect(context).toContain("장애가 월 5건에서 1건으로 줄었다");
  expect(context).toContain("본인이 직접 한 일을 나눠 주세요");
  expect(context).toContain("가나다물류");
  const [row] = await db.select().from(interviews).where(eq(interviews.id, started.id));
  expect(row).toMatchObject({ sceneId: scene.id, headKind: null, headId: null });

  await answerSceneInterview(db, createFakeAi([q("?")]), "u1", started.id, "실제로는 월 5건에서 2건이었어요", now);
  const result = await draftSceneFromInterview(db, createFakeAi([{ ...aiScene, result: "장애가 월 5건에서 2건으로 줄었다" }]), "u1", started.id, now);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.draft.head).toEqual({ kind: "job", id: head });
  expect(result.draft.bannedPhrases).toEqual(["혼자 구축"]);
  expect(result.warnings.result).toBeUndefined();
});
