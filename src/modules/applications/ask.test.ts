import { count, eq } from "drizzle-orm";
import { beforeEach, expect, test } from "vitest";
import { createTestDb } from "@/db/test-db";
import type { Db } from "@/db/types";
import type { AiRequest } from "@/modules/ai/client";
import { createFakeAi } from "@/modules/ai/fake-client";
import { user } from "@/modules/auth/schema";
import { createFact } from "@/modules/experiences/facts-repo";
import type { CourseInput } from "@/modules/experiences/record-input";
import type { AppliedScore, PostingAnalysis } from "@/modules/postings/analysis";
import { validatePosting } from "@/modules/postings/input";
import { applyToPosting, createPosting, getPosting, saveAnalysis } from "@/modules/postings/repo";
import { createTrack } from "@/modules/tracks/repo";
import type { SurveyInput } from "@/modules/tracks/survey";
import { createAnswer, listAnswersByIds } from "./answers-repo";
import { answerAsks, askText, makeAsks, writeAnswer } from "./ask";
import type { AnswerTopic } from "./options";
import { addQuestions, detachAnswer, getQuestion, updateQuestion } from "./repo";
import { answers, questions } from "./schema";
import { submitPosting } from "./submit";

let db: Db;
let trackId: string;
let otherTrack: string;
const now = new Date("2026-11-23T03:00:00Z");

const survey: SurveyInput = {
  name: "백엔드 개발",
  majorCode: "20",
  jobs: [{ ncsCode: "20010202", customName: null }],
  applicantType: "experienced",
  experienceMonths: 30,
  regions: ["seoul"],
  salaryMin: null,
  employmentTypes: ["regular"],
  importanceOrder: ["jobMatch", "location", "experience", "field", "preferred"],
  extraAnswers: {},
};
const rawText = "(주)가나다테크 백엔드 개발자 채용\n담당 업무\n- 주문·결제 서비스 API 개발\n문의 hr@ganada.example";
const raw = (company: string) => ({
  company,
  title: "백엔드 개발자",
  deadline: "2026-11-30",
  isRolling: false,
  locationText: "서울 강남구",
  regions: ["seoul"],
  careerType: "experienced",
  minYears: 3,
  employmentType: "regular",
  url: null,
  rawText,
  companyNote: "",
});
const analysis: PostingAnalysis = {
  target: "개발",
  requirements: [],
  field: { level: "same_job", reason: "분야가 같다" },
  analyzedAt: "2026-11-18T00:00:00.000Z",
};
const score: AppliedScore = {
  desire: 50,
  fit: 50,
  criteria: {} as AppliedScore["criteria"],
  analyzedAt: "2026-11-18T00:00:00.000Z",
  appliedAt: "2026-11-18T00:00:00.000Z",
};
const course: CourseInput = {
  name: "Kotlin 백엔드 개발 과정",
  institution: "나다아카데미",
  startMonth: "2021-03",
  endMonth: "2021-08",
  hours: 600,
  learned: "주문 API를 만들었다",
};

async function addPosting(company = "(주)가나다테크", userId = "u1") {
  const checked = validatePosting(raw(company));
  if (!checked.ok) throw new Error("공고 입력 오류");
  const created = await createPosting(db, userId, userId === "u1" ? trackId : otherTrack, checked.value);
  if (!created.ok) throw new Error(created.reason);
  const saved = await saveAnalysis(db, userId, created.id, analysis, { rawText, companyNote: null });
  if (!saved.ok) throw new Error(saved.reason);
  const posting = await getPosting(db, userId, created.id);
  if (!posting) throw new Error("없음");
  const applied = await applyToPosting(db, userId, created.id, score, { ...posting, analysis });
  if (!applied.ok) throw new Error(applied.reason);
  return created.id;
}

