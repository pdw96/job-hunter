import { z } from "zod";
import type { Db } from "@/db/types";
import { type AiClient, type AiFailure, runAi } from "@/modules/ai/client";
import { listMotiveHooks, type MotiveHook } from "@/modules/experiences/motive-hooks";
import { companyKey } from "@/modules/postings/company";
import { getPosting } from "@/modules/postings/repo";
import { koreaDate } from "@/modules/postings/today";
import { type Answer, createAnswer, listAnswersByIds, listReusable, reusableFor } from "./answers-repo";
import { ANSWER_TOPIC_LABELS, ANSWER_TOPICS, type AnswerTopic, APPLICATION_LIMITS, COMPANY_TOPICS } from "./options";
import { ASK_SYSTEM } from "./prompts";
import { attachAnswerIn, getQuestion, guardedWrite, replaceAsksIn, saveAsks } from "./repo";
import { postingTextOf } from "./select";
import { editBlock } from "./submission-repo";
import { cut } from "./text";
import type { AskItem, Asks, PreviousAnswer } from "./types";

// 묻기: 동기·포부·성장과정처럼 기록에 없는 재료를, 쓰기 전에 고를 수 있는 질문으로 묻고 고른 답을 저장한다.
// 질문을 만들 때 AI는 공고와 확인된 기록(질문 거리로만)을 맞대 연결고리를 찾는다. 지난 답은 같은 주제 질문의 선택지 끝에 붙인다.
// 저장하는 답 글은 서버가 저장해 둔 질문의 선택지에서만 만든다(화면이 보낸 글을 쓰지 않는다)

const askSchema = z.object({
  items: z.array(z.object({ topic: z.string(), link: z.string(), question: z.string(), options: z.array(z.string()) })),
});
type AskRaw = z.infer<typeof askSchema>;

// 질문 번호, 고른 선택지 번호, 고른 지난 답 번호, 기타 한 줄. 모르는 칸(화면이 보낸 글 등)은 버린다
const picksSchema = z.array(
  z.object({
    index: z.number().int().nonnegative(),
    options: z.array(z.number().int()).default([]),
    previous: z.array(z.number().int()).default([]),
    note: z.string().default(""),
  }),
);

export type AskInput = { prompt: string; company: string; title: string; postingText: string; topics: AnswerTopic[]; hooks: MotiveHook[] };

const MAX_LINK = 200;
const PREVIOUS_ONLY = "지난번 답을 다시 쓸까요?";
const MANUAL_QUESTION = "직접 적음";
const HOOK_LABELS: Record<MotiveHook["kind"], string> = { scene: "사례", education: "학력", course: "교육 과정", credential: "자격" };

const notFound = { ok: false as const, reason: "not_found" as const };
const unique = <T>(list: T[]) => [...new Set(list)];
const isTopic = (value: unknown): value is AnswerTopic => (ANSWER_TOPICS as readonly unknown[]).includes(value);
const tidy = (text: string) => text.replace(/\s+/g, " ").trim();
const companyKeyFor = (topic: AnswerTopic, company: string) => (COMPANY_TOPICS.includes(topic) ? companyKey(company) : null);

function describeHook(hook: MotiveHook): string {
  return hook.kind === "scene" ? `- ${HOOK_LABELS.scene}: ${hook.label} — ${hook.detail}` : `- ${HOOK_LABELS[hook.kind]}: ${hook.detail}`;
}

function buildMessage(input: AskInput): string {
  const sections: [string, string][] = [
    ["문항", input.prompt],
    ["물을 주제", input.topics.map((t) => `${t} (${ANSWER_TOPIC_LABELS[t]})`).join("\n")],
    ["회사", input.company],
    ["지원 직무", input.title],
    ["공고", input.postingText],
    ["내 기록", input.hooks.length > 0 ? input.hooks.map(describeHook).join("\n") : "없음"],
  ];
  return sections.map(([label, value]) => `[${label}]\n${value}`).join("\n\n");
}

