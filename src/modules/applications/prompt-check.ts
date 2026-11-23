import type { Db } from "@/db/types";
import type { AiClient } from "@/modules/ai/client";
import type { CheckRow } from "@/modules/experiences/prompt-check";
import type { WritingSource } from "@/modules/experiences/writing";
import { FULL_POSTING } from "@/modules/postings/prompt-check";
import { ANSWER_TOPIC_LABELS, QUESTION_KIND_LABELS } from "./options";
import { cut } from "./text";
import { answerText, checkDraft, countChars } from "./check";
import { selectText } from "./select";
import type { Draft } from "./types";
import { writeText } from "./write";

// 준비한 자소서 문항 예시를 실제 AI에 돌려, 맞는 경험을 고르고 기록에 없는 것을 쓰지 않는지 본다(관리자 전용, 호출 2번)

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

  // 고르기 결과와 상관없이 ①만 승인한 것으로 쓴다
  const write = async (): Promise<CheckRow[]> => {
    const result = await writeText(db, ai, userId, { prompt: PROMPT, charLimit: CHAR_LIMIT, countSpaces: true, postingText, sources: [KOTLIN] }, now);
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

  return (await Promise.all([select(), write()])).flat();
}
