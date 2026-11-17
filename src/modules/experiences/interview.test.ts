import { eq } from "drizzle-orm";
import { beforeEach, expect, test } from "vitest";
import { createTestDb } from "@/db/test-db";
import type { Db } from "@/db/types";
import { createFakeAi } from "@/modules/ai/fake-client";
import { aiUsage } from "@/modules/ai/schema";
import { user } from "@/modules/auth/schema";
import { createTrack } from "@/modules/tracks/repo";
import type { ExperienceInput } from "./input";
import { answerInterview, draftFromInterview, finishInterview, getInterview, startInterview } from "./interview";
import { judgeExperience } from "./judge";
import { createExperience, deleteExperience, listExperiences } from "./repo";
import { interviews } from "./schema";

let db: Db;
let t1: string;
let t2: string;
const now = new Date("2026-11-17T03:00:00Z");

const q = (message: string, enough = false) => ({ message, enough });

const job: ExperienceInput = {
  name: "결제 시스템 개편",
  kind: "project",
  organization: "가나다 주식회사",
  role: "백엔드 개발",
  startMonth: "2023-03",
  endMonth: "2023-11",
  isOngoing: false,
  situation: "장애가 잦았다",
  actions: "결제 승인 API를 다시 설계했다",
  result: "장애가 줄었다",
  metrics: [],
  notDone: null,
  bannedPhrases: ["혼자 구축"],
  evidenceNote: null,
  tags: ["결제"],
};

// AI가 돌려주는 초안 형태(빈 칸은 빈 문자열)
const aiDraft = {
  name: "결제 시스템 개편",
  kind: "project",
  organization: "가나다 주식회사",
  role: "백엔드 개발",
  startMonth: "2023-03",
  endMonth: "2023-11",
  isOngoing: false,
  situation: "월 장애가 5건 있었다",
  actions: "결제 승인 API를 다시 설계했다",
  result: "장애가 1건으로 줄었다",
  metrics: [{ text: "월 장애 5건에서 1건", basis: "" }],
  notDone: "",
  evidenceNote: "",
  tags: ["결제"],
};

beforeEach(async () => {
  delete process.env.AI_MONTHLY_LIMIT_USD;
  db = await createTestDb();
  await db.insert(user).values([
    { id: "u1", name: "홍길동", email: "u1@example.com" },
    { id: "u2", name: "B", email: "u2@example.com" },
  ]);
  const survey = {
    name: "개발",
    majorCode: "20",
    jobs: [{ ncsCode: "20010202", customName: null }],
    applicantType: "new" as const,
    experienceMonths: null,
    regions: ["seoul"],
    salaryMin: null,
    employmentTypes: ["regular" as const],
    importanceOrder: ["jobMatch" as const, "location" as const, "experience" as const, "field" as const, "preferred" as const],
    extraAnswers: {},
  };
  const a = await createTrack(db, "u1", survey);
  const b = await createTrack(db, "u2", survey);
  if (!a.ok || !b.ok) throw new Error("track");
  t1 = a.id;
  t2 = b.id;
});

async function start(ai = createFakeAi([q("어떤 경험인가요?")]), options: { experienceId?: string; trackId?: string } = {}) {
  const result = await startInterview(db, ai, "u1", options, now);
  if (!result.ok) throw new Error(result.reason);
  return result;
}

test("시작하면 첫 질문이 저장되고, 답하면 대화가 순서대로 쌓인다", async () => {
  const started = await start();
  expect(started.message).toBe("어떤 경험인가요?");
  const ai = createFakeAi([q("기간은요?")]);
  expect(await answerInterview(db, ai, "u1", started.id, "결제 시스템을 고쳤어요", now)).toEqual({
    ok: true,
    message: "기간은요?",
    suggestFinish: false,
  });
  expect((await getInterview(db, "u1", started.id))?.messages).toEqual([
    { role: "assistant", text: "어떤 경험인가요?" },
    { role: "user", text: "결제 시스템을 고쳤어요" },
    { role: "assistant", text: "기간은요?" },
  ]);
  // AI에게는 지금까지의 대화가 모두 전달된다
  expect(ai.requests[0].messages.slice(1).map((m) => m.text)).toEqual(["어떤 경험인가요?", "결제 시스템을 고쳤어요"]);
});

test("AI가 충분하다고 하면 정리를 권한다", async () => {
  const started = await start();
  const result = await answerInterview(db, createFakeAi([q("이제 정리해도 좋겠습니다", true)]), "u1", started.id, "네", now);
  expect(result).toMatchObject({ ok: true, suggestFinish: true });
});