// 저장하지 않는다. 프롬프트 점검도 이것을 쓴다.
// 요청한 주제가 아닌 항목·빈 질문은 버리고, link는 200자로 자르고, 선택지는 다듬어 중복을 빼고 5개로 자르며,
// 선택지가 2개 미만인 항목은 버리고(keep의 주제는 남긴다: 지난 답을 붙일 질문), 항목은 3개까지. 남는 항목이 없으면 invalid
export async function askText(
  db: Db,
  ai: AiClient,
  userId: string,
  input: AskInput,
  now: Date = new Date(),
  options: { keep?: AnswerTopic[]; onRaw?: (raw: AskRaw) => void } = {},
): Promise<{ ok: true; value: AskItem[] } | { ok: false; reason: "over_limit" | AiFailure }> {
  const result = await runAi(
    db,
    ai,
    userId,
    {
      purpose: "application_ask",
      system: ASK_SYSTEM,
      messages: [{ role: "user", text: buildMessage(input) }],
      schema: askSchema,
      effort: "medium", // 공고와 기록을 맞대 연결고리를 찾는 판단이 든다(고르기와 같은 깊이)
      maxTokens: 8000,
    },
    now,
  );
  if (!result.ok) return { ok: false, reason: result.reason };
  options.onRaw?.(result.value);

  const items: AskItem[] = [];
  for (const raw of result.value.items) {
    if (items.length >= APPLICATION_LIMITS.asks) break;
    const topic = raw.topic.trim();
    if (!isTopic(topic) || !input.topics.includes(topic)) continue;
    const question = cut(tidy(raw.question), APPLICATION_LIMITS.askQuestion);
    if (question === "") continue;
    const choices = unique(raw.options.map((o) => cut(tidy(o), APPLICATION_LIMITS.askOption)).filter((o) => o !== "")).slice(
      0,
      APPLICATION_LIMITS.askOptions,
    );
    if (choices.length < 2 && !options.keep?.includes(topic)) continue;
    items.push({ topic, link: cut(tidy(raw.link), MAX_LINK), question, options: choices, previous: [] });
  }
  return items.length > 0 ? { ok: true, value: items } : { ok: false, reason: "invalid" };
}

// "삼성전자 · 2026-11"(답을 만든 달, 한국 시각)
const previousOf = (answer: Answer): PreviousAnswer => ({
  answerId: answer.id,
  text: answer.answer,
  label: `${answer.company} · ${koreaDate(answer.createdAt).slice(0, 7)}`,
});

// 문항 하나의 질문을 만든다(AI 1번). 지난 답이 있어도 늘 지금의 기록과 새로 대조해 묻는다
export async function makeAsks(
  db: Db,
  ai: AiClient,
  userId: string,
  questionId: string,
  topics: unknown,
  now: Date = new Date(),
): Promise<
  | { ok: true; value: Asks }
  | { ok: false; reason: "not_found" | "not_apply" | "submitted" | "changed" | "not_needed" | "over_limit" | AiFailure }
> {
  const question = await getQuestion(db, userId, questionId);
  if (!question) return notFound;
  const posting = await getPosting(db, userId, question.postingId);
  if (!posting) return notFound;
  const block = await editBlock(db, userId, posting);
  if (block) return { ok: false, reason: block };

  // 화면이 보낸 주제 중 그 문항의 주제에 있는 것만 묻는다
  const asked = Array.isArray(topics) ? topics : [];
  const wanted = ANSWER_TOPICS.filter((t) => asked.includes(t) && (question.topics ?? []).includes(t));
  if (wanted.length === 0) return { ok: false, reason: "not_needed" };

  const key = companyKey(posting.company);
  const [hooks, reusable] = await Promise.all([
    listMotiveHooks(db, userId, posting.trackId),
    listReusable(db, userId, wanted, key, question.answerIds),
  ]);
  const made = await askText(
    db,
    ai,
    userId,
    { prompt: question.prompt, company: posting.company, title: posting.title, postingText: postingTextOf(posting), topics: wanted, hooks },
    now,
    { keep: [...reusable.keys()] },
  );
  if (!made.ok) return made;

  // 같은 주제의 첫 질문 선택지 끝에 지난 답을 붙인다. 그 주제의 질문이 없으면 지난 답만 담은 질문을 더한다
  const items = made.value;
  for (const topic of wanted) {
    const previous = (reusable.get(topic) ?? []).map(previousOf);
    if (previous.length === 0) continue;
    const first = items.find((x) => x.topic === topic);
    if (first) first.previous = previous;
    else items.push({ topic, link: "", question: PREVIOUS_ONLY, options: [], previous });
  }
  const value: Asks = {
    questionVersion: question.version,
    items: items.filter((x) => x.options.length >= 2 || x.previous.length > 0),
    madeAt: now.toISOString(),
  };
  // 읽었을 때의 문항 글 그대로일 때만 저장한다(그사이 고쳤으면 changed)
  const saved = await saveAsks(db, userId, questionId, value);
  return saved.ok ? { ok: true, value } : saved;
}