async function addQuestion(topics: AnswerTopic[] = ["motive"], company?: string) {
  const postingId = await addPosting(company);
  const kinds = topics.some((t) => t === "motive" || t === "aspiration") ? (["motive"] as const) : (["self"] as const);
  const added = await addQuestions(db, "u1", postingId, [
    { prompt: "지원 동기를 적어 주세요", charLimit: 500, countSpaces: true, kinds: [...kinds], topics },
  ]);
  if (!added.ok) throw new Error(added.reason);
  return { postingId, id: added.ids[0] };
}

type Item = { topic: string; link: string; question: string; options: string[] };
const item = (over: Partial<Item> = {}): Item => ({
  topic: "motive",
  link: "",
  question: "이 직무를 고른 이유는 무엇인가요?",
  options: ["주문·결제처럼 매일 쓰는 서비스를 만들고 싶다", "백엔드를 더 깊게 하고 싶다", "아직 잘 모르겠다"],
  ...over,
});
const fakeAi = (...items: Item[][]) => createFakeAi(items.map((list) => ({ items: list })));

async function asked(id: string, topics: AnswerTopic[], ...items: Item[][]) {
  const result = await makeAsks(db, fakeAi(...items), "u1", id, topics, now);
  if (!result.ok) throw new Error(result.reason);
  return result.value;
}
const answerCount = async () => (await db.select({ value: count() }).from(answers))[0].value;

beforeEach(async () => {
  delete process.env.AI_MONTHLY_LIMIT_USD;
  db = await createTestDb();
  await db.insert(user).values([
    { id: "u1", name: "홍길동", email: "u1@example.com" },
    { id: "u2", name: "B", email: "u2@example.com" },
  ]);
  const mine = await createTrack(db, "u1", survey);
  const theirs = await createTrack(db, "u2", survey);
  if (!mine.ok || !theirs.ok) throw new Error("트랙을 만들지 못함");
  trackId = mine.id;
  otherTrack = theirs.id;
});

// 질문 만들기

test("요청하지 않은 주제의 질문은 버린다", async () => {
  const { id } = await addQuestion(["motive"]);
  const asks = await asked(id, ["motive"], [item(), item({ topic: "growth" }), item({ topic: "모름" })]);
  expect(asks.items.map((x) => x.topic)).toEqual(["motive"]);
  expect((await getQuestion(db, "u1", id))?.asks).toEqual(asks);
  expect(asks).toMatchObject({ questionVersion: 0, madeAt: now.toISOString() });
});

test("선택지 6개는 5개로, 1개뿐인 질문은 버린다", async () => {
  const { id } = await addQuestion(["motive"]);
  const six = ["가", "나", "다", "라", "마", "바"];
  const asks = await asked(id, ["motive"], [item({ options: six }), item({ question: "하나뿐", options: ["가", " 가 ", ""] })]);
  expect(asks.items).toHaveLength(1);
  expect(asks.items[0].options).toEqual(["가", "나", "다", "라", "마"]);
});

test("질문은 3개까지이고, 남는 질문이 없으면 invalid이며 asks는 그대로다", async () => {
  const { id } = await addQuestion(["motive"]);
  const asks = await asked(id, ["motive"], [item(), item(), item(), item()]);
  expect(asks.items).toHaveLength(3);
  const result = await makeAsks(db, fakeAi([item({ options: ["하나"] })]), "u1", id, ["motive"], now);
  expect(result).toEqual({ ok: false, reason: "invalid" });
  expect((await getQuestion(db, "u1", id))?.asks).toEqual(asks);
});

test("AI 호출이 실패하면 그 까닭을 돌려주고 asks를 바꾸지 않는다", async () => {
  const { id } = await addQuestion(["motive"]);
  const result = await makeAsks(db, createFakeAi([{ fail: "refused" }]), "u1", id, ["motive"], now);
  expect(result).toEqual({ ok: false, reason: "refused" });
  expect((await getQuestion(db, "u1", id))?.asks).toBeNull();
});