test("다른 사용자의 인터뷰는 읽히지 않고 답하거나 정리하거나 끝낼 수 없다", async () => {
  const started = await start();
  expect(await getInterview(db, "u2", started.id)).toBeNull();
  const ai = createFakeAi([q("?")]);
  expect(await answerInterview(db, ai, "u2", started.id, "침입", now)).toEqual({ ok: false, reason: "not_found" });
  expect(await draftFromInterview(db, ai, "u2", started.id, now)).toEqual({ ok: false, reason: "not_found" });
  expect(await finishInterview(db, "u2", started.id)).toEqual({ ok: false, reason: "not_found" });
  expect(ai.requests).toHaveLength(0);
  expect((await getInterview(db, "u1", started.id))?.messages).toHaveLength(1);
});

test("남의 기록이나 남의 트랙으로는 시작할 수 없다", async () => {
  const other = await createExperience(db, "u2", job);
  const ai = createFakeAi([q("?")]);
  expect(await startInterview(db, ai, "u1", { experienceId: other }, now)).toEqual({ ok: false, reason: "not_found" });
  expect(await startInterview(db, ai, "u1", { trackId: t2 }, now)).toEqual({ ok: false, reason: "not_found" });
  expect(ai.requests).toHaveLength(0);
  expect(await db.select().from(interviews)).toEqual([]);
});

test("빈 답과 4,000자를 넘는 답은 거부하고, 답이 30개를 넘으면 too_long이다", async () => {
  const started = await start();
  const ai = createFakeAi(Array.from({ length: 40 }, () => q("다음 질문")));
  expect(await answerInterview(db, ai, "u1", started.id, "  ", now)).toEqual({ ok: false, reason: "invalid_text" });
  expect(await answerInterview(db, ai, "u1", started.id, "가".repeat(4001), now)).toEqual({ ok: false, reason: "invalid_text" });
  for (let i = 0; i < 30; i++) expect((await answerInterview(db, ai, "u1", started.id, `답 ${i}`, now)).ok).toBe(true);
  expect(await answerInterview(db, ai, "u1", started.id, "하나 더", now)).toEqual({ ok: false, reason: "too_long" });
});

test("트랙을 주면 그 트랙의 직무가 AI에게 전달된다", async () => {
  const ai = createFakeAi([q("?")]);
  await start(ai, { trackId: t1 });
  expect(ai.requests[0].messages[0].text).toContain("응용SW엔지니어링");
});

test("보완 인터뷰는 기록의 내용과 미달 항목·보완 방안을 AI에게 알려 준다", async () => {
  const id = await createExperience(db, "u1", job);
  const met = { status: "met", note: "" };
  await judgeExperience(
    db,
    createFakeAi([{ role: met, level: { status: "unmet", note: "어디까지 직접 했는지 알려 주세요" }, metrics: met, evidence: met, phraseCandidates: [] }]),
    "u1",
    id,
    now,
  );
  const ai = createFakeAi([q("설계는 혼자 하셨나요?")]);
  await start(ai, { experienceId: id });
  const context = ai.requests[0].messages[0].text;
  expect(context).toContain("결제 승인 API를 다시 설계했다");
  expect(context).toContain("수준");
  expect(context).toContain("어디까지 직접 했는지 알려 주세요");
  expect(context).not.toContain("본인 역할: 미달");
});

test("AI에게 보내는 글에 사용자 이름·이메일이 없고 답 안의 연락처는 가려진다", async () => {
  const started = await start();
  const ai = createFakeAi([q("네")]);
  await answerInterview(db, ai, "u1", started.id, "제 번호는 010-1234-5678입니다", now);
  const sent = JSON.stringify(ai.requests[0]);
  expect(sent).not.toContain("010-1234-5678");
  expect(sent).not.toContain("홍길동");
  expect(sent).not.toContain("u1@example.com");
  // 저장된 대화에는 사용자가 쓴 그대로 남는다
  expect((await getInterview(db, "u1", started.id))?.messages[1].text).toContain("010-1234-5678");
});

test("정리하면 검사된 초안이 나오고, 빈 칸은 null이며, 기록은 저장되지 않는다", async () => {
  const started = await start();
  await answerInterview(db, createFakeAi([q("네", true)]), "u1", started.id, "2023년 3월부터 11월까지, 장애가 5건에서 1건으로 줄었어요", now);
  const result = await draftFromInterview(db, createFakeAi([aiDraft]), "u1", started.id, now);
  expect(result).toMatchObject({
    ok: true,
    draft: { name: "결제 시스템 개편", kind: "project", notDone: null, evidenceNote: null, bannedPhrases: [] },
    warnings: {},
  });
  if (result.ok) expect(result.draft.metrics).toEqual([{ text: "월 장애 5건에서 1건", basis: null }]);
  expect(await listExperiences(db, "u1")).toEqual([]);
});

