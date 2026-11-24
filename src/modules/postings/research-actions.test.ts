import { eq } from "drizzle-orm";
import { beforeEach, expect, test, vi } from "vitest";
import { createTestDb } from "@/db/test-db";
import { user } from "@/modules/auth/schema";
import { createTrack } from "@/modules/tracks/repo";
import type { SurveyInput } from "@/modules/tracks/survey";
import { validatePosting } from "./input";
import { createPosting } from "./repo";
import { claimResearch, finishResearch, getResearch } from "./research-repo";
import { postings } from "./schema";

// 회사 조사 액션: 지원 공고에서만 조사를 잡고 after()로 돌린다. 회사 키는 서버가 공고에서 만든다
const holder = vi.hoisted(() => ({
  db: null as unknown as import("@/db/types").Db,
  after: [] as (() => unknown)[],
  runResearch: null as unknown as import("vitest").Mock,
}));
vi.mock("@/db", () => ({
  get db() {
    return holder.db;
  },
}));
vi.mock("@/lib/session", () => ({ requireUser: async () => ({ id: "u1", name: "A", isAdmin: false }) }));
vi.mock("@/modules/ai/provider", () => ({ ai: { name: "가짜" } }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/server", () => ({ after: (fn: () => unknown) => holder.after.push(fn) }));
vi.mock("@/modules/postings/research-run", () => ({
  runResearch: (...args: unknown[]) => holder.runResearch(...args),
}));
// 지원 판단(점수 다시 계산)과 문항 채우기는 이 파일이 보는 것이 아니다
vi.mock("@/modules/postings/apply", () => ({ applyWithCurrentScore: async () => ({ ok: true }) }));
vi.mock("@/modules/applications/documents", () => ({ seedQuestionsFromPosting: async () => undefined }));

const actions = await import("./research-actions");
const { applyToPostingAction } = await import("./actions");

const now = new Date();
const key = "가나다";
let trackId: string;

const survey: SurveyInput = {
  name: "백엔드 개발",
  majorCode: "20",
  jobs: [{ ncsCode: null, customName: "백엔드 개발자" }],
  applicantType: "new",
  experienceMonths: 0,
  regions: ["seoul"],
  salaryMin: null,
  employmentTypes: ["regular"],
  importanceOrder: ["jobMatch", "location", "experience", "field", "preferred"],
  extraAnswers: {},
};

async function newTrack(userId: string) {
  const created = await createTrack(holder.db, userId, survey);
  if (!created.ok) throw new Error(created.reason);
  return created.id;
}

async function addPosting(status: "apply" | "interest", userId = "u1") {
  const checked = validatePosting({
    company: "가나다 주식회사",
    title: "백엔드 개발자",
    deadline: "2026-12-10",
    isRolling: false,
    locationText: "",
    regions: [],
    careerType: "new",
    minYears: "",
    employmentType: "regular",
    url: "",
    rawText: "가나다 주식회사 백엔드 개발자 채용",
    companyNote: "",
  });
  if (!checked.ok) throw new Error(JSON.stringify(checked.errors));
  const track = userId === "u1" ? trackId : await newTrack(userId);
  const result = await createPosting(holder.db, userId, track, checked.value);
  if (!result.ok) throw new Error(result.reason);
  await holder.db.update(postings).set({ status }).where(eq(postings.id, result.id));
  return result.id;
}

async function addResearch(userId = "u1") {
  const startedAt = await claimResearch(holder.db, userId, key, "가나다 주식회사", now, { onlyIfMissing: false });
  if (!startedAt) throw new Error("잡지 못함");
  await finishResearch(
    holder.db,
    userId,
    key,
    startedAt,
    {
      talent: { id: "t1", text: "도전", url: "https://gana.co.kr/careers", title: "인재상", verdict: null },
      talentSkipped: false,
      news: [{ id: "n1", summary: "새 공장", date: null, url: "https://news.example.com/1", title: "소식", checked: false }],
    },
    now,
  );
}

beforeEach(async () => {
  holder.db = await createTestDb();
  holder.after = [];
  holder.runResearch = vi.fn(async () => ({ started: true }));
  await holder.db.insert(user).values([
    { id: "u1", name: "A", email: "u1@example.com" },
    { id: "u2", name: "B", email: "u2@example.com" },
  ]);
  trackId = await newTrack("u1");
});

const runAfter = () => Promise.all(holder.after.map((fn) => fn()));

test("다시 조사는 지원 공고에서 뒤로 미뤄 돌리고 바로 돌려준다", async () => {
  const id = await addPosting("apply");
  expect(await actions.rerunResearchAction(id)).toEqual({ ok: true });
  expect(holder.runResearch).not.toHaveBeenCalled();
  expect(holder.after).toHaveLength(1);
  await runAfter();
  expect(holder.runResearch).toHaveBeenCalledWith(holder.db, { name: "가짜" }, "u1", id, { onlyIfMissing: false });
});

test("다시 조사는 지원이 아닌 공고와 남의 공고에서 돌리지 않는다", async () => {
  const interest = await addPosting("interest");
  expect(await actions.rerunResearchAction(interest)).toEqual({ ok: false, message: "지원으로 고른 공고에서만 조사할 수 있습니다" });
  const others = await addPosting("apply", "u2");
  expect(await actions.rerunResearchAction(others)).toEqual({ ok: false, message: "공고를 찾을 수 없습니다" });
  expect(holder.after).toHaveLength(0);
});

test("이미 조사 중이면 다시 조사를 미루지 않는다", async () => {
  const id = await addPosting("apply");
  await claimResearch(holder.db, "u1", key, "가나다 주식회사", new Date(), { onlyIfMissing: true });
  expect(await actions.rerunResearchAction(id)).toEqual({ ok: false, message: "이미 조사 중입니다" });
  expect(holder.after).toHaveLength(0);
});

test("뒤에서 돈 조사가 실패해도 기록만 남기고 던지지 않는다", async () => {
  const id = await addPosting("apply");
  holder.runResearch = vi.fn(async () => {
    throw new Error("연결 끊김");
  });
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  await actions.rerunResearchAction(id);
  await expect(runAfter()).resolves.toBeDefined();
  expect(log).toHaveBeenCalledWith("회사 조사 실패", "연결 끊김");
  log.mockRestore();
});

test("지원하면 조사 줄이 없을 때만 돌도록 뒤로 미룬다", async () => {
  const id = await addPosting("interest");
  expect(await applyToPostingAction(id)).toEqual({ ok: true });
  expect(holder.after).toHaveLength(1);
  await runAfter();
  expect(holder.runResearch).toHaveBeenCalledWith(holder.db, { name: "가짜" }, "u1", id, { onlyIfMissing: true });
});

test("맞음·아님과 소식 체크는 공고의 회사 조사에 바로 저장한다", async () => {
  const id = await addPosting("apply");
  await addResearch();
  expect(await actions.setTalentVerdictAction(id, "t1", "yes")).toEqual({ ok: true });
  expect(await actions.setNewsCheckedAction(id, "n1", true)).toEqual({ ok: true });
  const saved = await getResearch(holder.db, "u1", key);
  expect(saved?.talent?.verdict).toBe("yes");
  expect(saved?.news[0].checked).toBe(true);
  // 다시 누르면 미정
  expect(await actions.setTalentVerdictAction(id, "t1", null)).toEqual({ ok: true });
  expect((await getResearch(holder.db, "u1", key))?.talent?.verdict).toBeNull();
});

test("고르기는 잘못된 값, 지원이 아닌 공고, 조사 중, 없는 항목을 거절한다", async () => {
  const id = await addPosting("apply");
  await addResearch();
  expect(await actions.setTalentVerdictAction(id, "t1", "maybe" as never)).toEqual({ ok: false, message: "조사 결과를 찾을 수 없습니다. 화면을 새로 고쳐 주세요" });
  expect(await actions.setNewsCheckedAction(id, "없는 소식", true)).toEqual({ ok: false, message: "조사 결과를 찾을 수 없습니다. 화면을 새로 고쳐 주세요" });
  const interest = await addPosting("interest");
  expect(await actions.setNewsCheckedAction(interest, "n1", true)).toEqual({ ok: false, message: "지원으로 고른 공고에서만 고를 수 있습니다" });
  await claimResearch(holder.db, "u1", key, "가나다 주식회사", new Date(), { onlyIfMissing: false });
  expect(await actions.setNewsCheckedAction(id, "n1", true)).toEqual({ ok: false, message: "조사 중에는 고를 수 없습니다" });
});

test("남의 공고로는 고르지 못한다", async () => {
  await addResearch("u1");
  const others = await addPosting("apply", "u2");
  expect(await actions.setTalentVerdictAction(others, "t1", "yes")).toEqual({ ok: false, message: "공고를 찾을 수 없습니다" });
  expect((await getResearch(holder.db, "u1", key))?.talent?.verdict).toBeNull();
});