test("AI에 보내는 글에 [내 기록]이 있고 확인되지 않은 기록은 없다", async () => {
  const { id } = await addQuestion(["motive"]);
  await createFact(db, "u1", "course", course, { confirmed: true });
  await createFact(db, "u1", "course", { ...course, name: "비밀 미확인 과정" }, { confirmed: false });
  const ai = fakeAi([item()]);
  await makeAsks(db, ai, "u1", id, ["motive"], now);
  expect(ai.requests).toHaveLength(1);
  expect(ai.requests[0].purpose).toBe("application_ask");
  const text = ai.requests[0].messages[0].text;
  expect(text).toContain("[내 기록]");
  expect(text).toContain("Kotlin 백엔드 개발 과정");
  expect(text).toContain("지원 동기를 적어 주세요");
  expect(text).toContain("주문·결제 서비스 API 개발");
  expect(text).not.toContain("비밀 미확인 과정");
  // 이메일·이름·사용자 id는 보내지 않는다
  expect(text).not.toContain("hr@ganada.example");
  expect(text).not.toContain("홍길동");
  expect(text).not.toContain("u1");
});

test("기록이 없으면 [내 기록]은 없음이다", async () => {
  const { id } = await addQuestion(["motive"]);
  const ai = fakeAi([item()]);
  await makeAsks(db, ai, "u1", id, ["motive"], now);
  expect(ai.requests[0].messages[0].text).toContain("[내 기록]\n없음");
});

test("link는 200자로 자른다", async () => {
  const result = await askText(
    db,
    fakeAi([item({ link: "가".repeat(250), question: "  물음  " })]),
    "u1",
    { prompt: "지원 동기", company: "가나다", title: "개발자", postingText: "공고", topics: ["motive"], hooks: [] },
    now,
  );
  if (!result.ok) throw new Error(result.reason);
  expect([...result.value[0].link]).toHaveLength(200);
  expect(result.value[0]).toMatchObject({ question: "물음", previous: [] });
});

test("문항 topics에 없는 주제를 보내면 not_needed", async () => {
  const { id } = await addQuestion(["motive"]);
  const ai = fakeAi([item()]);
  expect(await makeAsks(db, ai, "u1", id, ["growth"], now)).toEqual({ ok: false, reason: "not_needed" });
  expect(await makeAsks(db, ai, "u1", id, "motive", now)).toEqual({ ok: false, reason: "not_needed" });
  expect(ai.requests).toHaveLength(0);
});

test("질문을 만드는 사이 문항 글을 고쳤으면 changed", async () => {
  const { id } = await addQuestion(["motive"]);
  const ai = createFakeAi([
    async () => {
      await updateQuestion(db, "u1", id, { prompt: "바뀐 문항", charLimit: 500, countSpaces: true });
      return { items: [item()] };
    },
  ]);
  expect(await makeAsks(db, ai, "u1", id, ["motive"], now)).toEqual({ ok: false, reason: "changed" });
  expect((await getQuestion(db, "u1", id))?.asks).toBeNull();
});

test("남의 문항은 not_found", async () => {
  const { id } = await addQuestion(["motive"]);
  expect(await makeAsks(db, fakeAi([item()]), "u2", id, ["motive"], now)).toEqual({ ok: false, reason: "not_found" });
});

// 지난 답

test("늘 AI를 불러 새로 묻고, 같은 회사의 지난 지원동기를 그 질문의 previous에 붙인다", async () => {
  const before = await createAnswer(
    db,
    "u1",
    { topic: "motive", question: "왜?", answer: "지난 지원동기", postingId: null, company: "가나다테크 주식회사", companyKey: "가나다테크" },
    new Date("2026-10-31T16:00:00Z"), // 한국 시각으로 11월 1일
  );
  const { id } = await addQuestion(["motive"]);
  const ai = fakeAi([item(), item({ question: "둘째 질문" })]);
  const result = await makeAsks(db, ai, "u1", id, ["motive"], now);
  if (!result.ok) throw new Error(result.reason);
  expect(ai.requests).toHaveLength(1);
  expect(result.value.items[0].previous).toEqual([{ answerId: before, text: "지난 지원동기", label: "가나다테크 주식회사 · 2026-11" }]);
  expect(result.value.items[1].previous).toEqual([]);
});