test("초안에 대화에 없던 숫자가 있으면 그 칸에 경고가 붙는다", async () => {
  const started = await start();
  await answerInterview(db, createFakeAi([q("네", true)]), "u1", started.id, "2023년 3월부터 11월까지, 장애가 5건에서 1건으로 줄었어요", now);
  const invented = { ...aiDraft, result: "처리 시간을 30% 단축했다", metrics: [{ text: "응답 속도 2배 향상", basis: "" }] };
  const result = await draftFromInterview(db, createFakeAi([invented]), "u1", started.id, now);
  expect(result).toMatchObject({
    ok: true,
    warnings: { result: "대화에 없던 숫자가 있습니다: 30", metrics: "대화에 없던 숫자가 있습니다: 2" },
  });
});

test("AI가 형식이 틀린 초안을 주면 invalid다", async () => {
  const started = await start();
  await answerInterview(db, createFakeAi([q("네", true)]), "u1", started.id, "답", now);
  const broken = { ...aiDraft, name: "", startMonth: "2023-12" };
  expect(await draftFromInterview(db, createFakeAi([broken]), "u1", started.id, now)).toEqual({ ok: false, reason: "invalid" });
});

test("아직 답한 것이 없으면 정리할 수 없다", async () => {
  const started = await start();
  const ai = createFakeAi([aiDraft]);
  expect(await draftFromInterview(db, ai, "u1", started.id, now)).toEqual({ ok: false, reason: "empty" });
  expect(ai.requests).toHaveLength(0);
});

test("보완 인터뷰의 초안은 기존 금지 표현을 유지하고, 기존 기록의 숫자는 경고하지 않는다", async () => {
  const id = await createExperience(db, "u1", job);
  const started = await start(createFakeAi([q("설계는 혼자 하셨나요?")]), { experienceId: id });
  await answerInterview(db, createFakeAi([q("네", true)]), "u1", started.id, "설계는 팀장과 같이 했고 구현은 제가 했어요", now);
  const ai = createFakeAi([{ ...aiDraft, situation: "장애가 잦았다", result: "장애가 줄었다", metrics: [] }]);
  const result = await draftFromInterview(db, ai, "u1", started.id, now);
  expect(result).toMatchObject({ ok: true, draft: { bannedPhrases: ["혼자 구축"] }, warnings: {} });
  // 정리 요청에 기존 기록이 함께 전달된다
  expect(ai.requests[0].messages[0].text).toContain("결제 승인 API를 다시 설계했다");
});

test("끝낸 인터뷰에는 답할 수 없다", async () => {
  const started = await start();
  expect(await finishInterview(db, "u1", started.id)).toEqual({ ok: true });
  expect(await answerInterview(db, createFakeAi([q("?")]), "u1", started.id, "답", now)).toEqual({ ok: false, reason: "finished" });
});

test("한도를 넘으면 시작과 답이 over_limit이고 대화가 바뀌지 않는다", async () => {
  const started = await start();
  process.env.AI_MONTHLY_LIMIT_USD = "0";
  expect(await answerInterview(db, createFakeAi([q("?")]), "u1", started.id, "답", now)).toEqual({ ok: false, reason: "over_limit" });
  expect(await startInterview(db, createFakeAi([q("?")]), "u1", {}, now)).toEqual({ ok: false, reason: "over_limit" });
  expect((await getInterview(db, "u1", started.id))?.messages).toHaveLength(1);
});

test("턴과 정리마다 사용량이 기록된다", async () => {
  const started = await start();
  await answerInterview(db, createFakeAi([q("네", true)]), "u1", started.id, "5건에서 1건, 2023년 3월부터 11월", now);
  await draftFromInterview(db, createFakeAi([aiDraft]), "u1", started.id, now);
  expect((await db.select().from(aiUsage)).map((row) => row.purpose)).toEqual(["interview", "interview", "extract"]);
});

test("기록을 지우면 그 기록의 보완 인터뷰도 지워진다", async () => {
  const id = await createExperience(db, "u1", job);
  await start(createFakeAi([q("?")]), { experienceId: id });
  await deleteExperience(db, "u1", id);
  expect(await db.select().from(interviews).where(eq(interviews.userId, "u1"))).toEqual([]);
});
