import type { Db } from "@/db/types";
import type { AiClient } from "@/modules/ai/client";
import { numbersIn } from "@/modules/experiences/grounding";
import type { MotiveHook } from "@/modules/experiences/motive-hooks";
import type { CheckRow } from "@/modules/experiences/prompt-check";
import type { WritingSource } from "@/modules/experiences/writing";
import { FULL_POSTING } from "@/modules/postings/prompt-check";
import { type CompanyFact, factNumbers } from "@/modules/postings/research";
import type { Answer } from "./answers-repo";
import { ANSWER_TOPIC_LABELS, QUESTION_KIND_LABELS } from "./options";
import { cut } from "./text";
import { askText } from "./ask";
import { answerText, checkDraft, countChars } from "./check";
import { selectText } from "./select";
import type { Draft } from "./types";
import { writeText } from "./write";

// 준비한 자소서 문항 예시를 실제 AI에 돌려, 맞는 경험을 고르고 기록에 없는 것을 쓰지 않는지,
// 답만으로 쓸 때 답을 근거로 삼고 경력을 지어내지 않는지, 묻기가 기록과 맞는 연결고리로 묻는지,
// 회사 정보를 답과 이어진 회사 이야기로만 쓰는지 본다(관리자 전용, 호출 5번)

const SAMPLE = "자소서 고르기·쓰기";
const PROMPT = "지원 동기와 직무 역량을 경험을 들어 적어 주세요 (500자 이내)";
const CHAR_LIMIT = 500;
const BASE: Pick<WritingSource, "organization" | "role" | "endMonth" | "isOngoing" | "notDone" | "bannedPhrases" | "contentVersion" | "metrics"> = { organization: null, role: null, endMonth: null, isOngoing: false, notDone: null, bannedPhrases: [], contentVersion: 0, metrics: [] };

// ①은 문항에 맞는 재직 경험이고(수치·기준·하지 않은 것·금지 표현이 있다), ②는 맞지 않는 아르바이트다
export const SAMPLE_SOURCES: WritingSource[] = [
  {
    ...BASE,
    id: "sample-app-kotlin",
    name: "주문 조회 API 개선",
    kind: "job",
    organization: "나다상사",
    role: "백엔드 개발자",
    startMonth: "2023-03",
    endMonth: "2025-08",
    situation: "주문 조회 화면이 느리다는 문의가 꾸준히 들어왔다",
    actions: "Kotlin으로 주문 조회 API의 쿼리를 분석해 고치고 인덱스를 추가했다",
    result: "주문 조회 응답이 빨라졌다",
    notDone: "팀장 역할, 인프라 설계는 하지 않음",
    bannedPhrases: ["주도", "총괄"],
    metrics: [{ text: "응답 시간 1.2초 → 0.4초", basis: "APM 주간 평균" }],
  },
  {
    ...BASE,
    id: "sample-app-cafe",
    name: "카페 바리스타 아르바이트",
    kind: "job",
    organization: "라마커피",
    role: "바리스타",
    startMonth: "2021-03",
    endMonth: "2021-12",
    situation: "동네 카페에서 주말 손님이 몰렸다",
    actions: "주문을 받고 음료를 만들고 마감 정리를 했다",
    result: "단골손님이 생겼다",
  },
];
const [KOTLIN, CAFE] = SAMPLE_SOURCES;
const QUESTION = { prompt: PROMPT, charLimit: CHAR_LIMIT, countSpaces: true, version: 0 };

// 답으로 쓰기 예시: 경험 없이 지원자의 답 하나만으로 지원 동기를 쓴다
const ANSWER_SAMPLE = "자소서 답으로 쓰기";
const ANSWER_PROMPT = "지원 동기를 적어 주세요 (300자 이내)";
const ANSWER_LIMIT = 300;
const ANSWER: Answer = {
  id: "sample-answer-motive",
  topic: "motive",
  question: "이 공고에서 가장 끌린 점은 무엇인가요?",
  answer: "주문·결제처럼 많은 사람이 매일 쓰는 서비스를 안정적으로 만드는 일을 하고 싶다",
  postingId: null,
  company: "(주)가나다테크",
  companyKey: "가나다테크",
  createdAt: new Date(0),
};