test("다른 회사의 지원동기는 previous에 붙지 않고 성장과정은 붙는다", async () => {
  await createAnswer(db, "u1", { topic: "motive", question: "왜?", answer: "라마바 지원동기", postingId: null, company: "라마바", companyKey: "라마바" }, now);
  const growthId = await createAnswer(db, "u1", { topic: "growth", question: "어떻게?", answer: "성장 답", postingId: null, company: "라마바", companyKey: null }, now);
  const { id } = await addQuestion(["motive", "growth"]);
  const asks = await asked(id, ["motive", "growth"], [item(), item({ topic: "growth", question: "성장 질문" })]);
  expect(asks.items.map((x) => [x.topic, x.previous.map((p) => p.answerId)])).toEqual([
    ["motive", []],
    ["growth", [growthId]],
  ]);
});

test("AI가 그 주제의 질문을 만들지 않았으면 지난 답만 담은 질문을 더한다", async () => {
  const growthId = await createAnswer(db, "u1", { topic: "growth", question: "어떻게?", answer: "성장 답", postingId: null, company: "라마바", companyKey: null }, now);
  const { id } = await addQuestion(["motive", "growth"]);
  const asks = await asked(id, ["motive", "growth"], [item()]);
  expect(asks.items).toHaveLength(2);
  expect(asks.items[1]).toEqual({
    id: expect.any(String),
    topic: "growth",
    link: "",
    question: "지난번 답을 다시 쓸까요?",
    options: [],
    previous: [{ answerId: growthId, text: "성장 답", label: "라마바 · 2026-11" }],
  });
});

test("지난 답이 있는 주제의 질문은 선택지가 2개 미만이어도 남는다", async () => {
  await createAnswer(db, "u1", { topic: "growth", question: "어떻게?", answer: "성장 답", postingId: null, company: "라마바", companyKey: null }, now);
  const { id } = await addQuestion(["growth"]);
  const asks = await asked(id, ["growth"], [item({ topic: "growth", question: "성장 질문", options: ["하나"] })]);
  expect(asks.items).toHaveLength(1);
  expect(asks.items[0]).toMatchObject({ question: "성장 질문", options: ["하나"] });
  expect(asks.items[0].previous).toHaveLength(1);
});

test("이미 붙인 답은 지난 답으로 다시 보이지 않는다", async () => {
  const { id } = await addQuestion(["growth"]);
  expect(await writeAnswer(db, "u1", id, "growth", "직접 적은 답")).toEqual({ ok: true });
  const asks = await asked(id, ["growth"], [item({ topic: "growth" })]);
  expect(asks.items[0].previous).toEqual([]);
});

// 답 저장

test("answerAsks는 저장된 선택지 글로 답을 만든다(화면이 보낸 글은 쓰지 않음)", async () => {
  const { id, postingId } = await addQuestion(["motive"]);
  const asks = await asked(id, ["motive"], [item()]);
  const picks = [{ id: asks.items[0].id, options: [1], previous: [], note: "", text: "화면이 바꾼 글", options_text: ["가짜"] }];
  expect(await answerAsks(db, "u1", id, picks, now)).toEqual({ ok: true, added: 1 });
  const question = await getQuestion(db, "u1", id);
  const [answer] = await listAnswersByIds(db, "u1", question?.answerIds ?? []);
  expect(answer).toMatchObject({
    topic: "motive",
    question: "이 직무를 고른 이유는 무엇인가요?",
    answer: "백엔드를 더 깊게 하고 싶다",
    postingId,
    company: "(주)가나다테크",
  });
});