// 고른 답을 저장한다. 새 선택지·기타는 새 답으로, 지난 답은 그 id를 그대로 붙인다. 답한 항목은 asks에서 뺀다.
// 확인과 저장이 모두 공고 잠금 안의 한 트랜잭션이다
export async function answerAsks(
  db: Db,
  userId: string,
  questionId: string,
  picks: unknown,
  now: Date = new Date(),
): Promise<{ ok: true; added: number } | { ok: false; reason: "not_found" | "not_apply" | "submitted" | "changed" | "empty" | "too_many" }> {
  const parsed = picksSchema.safeParse(picks);
  const wanted = parsed.success ? parsed.data : [];
  return guardedWrite(db, userId, questionId, async (tx) => {
    const question = await getQuestion(tx, userId, questionId);
    if (!question) return notFound;
    const asks = question.asks;
    if (!asks || asks.questionVersion !== question.version) return { ok: false as const, reason: "changed" as const };
    const posting = await getPosting(tx, userId, question.postingId);
    if (!posting) return notFound;
    const key = companyKey(posting.company);
    const topics = question.topics ?? [];

    // 고른 지난 답은 지금도 내 답이고 이 문항에 붙일 수 있는지 다시 본다
    const pickedPrevious = wanted.flatMap((pick) => asks.items[pick.index]?.previous.filter((_, i) => pick.previous.includes(i)) ?? []);
    const owned = new Map((await listAnswersByIds(tx, userId, unique(pickedPrevious.map((p) => p.answerId)))).map((a) => [a.id, a]));

    const plans: { index: number; topic: AnswerTopic; question: string; text: string; previous: string[] }[] = [];
    for (const pick of wanted) {
      const item = asks.items[pick.index];
      if (!item || !topics.includes(item.topic) || plans.some((p) => p.index === pick.index)) continue;
      const chosen = item.options.filter((_, i) => pick.options.includes(i));
      const note = cut(pick.note.trim(), APPLICATION_LIMITS.note);
      const text = cut([...chosen, note].filter((part) => part !== "").join("\n"), APPLICATION_LIMITS.answer);
      const previous = unique(
        item.previous
          .filter((_, i) => pick.previous.includes(i))
          .map((p) => owned.get(p.answerId))
          .filter((a): a is Answer => !!a && reusableFor(a, item.topic, key))
          .map((a) => a.id),
      );
      if (text === "" && previous.length === 0) continue;
      plans.push({ index: pick.index, topic: item.topic, question: item.question, text, previous });
    }
    if (plans.length === 0) return { ok: false as const, reason: "empty" as const };

    // 붙일 답 수를 먼저 세어, 넘치면 아무것도 만들지 않는다
    const attached = new Set(question.answerIds);
    const reused = unique(plans.flatMap((p) => p.previous)).filter((id) => !attached.has(id));
    const created = plans.filter((p) => p.text !== "").length;
    if (attached.size + reused.length + created > APPLICATION_LIMITS.answersPerQuestion) return { ok: false as const, reason: "too_many" as const };

    let added = 0;
    const attach = async (answerId: string) => {
      const result = await attachAnswerIn(tx, userId, questionId, answerId);
      if (!result.ok) throw new Error(`답을 붙이지 못했습니다: ${result.reason}`); // 위에서 확인했으므로 일어나지 않는다. 던져서 모두 되돌린다
      added += 1;
    };
    for (const plan of plans) {
      for (const answerId of plan.previous) {
        if (attached.has(answerId)) continue;
        attached.add(answerId);
        await attach(answerId);
      }
      if (plan.text !== "") {
        const answerId = await createAnswer(
          tx,
          userId,
          {
            topic: plan.topic,
            question: plan.question,
            answer: plan.text,
            postingId: posting.id,
            company: posting.company,
            companyKey: companyKeyFor(plan.topic, posting.company),
          },
          now,
        );
        await attach(answerId);
      }
    }
    const answered = new Set(plans.map((p) => p.index));
    const rest = asks.items.filter((_, i) => !answered.has(i));
    await replaceAsksIn(tx, userId, questionId, rest.length > 0 ? { ...asks, items: rest } : null);
    return { ok: true as const, added };
  });
}

// 직접 적기: 새 답을 만들어 붙인다(AI를 부르지 않는다). 주제는 문항의 주제에 있어야 한다
export async function writeAnswer(
  db: Db,
  userId: string,
  questionId: string,
  topic: unknown,
  text: string,
  now: Date = new Date(),
): Promise<{ ok: true } | { ok: false; reason: "not_found" | "not_apply" | "submitted" | "empty" | "too_long" | "not_needed" | "too_many" }> {
  const question = await getQuestion(db, userId, questionId);
  if (!question) return notFound;
  if (!isTopic(topic) || !(question.topics ?? []).includes(topic)) return { ok: false, reason: "not_needed" };
  const clean = typeof text === "string" ? text.trim() : "";
  if (clean === "") return { ok: false, reason: "empty" };
  if ([...clean].length > APPLICATION_LIMITS.answer) return { ok: false, reason: "too_long" };

  return guardedWrite(db, userId, questionId, async (tx) => {
    const fresh = await getQuestion(tx, userId, questionId);
    if (!fresh) return notFound;
    if (!(fresh.topics ?? []).includes(topic)) return { ok: false as const, reason: "not_needed" as const };
    if (fresh.answerIds.length >= APPLICATION_LIMITS.answersPerQuestion) return { ok: false as const, reason: "too_many" as const };
    const posting = await getPosting(tx, userId, fresh.postingId);
    if (!posting) return notFound;
    const answerId = await createAnswer(
      tx,
      userId,
      { topic, question: MANUAL_QUESTION, answer: clean, postingId: posting.id, company: posting.company, companyKey: companyKeyFor(topic, posting.company) },
      now,
    );
    const attached = await attachAnswerIn(tx, userId, questionId, answerId);
    if (!attached.ok) throw new Error(`답을 붙이지 못했습니다: ${attached.reason}`);
    return { ok: true as const };
  });
}