// 회사 정보 예시: 지원자가 체크한 회사 소식 하나. 답으로 쓰기 예시에 더해 쓰고, 묻기 예시에도 보낸다
const COMPANY_SAMPLE = "자소서 회사 정보로 쓰기";
const COMPANY_FACT: CompanyFact = {
  id: "sample-fact-pay",
  kind: "news",
  text: "3분기 간편결제 거래액이 전년보다 40% 늘었다",
  url: "https://news.example.com/pay",
  title: "가나다테크 3분기 실적",
  date: null,
};

// 묻기 예시: 공고(Java·Kotlin 백엔드)와 이어지는 교육과, 이어지지 않는 바리스타 사례
const ASK_SAMPLE = "자소서 묻기";
const ASK_PROMPT = "지원 동기를 적어 주세요";
const ASK_HOOKS: MotiveHook[] = [
  { kind: "scene", label: CAFE.name, detail: [CAFE.situation, CAFE.actions, CAFE.result].join(" / ") },
  { kind: "course", label: "Kotlin 백엔드 개발 과정", detail: "Kotlin 백엔드 개발 과정 · 나다아카데미 · Spring Boot로 주문 API를 만들며 Kotlin을 익혔다" },
];

export async function runApplicationCheck(db: Db, ai: AiClient, userId: string, now: Date = new Date()): Promise<CheckRow[]> {
  const row = (check: string, expected: string, actual: string, pass: boolean): CheckRow => ({ sample: SAMPLE, check, expected, actual, pass });
  const failed = (checks: string[], reason: string) => checks.map((check) => row(check, "AI 호출 성공", `실패: ${reason}`, false));
  const postingText = FULL_POSTING.source;

  const selectChecks = ["①을 고른다", "②를 고르지 않는다", "추천 근거가 비지 않는다(기록에 없는 숫자나 빈 답으로 지워지지 않음)",
    "지원 동기와 직무 역량 문항을 경험형과 동기포부형으로 본다",
    "주제에 지원동기가 있다",
  ];
  const writeChecks = [
    "쓰면 안 되는 표현이 없다",
    "기록에 없는 숫자가 없다",
    "모든 문단에 근거가 있다",
    `${CHAR_LIMIT}자(공백 포함)를 넘지 않는다`,
    "②의 내용(바리스타·카페)을 쓰지 않는다",
    "인프라 설계를 했다고 쓰지 않는다",
  ];

  const select = async (): Promise<CheckRow[]> => {
    let raw: unknown;
    const result = await selectText(
      db,
      ai,
      userId,
      { prompt: PROMPT, charLimit: CHAR_LIMIT, postingText, requirements: [], sources: SAMPLE_SOURCES, usedElsewhere: [], kinds: null },
      now,
      (value) => {
        raw = value;
      },
    );
    // 진단용 줄: 보이기만 하는 것이라 늘 통과한다(AI 호출을 더하지 않는다)
    const diagnostic = () => row("AI가 보낸 답(진단용)", "-", raw === undefined ? "AI 호출 실패" : cut(JSON.stringify(raw), 600), true);
    if (!result.ok) return [...failed(selectChecks, result.reason), diagnostic()];
    const { picks, classified } = result.value;
    const picked = (id: string) => picks.some((pick) => pick.experienceId === id);
    // 기록에 없는 숫자가 든 문장(과 빈 답)은 selectText가 비워 두므로, 비워진 칸이 있으면 근거를 제대로 쓰지 못한 것이다
    const blanked = picks.flatMap((pick) => {
      const name = SAMPLE_SOURCES.find((s) => s.id === pick.experienceId)?.name ?? pick.experienceId;
      return (["overlap", "role"] as const).filter((field) => pick[field] === "").map((field) => `${name} ${field}`);
    });
    // 진단용: ①을 못 골랐을 때 AI가 실제로 무엇을 골랐고 무엇을 밀어냈는지 보인다
    const nameOf = (id: string) => SAMPLE_SOURCES.find((s) => s.id === id)?.name ?? id;
    const pickedNames = picks.map((pick) => nameOf(pick.experienceId)).join(", ") || "없음";
    const passedNames = result.value.passed.map((p) => `${nameOf(p.experienceId)}(${p.whyNot || "이유 없음"})`).join(", ") || "없음";
    // AI가 항목을 줬는데 코드가 하나도 받지 못했으면(별명 불일치 등) 원래 값을 보인다
    const rawPicks = (raw as { picks?: { exp?: unknown }[] } | undefined)?.picks ?? [];
    const dropped = Array.isArray(rawPicks) && rawPicks.length > 0 && picks.length === 0 ? ` · AI가 고른 별명: ${rawPicks.map((p) => String(p?.exp)).join(", ")}` : "";
    const notPicked = `고르지 않음 · 고른 것: ${pickedNames} · 밀린 것: ${passedNames}${dropped}`;
    return [
      row(selectChecks[0], "고름", picked(KOTLIN.id) ? "①을 고름" : notPicked, picked(KOTLIN.id)),
      row(selectChecks[1], "고르지 않음", picked(CAFE.id) ? "②를 고름" : "고르지 않음", !picked(CAFE.id)),
      row(selectChecks[2], "비워진 칸 없음", blanked.length === 0 ? "없음" : `비워짐: ${blanked.join(", ")}`, blanked.length === 0),
      row(selectChecks[3], "경험형, 동기포부형", classified.kinds.map((k) => QUESTION_KIND_LABELS[k]).join(", "), classified.kinds.includes("experience") && classified.kinds.includes("motive")),
      row(selectChecks[4], "지원동기", classified.topics.map((t) => ANSWER_TOPIC_LABELS[t]).join(", ") || "없음", classified.topics.includes("motive")),
      diagnostic(),
    ];
  };

  // 고르기 결과와 상관없이 ①만 승인한 것으로 쓴다. 답이 없는 문항이 쓰기에 닿는 것은 경험형일 때뿐이므로 경험형으로 보낸다
  const write = async (): Promise<CheckRow[]> => {
    const result = await writeText(
      db,
      ai,
      userId,
      { prompt: PROMPT, charLimit: CHAR_LIMIT, countSpaces: true, postingText, sources: [KOTLIN], kinds: ["experience"], answers: [], unanswered: [], companyFacts: [] },
      now,
    );
    if (!result.ok) return failed(writeChecks, result.reason);
    const draft: Draft = { questionVersion: 0, basedOn: [{ experienceId: KOTLIN.id, contentVersion: 0 }], ...result.value, writtenAt: now.toISOString() };
    const check = checkDraft(draft, QUESTION, [KOTLIN]);
    const text = answerText(draft);
    const count = countChars(text, true);
    const banned = [...new Set(check.paragraphs.flatMap((p) => p.banned))];
    const ungrounded = [...new Set(check.paragraphs.flatMap((p) => p.ungrounded))];
    const noSource = check.paragraphs.filter((p) => p.noSource).length;
    const cafe = ["바리스타", "카페"].filter((word) => text.includes(word));
    const infra = draft.paragraphs.some((p) => p.text.includes("인프라 설계"));
    return [
      row(writeChecks[0], "없음", banned.join(", ") || "없음", banned.length === 0),
      row(writeChecks[1], "없음", ungrounded.join(", ") || "없음", ungrounded.length === 0),
      row(writeChecks[2], "모두 근거 있음", noSource === 0 ? "모두 근거 있음" : `근거 없는 문단 ${noSource}개`, draft.paragraphs.length > 0 && noSource === 0),
      row(writeChecks[3], `${CHAR_LIMIT}자 이하`, `${count}자`, count <= CHAR_LIMIT),
      row(writeChecks[4], "없음", cafe.join(", ") || "없음", cafe.length === 0),
      row(writeChecks[5], "없음", infra ? "인프라 설계를 씀" : "없음", !infra),
    ];
  };

  const answerChecks = ["모든 문단의 근거가 내 답이다", "기록에 없는 숫자가 없다", `${ANSWER_LIMIT}자를 넘지 않는다`, "경력·성과를 지어 쓰지 않는다"];
  // 경험 없이 답 하나로 쓴다. 답 글의 숫자만 허용하고(공고 글의 숫자는 허용하지 않는다), 한 일을 지어낸 말이 없는지 본다
  const answerWrite = async (): Promise<CheckRow[]> => {
    const answerRow = (check: string, expected: string, actual: string, pass: boolean): CheckRow => ({ sample: ANSWER_SAMPLE, check, expected, actual, pass });
    const result = await writeText(
      db,
      ai,
      userId,
      { prompt: ANSWER_PROMPT, charLimit: ANSWER_LIMIT, countSpaces: true, postingText, sources: [], kinds: ["motive"], answers: [ANSWER], unanswered: [], companyFacts: [] },
      now,
    );
    if (!result.ok) return answerChecks.map((check) => answerRow(check, "AI 호출 성공", `실패: ${result.reason}`, false));
    const draft: Draft = { questionVersion: 0, basedOn: [], ...result.value, answers: [ANSWER.id], writtenAt: now.toISOString() };
    const check = checkDraft(draft, { prompt: ANSWER_PROMPT, charLimit: ANSWER_LIMIT, countSpaces: true, version: 0 }, [], { answers: [ANSWER] });
    const text = answerText(draft);
    const count = countChars(text, true);
    const notAnswer = draft.paragraphs.filter((p) => !(p.answers ?? []).includes(ANSWER.id)).length;
    const ungrounded = [...new Set(check.paragraphs.flatMap((p) => p.ungrounded))];
    const invented = ["개발했", "경험이 있"].filter((word) => text.includes(word));
    return [
      answerRow(answerChecks[0], "모두 내 답", notAnswer === 0 ? "모두 내 답" : `내 답이 근거가 아닌 문단 ${notAnswer}개`, draft.paragraphs.length > 0 && notAnswer === 0),
      answerRow(answerChecks[1], "없음", ungrounded.join(", ") || "없음", ungrounded.length === 0),
      answerRow(answerChecks[2], `${ANSWER_LIMIT}자 이하`, `${count}자`, count <= ANSWER_LIMIT),
      answerRow(answerChecks[3], "없음", invented.join(", ") || "없음", invented.length === 0),
    ];
  };

  const companyChecks = [
    "C1을 단 문단이 있다",
    "그 문단에 A1도 있다",
    "40%는 C1을 단 문단에만 있다",
    "지원자가 거래액을 늘린 것처럼 쓰지 않는다",
    "기록에 없는 숫자가 없다(회사 정보 숫자 허용)",
  ];
  // 답으로 쓰기 예시에 회사 소식(C1)을 더해 쓴다. 회사 정보는 답과 이어진 문단에서 회사 이야기로만 써야 한다
  const companyWrite = async (): Promise<CheckRow[]> => {
    const companyRow = (check: string, expected: string, actual: string, pass: boolean): CheckRow => ({ sample: COMPANY_SAMPLE, check, expected, actual, pass });
    const result = await writeText(
      db,
      ai,
      userId,
      { prompt: ANSWER_PROMPT, charLimit: ANSWER_LIMIT, countSpaces: true, postingText, sources: [], kinds: ["motive"], answers: [ANSWER], unanswered: [], companyFacts: [COMPANY_FACT] },
      now,
    );
    if (!result.ok) return companyChecks.map((check) => companyRow(check, "AI 호출 성공", `실패: ${result.reason}`, false));
    const draft: Draft = { questionVersion: 0, basedOn: [], ...result.value, answers: [ANSWER.id], companyFacts: [COMPANY_FACT], writtenAt: now.toISOString() };
    const tagged = draft.paragraphs.filter((p) => (p.company ?? []).includes(COMPANY_FACT.id));
    const withoutAnswer = tagged.filter((p) => !(p.answers ?? []).includes(ANSWER.id)).length;
    const strayForty = draft.paragraphs.filter((p) => !tagged.includes(p) && numbersIn(p.text).includes("40")).length;
    const text = answerText(draft);
    const claimed = ["늘렸", "기여했"].filter((word) => text.includes(word));
    const check = checkDraft(draft, { prompt: ANSWER_PROMPT, charLimit: ANSWER_LIMIT, countSpaces: true, version: 0 }, [], { answers: [ANSWER] });
    const factNums = new Set(factNumbers(COMPANY_FACT));
    const ungrounded = [...new Set(check.paragraphs.flatMap((p) => p.ungrounded))].filter((n) => !factNums.has(n));
    return [
      companyRow(companyChecks[0], "있음", tagged.length > 0 ? `${tagged.length}개` : "없음", tagged.length > 0),
      companyRow(companyChecks[1], "모두 A1 있음", tagged.length === 0 ? "C1을 단 문단 없음" : withoutAnswer === 0 ? "모두 A1 있음" : `A1이 없는 문단 ${withoutAnswer}개`, tagged.length > 0 && withoutAnswer === 0),
      companyRow(companyChecks[2], "C1 문단에만", strayForty === 0 ? "C1 문단에만" : `C1이 없는 문단 ${strayForty}개`, strayForty === 0),
      companyRow(companyChecks[3], "없음", claimed.join(", ") || "없음", claimed.length === 0),
      companyRow(companyChecks[4], "없음", ungrounded.join(", ") || "없음", ungrounded.length === 0),
    ];
  };

  const askChecks = [
    "질문 2~3개",
    "질문마다 선택지 3~5개",
    "주제가 모두 지원동기",
    "연결고리에 Kotlin 교육이 나온다",
    "바리스타를 연결고리로 쓰지 않는다",
    "선택지에 공고·기록에 없는 숫자가 없다",
    "연결고리 중 하나에 간편결제가 나온다",
  ];
  // 코드가 다듬기 전의 AI 답으로 지시를 따랐는지 본다
  const ask = async (): Promise<CheckRow[]> => {
    const askRow = (check: string, expected: string, actual: string, pass: boolean): CheckRow => ({ sample: ASK_SAMPLE, check, expected, actual, pass });
    let raw: { items: { topic: string; link: string; question: string; options: string[] }[] } | undefined;
    const result = await askText(
      db,
      ai,
      userId,
      { prompt: ASK_PROMPT, company: "(주)가나다테크", title: "백엔드 개발자", postingText, topics: ["motive"], hooks: ASK_HOOKS, companyFacts: [COMPANY_FACT] },
      now,
      { onRaw: (value) => (raw = value) },
    );
    if (!result.ok || !raw) return askChecks.map((check) => askRow(check, "AI 호출 성공", `실패: ${result.ok ? "invalid" : result.reason}`, false));
    const items = raw.items;
    const counts = items.map((x) => x.options.length);
    const topics = items.map((x) => x.topic);
    const links = items.map((x) => x.link).filter((link) => link.trim() !== "");
    const cafe = links.filter((link) => ["바리스타", "카페"].some((word) => link.includes(word)));
    const known = new Set([...[ASK_PROMPT, postingText, ...ASK_HOOKS.map((h) => h.detail)].flatMap(numbersIn), ...factNumbers(COMPANY_FACT)]);
    const invented = [...new Set(items.flatMap((x) => x.options.flatMap(numbersIn)).filter((n) => !known.has(n)))];
    return [
      askRow(askChecks[0], "2~3개", `${items.length}개`, items.length >= 2 && items.length <= 3),
      askRow(askChecks[1], "3~5개", counts.join(", ") || "없음", counts.length > 0 && counts.every((n) => n >= 3 && n <= 5)),
      askRow(askChecks[2], "motive", topics.join(", ") || "없음", topics.length > 0 && topics.every((t) => t === "motive")),
      askRow(askChecks[3], "Kotlin", links.join(" / ") || "없음", links.some((link) => link.includes("Kotlin"))),
      askRow(askChecks[4], "없음", cafe.join(" / ") || "없음", cafe.length === 0),
      askRow(askChecks[5], "없음", invented.join(", ") || "없음", invented.length === 0),
      askRow(askChecks[6], "간편결제", links.join(" / ") || "없음", links.some((link) => link.includes("간편결제"))),
    ];
  };

  return (await Promise.all([select(), write(), answerWrite(), ask(), companyWrite()])).flat();
}