test("고른 선택지 둘과 기타를 줄바꿈으로 잇는다", async () => {
  const { id } = await addQuestion(["motive"]);
  const asks = await asked(id, ["motive"], [item()]);
  await answerAsks(db, "u1", id, [{ id: asks.items[0].id, options: [2, 0, 0, 9], previous: [], note: "  결제 장애를 겪어 봐서  " }], now);
  const [answer] = await listAnswersByIds(db, "u1", (await getQuestion(db, "u1", id))?.answerIds ?? []);
  expect(answer.answer).toBe("주문·결제처럼 매일 쓰는 서비스를 만들고 싶다\n아직 잘 모르겠다\n결제 장애를 겪어 봐서");
});

test("기타만 적어도 답이 된다. 아무것도 고르지 않으면 empty", async () => {
  const { id } = await addQuestion(["motive"]);
  const asks = await asked(id, ["motive"], [item()]);
  expect(await answerAsks(db, "u1", id, [{ id: asks.items[0].id, options: [], previous: [], note: "   " }], now)).toEqual({ ok: false, reason: "empty" });
  expect(await answerAsks(db, "u1", id, "엉뚱한 값", now)).toEqual({ ok: false, reason: "empty" });
  expect(await answerAsks(db, "u1", id, [{ id: asks.items[0].id, options: [], previous: [], note: "내 말" }], now)).toEqual({ ok: true, added: 1 });
});

test("asks.questionVersion이 다르면 changed", async () => {
  const { id } = await addQuestion(["motive"]);
  const asks = await asked(id, ["motive"], [item()]);
  await db.update(questions).set({ version: 3 }).where(eq(questions.id, id));
  expect(await answerAsks(db, "u1", id, [{ id: asks.items[0].id, options: [0], previous: [], note: "" }], now)).toEqual({ ok: false, reason: "changed" });
  expect(await answerCount()).toBe(0);
});

test("질문이 없으면(문항 글을 고쳐 지워졌으면) changed", async () => {
  const { id } = await addQuestion(["motive"]);
  const asks = await asked(id, ["motive"], [item()]);
  await updateQuestion(db, "u1", id, { prompt: "바뀐 문항", charLimit: 500, countSpaces: true });
  expect(await answerAsks(db, "u1", id, [{ id: asks.items[0].id, options: [0], previous: [], note: "" }], now)).toEqual({ ok: false, reason: "changed" });
});

test("지원동기 답에는 companyKey가 담기고 성장과정 답에는 없다", async () => {
  const { id } = await addQuestion(["motive", "growth"]);
  const asks = await asked(id, ["motive", "growth"], [item(), item({ topic: "growth", question: "성장 질문" })]);
  const result = await answerAsks(
    db,
    "u1",
    id,
    [
      { id: asks.items[0].id, options: [0], previous: [], note: "" },
      { id: asks.items[1].id, options: [1], previous: [], note: "" },
    ],
    now,
  );
  expect(result).toEqual({ ok: true, added: 2 });
  const list = await listAnswersByIds(db, "u1", (await getQuestion(db, "u1", id))?.answerIds ?? []);
  expect(list.map((a) => [a.topic, a.companyKey])).toEqual([
    ["motive", "가나다테크"],
    ["growth", null],
  ]);
});

test("답한 항목은 asks에서 빠진다", async () => {
  const { id } = await addQuestion(["motive"]);
  const asks = await asked(id, ["motive"], [item(), item({ question: "둘째 질문" })]);
  await answerAsks(db, "u1", id, [{ id: asks.items[0].id, options: [0], previous: [], note: "" }], now);
  const after = await getQuestion(db, "u1", id);
  expect(after?.asks?.items.map((x) => x.question)).toEqual(["둘째 질문"]);
  await answerAsks(db, "u1", id, [{ id: asks.items[1].id, options: [1], previous: [], note: "" }], now);
  const done = await getQuestion(db, "u1", id);
  expect(done?.asks).toBeNull();
  expect(done?.answerIds).toHaveLength(2);
});

test("지난 답을 고르면 새 행 없이 그 id를 붙인다", async () => {
  const growthId = await createAnswer(db, "u1", { topic: "growth", question: "어떻게?", answer: "성장 답", postingId: null, company: "라마바", companyKey: null }, now);
  const { id } = await addQuestion(["growth"]);
  const asks = await asked(id, ["growth"], [item({ topic: "growth" })]);
  expect(await answerCount()).toBe(1);
  expect(await answerAsks(db, "u1", id, [{ id: asks.items[0].id, options: [], previous: [0, 5], note: "" }], now)).toEqual({ ok: true, added: 1 });
  expect(await answerCount()).toBe(1);
  expect((await getQuestion(db, "u1", id))?.answerIds).toEqual([growthId]);
});

test("지난 답과 새 선택지를 함께 고르면 둘 다 붙는다", async () => {
  const growthId = await createAnswer(db, "u1", { topic: "growth", question: "어떻게?", answer: "성장 답", postingId: null, company: "라마바", companyKey: null }, now);
  const { id } = await addQuestion(["growth"]);
  const asks = await asked(id, ["growth"], [item({ topic: "growth" })]);
  expect(await answerAsks(db, "u1", id, [{ id: asks.items[0].id, options: [0], previous: [0], note: "" }], now)).toEqual({ ok: true, added: 2 });
  const ids = (await getQuestion(db, "u1", id))?.answerIds ?? [];
  expect(ids).toHaveLength(2);
  expect(ids).toContain(growthId);
  expect(await answerCount()).toBe(2);
});

test("지금 붙일 수 없는 지난 답(남의 답)은 건너뛴다", async () => {
  const { id } = await addQuestion(["growth"]);
  await asked(id, ["growth"], [item({ topic: "growth" })]);
  const theirs = await createAnswer(db, "u2", { topic: "growth", question: "?", answer: "남의 답", postingId: null, company: "라마바", companyKey: null }, now);
  const question = await getQuestion(db, "u1", id);
  const asks = question!.asks!;
  const forged = { ...asks, items: [{ ...asks.items[0], previous: [{ answerId: theirs, text: "남의 답", label: "라마바 · 2026-11" }] }] };
  await db.update(questions).set({ asks: forged }).where(eq(questions.id, id));
  expect(await answerAsks(db, "u1", id, [{ id: asks.items[0].id, options: [], previous: [0], note: "" }], now)).toEqual({ ok: false, reason: "empty" });
  expect((await getQuestion(db, "u1", id))?.answerIds).toEqual([]);
});

test("붙인 답이 6개를 넘으면 too_many이고 아무것도 만들지 않는다", async () => {
  const { id } = await addQuestion(["growth"]);
  for (let i = 0; i < 6; i++) expect(await writeAnswer(db, "u1", id, "growth", `답 ${i}`)).toEqual({ ok: true });
  expect(await writeAnswer(db, "u1", id, "growth", "일곱째")).toEqual({ ok: false, reason: "too_many" });
  const asks = await asked(id, ["growth"], [item({ topic: "growth" })]);
  expect(await answerAsks(db, "u1", id, [{ id: asks.items[0].id, options: [0], previous: [], note: "" }], now)).toEqual({ ok: false, reason: "too_many" });
  expect(await answerCount()).toBe(6);
});

// 직접 적기

test("writeAnswer는 '직접 적음' 답을 만들어 붙인다", async () => {
  const { id } = await addQuestion(["motive"]);
  expect(await writeAnswer(db, "u1", id, "motive", "  매일 쓰는 서비스를 만들고 싶다  ")).toEqual({ ok: true });
  const [answer] = await listAnswersByIds(db, "u1", (await getQuestion(db, "u1", id))?.answerIds ?? []);
  expect(answer).toMatchObject({ topic: "motive", question: "직접 적음", answer: "매일 쓰는 서비스를 만들고 싶다", companyKey: "가나다테크" });
});

test("writeAnswer의 빈 글은 empty, 1001자는 too_long", async () => {
  const { id } = await addQuestion(["motive"]);
  expect(await writeAnswer(db, "u1", id, "motive", "   ")).toEqual({ ok: false, reason: "empty" });
  expect(await writeAnswer(db, "u1", id, "motive", "가".repeat(1001))).toEqual({ ok: false, reason: "too_long" });
  expect(await writeAnswer(db, "u1", id, "motive", "가".repeat(1000))).toEqual({ ok: true });
  expect(await writeAnswer(db, "u1", id, "growth", "주제가 다름")).toEqual({ ok: false, reason: "not_needed" });
  expect(await writeAnswer(db, "u2", id, "motive", "남의 문항")).toEqual({ ok: false, reason: "not_found" });
});

test("detachAnswer는 답을 떼고 답 행은 남긴다", async () => {
  const { id } = await addQuestion(["motive"]);
  await writeAnswer(db, "u1", id, "motive", "답");
  const [answerId] = (await getQuestion(db, "u1", id))?.answerIds ?? [];
  expect(await detachAnswer(db, "u1", id, answerId)).toEqual({ ok: true });
  expect((await getQuestion(db, "u1", id))?.answerIds).toEqual([]);
  expect(await answerCount()).toBe(1);
});

test("잠긴 공고는 submitted", async () => {
  const { id, postingId } = await addQuestion(["motive"]);
  const asks = await asked(id, ["motive"], [item()]);
  await writeAnswer(db, "u1", id, "motive", "답");
  const [answerId] = (await getQuestion(db, "u1", id))?.answerIds ?? [];
  expect(await submitPosting(db, "u1", postingId, 0)).toEqual({ ok: true, number: 1 });
  const ai = fakeAi([item()]);
  expect(await makeAsks(db, ai, "u1", id, ["motive"], now)).toEqual({ ok: false, reason: "submitted" });
  expect(ai.requests).toHaveLength(0);
  expect(await answerAsks(db, "u1", id, [{ id: asks.items[0].id, options: [0], previous: [], note: "" }], now)).toEqual({ ok: false, reason: "submitted" });
  expect(await writeAnswer(db, "u1", id, "motive", "더")).toEqual({ ok: false, reason: "submitted" });
  expect(await detachAnswer(db, "u1", id, answerId)).toEqual({ ok: false, reason: "submitted" });
  expect(await answerCount()).toBe(1);
});

// 보내는 주제 목록에 요청한 주제만 담긴다
test("AI에 묻는 주제는 화면이 보낸 것 중 문항에 있는 것만이다", async () => {
  const { id } = await addQuestion(["motive", "growth"]);
  let sent = "";
  const ai = createFakeAi([
    (request: AiRequest<unknown>) => {
      sent = request.messages[0].text;
      return { items: [item()] };
    },
  ]);
  await makeAsks(db, ai, "u1", id, ["motive", "values", 3], now);
  const topicSection = sent.split("[물을 주제]\n")[1]?.split("\n\n")[0] ?? "";
  expect(topicSection).toContain("motive");
  expect(topicSection).not.toContain("growth");
  expect(topicSection).not.toContain("values");
});

// 질문 id

test("질문마다 다른 id가 있다", async () => {
  const growthId = await createAnswer(db, "u1", { topic: "growth", question: "어떻게?", answer: "성장 답", postingId: null, company: "라마바", companyKey: null }, now);
  const { id } = await addQuestion(["motive", "growth"]);
  const asks = await asked(id, ["motive", "growth"], [item(), item({ question: "둘째 질문" })]);
  expect(asks.items.map((x) => x.previous.map((p) => p.answerId))).toEqual([[], [], [growthId]]);
  const ids = asks.items.map((x) => x.id);
  expect(new Set(ids).size).toBe(3);
  expect(ids.every((x) => typeof x === "string" && x.length > 0)).toBe(true);
});

test("같은 답을 두 번 저장하면 두 번째는 changed", async () => {
  const { id } = await addQuestion(["motive"]);
  const asks = await asked(id, ["motive"], [item(), item({ question: "둘째 질문", options: ["다른 가", "다른 나", "다른 다"] })]);
  const picks = [{ id: asks.items[0].id, options: [0], previous: [], note: "" }];
  expect(await answerAsks(db, "u1", id, picks, now)).toEqual({ ok: true, added: 1 });
  // 첫 질문이 빠져 둘째 질문이 앞으로 와도, 옛 picks가 둘째 질문의 선택지로 저장되지 않는다
  expect(await answerAsks(db, "u1", id, picks, now)).toEqual({ ok: false, reason: "changed" });
  expect(await answerCount()).toBe(1);
  expect((await getQuestion(db, "u1", id))?.asks?.items.map((x) => x.question)).toEqual(["둘째 질문"]);
});

test("질문을 다시 받은 뒤 옛 질문의 picks는 changed", async () => {
  const { id } = await addQuestion(["motive"]);
  const old = await asked(id, ["motive"], [item()]);
  await asked(id, ["motive"], [item({ question: "새 질문" })]);
  expect(await answerAsks(db, "u1", id, [{ id: old.items[0].id, options: [0], previous: [], note: "" }], now)).toEqual({ ok: false, reason: "changed" });
  expect(await answerCount()).toBe(0);
});

test("기타는 한 줄로 줄이고, 음수 번호나 너무 많은 번호는 받지 않는다", async () => {
  const { id } = await addQuestion(["motive"]);
  const asks = await asked(id, ["motive"], [item(), item({ question: "둘째 질문" })]);
  const first = asks.items[0].id;
  expect(await answerAsks(db, "u1", id, [{ id: first, options: [-1], previous: [], note: "" }], now)).toEqual({ ok: false, reason: "empty" });
  expect(await answerAsks(db, "u1", id, [{ id: first, options: [0, 1, 2, 3, 4, 5], previous: [], note: "" }], now)).toEqual({ ok: false, reason: "empty" });
  expect(await answerAsks(db, "u1", id, [{ id: first, options: [], previous: [0, 1, 2], note: "" }], now)).toEqual({ ok: false, reason: "empty" });
  expect(await answerAsks(db, "u1", id, [{ id: first, options: [], previous: [], note: "첫 줄\n\n  둘째   줄" }], now)).toEqual({ ok: true, added: 1 });
  const [answer] = await listAnswersByIds(db, "u1", (await getQuestion(db, "u1", id))?.answerIds ?? []);
  expect(answer.answer).toBe("첫 줄 둘째 줄");
});

test("AI 답이 모두 버려져도 지난 답이 있으면 지난 답만 담은 질문을 저장한다", async () => {
  const growthId = await createAnswer(db, "u1", { topic: "growth", question: "어떻게?", answer: "성장 답", postingId: null, company: "라마바", companyKey: null }, now);
  const { id } = await addQuestion(["motive", "growth"]);
  const result = await makeAsks(db, fakeAi([item({ topic: "모름" })]), "u1", id, ["motive", "growth"], now);
  if (!result.ok) throw new Error(result.reason);
  expect(result.value.items).toEqual([
    { id: expect.any(String), topic: "growth", link: "", question: "지난번 답을 다시 쓸까요?", options: [], previous: [{ answerId: growthId, text: "성장 답", label: "라마바 · 2026-11" }] },
  ]);
  expect((await getQuestion(db, "u1", id))?.asks).toEqual(result.value);
  // 한도·연결 실패는 그대로 실패다
  expect(await makeAsks(db, createFakeAi([{ fail: "unavailable" }]), "u1", id, ["growth"], now)).toEqual({ ok: false, reason: "unavailable" });
});
