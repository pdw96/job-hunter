import type { Db } from "@/db/types";
import { type AiClient, runAi } from "@/modules/ai/client";
import { requestImport } from "./import";
import type { ExperienceInput } from "./input";
import { requestDraft } from "./interview";
import { type Judgement, judgementSchema } from "./judge";
import { RUBRIC_ITEM_LABELS } from "./options";
import { describeExperience, JUDGE_SYSTEM } from "./prompts";
import type { Experience } from "./repo";
import type { InterviewMessage } from "./schema";

// 프롬프트 점검. 준비한 예시를 실제 AI에 돌려, 기대한 판정이 나오는지와 말하지 않은 내용을 만들지 않는지 본다.
// 프롬프트나 모델을 바꿀 때 관리자 화면에서 다시 돌린다. 테스트는 가짜 AI를 쓰므로 이 품질은 테스트로 알 수 없다.

export type CheckRow = { sample: string; check: string; expected: string; actual: string; pass: boolean };

const base: ExperienceInput = {
  name: "주문 조회 API 개선",
  kind: "project",
  organization: "가나다 주식회사",
  role: "백엔드 개발",
  startMonth: "2023-03",
  endMonth: "2023-11",
  isOngoing: false,
  // 본문에 근거 없는 숫자를 두지 않는다. 실제 AI는 본문의 숫자에도 근거를 요구한다(2026-11-17 점검에서 확인)
  situation: "주문 조회 화면이 느리다는 고객 문의가 꾸준히 들어왔다.",
  actions:
    "주문 조회 API 3개의 쿼리를 직접 분석해 인덱스 2개를 추가하고, 한 번에 불러오던 목록을 페이지 단위로 나누도록 구현했다. 설계 방향은 팀장이 정했고 나는 구현과 부하 테스트를 맡았다.",
  result: "조회 응답 시간이 줄어 관련 문의가 줄었다.",
  metrics: [{ text: "평균 응답 시간 2.1초에서 0.6초", basis: "사내 모니터링 도구의 개선 전후 각 2주 평균" }],
  notDone: "API 설계 방향 결정과 프론트엔드 수정은 하지 않았다.",
  bannedPhrases: [],
  evidenceNote: "사내 모니터링 대시보드 캡처와 작업 티켓 목록을 보관하고 있다.",
  tags: [],
};

const asExperience = (input: ExperienceInput): Experience => ({
  ...input,
  id: "sample",
  rubric: {
    period: { status: "met", note: null },
    role: { status: "unjudged", note: null },
    level: { status: "unjudged", note: null },
    metrics: { status: "unjudged", note: null },
    evidence: { status: "unjudged", note: null },
  },
  isConfirmed: false,
  state: "unconfirmed",
  contentVersion: 0,
  phraseCandidates: [],
  dismissedPhrases: [],
  judgedAt: null,
  source: "manual",
  createdAt: new Date(0),
  updatedAt: new Date(0),
});

type Item = "role" | "level" | "metrics" | "evidence";
type JudgeSample = {
  name: string;
  input: ExperienceInput;
  expect: Partial<Record<Item, "met" | "unmet">>;
  candidates?: "some" | "none";
};

export const JUDGE_SAMPLES: JudgeSample[] = [
  {
    name: "구체적인 기록",
    input: base,
    expect: { role: "met", level: "met", metrics: "met", evidence: "met" },
    candidates: "some", // 설계를 하지 않았다고 했으므로 과장 후보가 나와야 한다
  },
  {
    name: "본인 역할이 흐린 기록",
    input: {
      ...base,
      actions: "주문 조회 성능 개선 프로젝트에 참여하여 성능 개선에 기여했다.",
      notDone: null,
    },
    expect: { role: "unmet" },
  },
  {
    name: "수치에 근거가 없는 기록",
    input: { ...base, metrics: [{ text: "응답 속도 70% 개선", basis: null }] },
    expect: { role: "met", metrics: "unmet" },
  },
  {
    name: "수치가 없는 기록",
    input: { ...base, situation: "주문 조회 화면이 느리다는 문의가 있었다.", metrics: [] },
    expect: { metrics: "met" }, // 없는 수치를 요구하지 않는다
  },
  {
    name: "증빙이 없는 기록",
    input: { ...base, evidenceNote: null },
    expect: { evidence: "unmet", role: "met" },
  },
  {
    name: "평범하지만 분명한 기록",
    input: {
      ...base,
      name: "편의점 아르바이트",
      kind: "job",
      organization: "동네 편의점",
      role: "야간 근무",
      situation: "야간에 혼자 매장을 맡았다.",
      actions: "계산, 상품 진열, 유통기한 확인과 폐기 등록을 혼자 했다. 발주는 점주가 했고 나는 하지 않았다.",
      result: "근무한 10개월 동안 무단결근 없이 일했다.",
      metrics: [],
      notDone: "발주와 정산은 하지 않았다.",
      evidenceNote: "근로계약서와 급여 이체 내역이 있다.",
    },
    expect: { role: "met", level: "met", evidence: "met" }, // 대단한 성과가 아니어도 분명하면 충족
    candidates: "some",
  },
];

type ExtractSample = {
  name: string;
  messages: InterviewMessage[];
  // 초안이 지켜야 할 것. 지키면 null, 어기면 무엇이 문제인지
  checks: { check: string; expected: string; test: (draft: ExperienceInput) => string | null }[];
};

const talk = (pairs: [string, string][]): InterviewMessage[] =>
  pairs.flatMap(([question, answer]) => [
    { role: "assistant" as const, text: question },
    { role: "user" as const, text: answer },
  ]);

const INFLATED = ["주도", "총괄", "리드", "이끌", "책임지"];
const allText = (draft: ExperienceInput) =>
  [draft.situation, draft.actions, draft.result, ...draft.metrics.flatMap((m) => [m.text, m.basis])]
    .filter(Boolean)
    .join(" ");

export const EXTRACT_SAMPLES: ExtractSample[] = [
  {
    name: "수치·증빙을 말하지 않은 대화",
    messages: talk([
      ["어떤 경험을 기록할까요?", "회사에서 사내 위키 정리하는 일에 참여했어요"],
      ["본인이 직접 한 일은 무엇이었나요?", "오래된 문서를 찾아서 목록으로 만들었어요. 삭제할지는 팀장님이 정했고요"],
      ["언제부터 언제까지였나요?", "2024년 2월부터 4월까지요"],
      ["결과나 수치가 있나요?", "수치는 따로 없어요. 그냥 정리가 됐어요"],
      ["증빙이 될 자료가 있나요?", "잘 모르겠어요"],
    ]),
    checks: [
      { check: "수치를 만들지 않는다", expected: "수치 0건", test: (d) => (d.metrics.length === 0 ? null : `수치 ${d.metrics.length}건`) },
      { check: "증빙을 만들지 않는다", expected: "증빙 메모 비어 있음", test: (d) => (d.evidenceNote ? d.evidenceNote : null) },
      {
        check: "참여를 주도로 키우지 않는다",
        expected: "주도·총괄 같은 말 없음",
        test: (d) => INFLATED.find((word) => allText(d).includes(word)) ?? null,
      },
      { check: "기간을 말한 대로 적는다", expected: "2024-02 ~ 2024-04", test: (d) => (d.startMonth === "2024-02" && d.endMonth === "2024-04" ? null : `${d.startMonth} ~ ${d.endMonth}`) },
      { check: "하지 않은 것을 받아 적는다", expected: "삭제 결정은 팀장이 했다는 내용", test: (d) => (d.notDone || /팀장/.test(allText(d)) ? null : "빠짐") },
    ],
  },
  {
    name: "수치를 말한 대화",
    messages: talk([
      ["어떤 경험을 기록할까요?", "쇼핑몰 고객센터에서 상담 일을 했어요"],
      ["본인이 직접 한 일은 무엇이었나요?", "전화랑 채팅 상담을 했고, 자주 묻는 질문 답변 문서를 제가 15개 만들었어요"],
      ["언제부터 언제까지였나요?", "2022년 6월부터 2023년 5월까지요"],
      ["결과나 수치가 있나요?", "하루에 평균 40건 정도 상담했어요. 제 상담 기록 기준이에요"],
      ["하지 않은 일이 있다면요?", "환불 승인은 제가 못 하고 관리자가 했어요"],
    ]),
    checks: [
      { check: "말한 수치를 적는다", expected: "40이 들어간 수치", test: (d) => (/40/.test(allText(d)) ? null : "40이 없음") },
      { check: "하지 않은 것을 받아 적는다", expected: "환불 승인 관련 내용", test: (d) => (d.notDone && /환불/.test(d.notDone) ? null : (d.notDone ?? "비어 있음")) },
      { check: "증빙을 만들지 않는다", expected: "증빙 메모 비어 있음", test: (d) => (d.evidenceNote ? d.evidenceNote : null) },
    ],
  },
];

const STATUS_LABELS = { met: "충족", unmet: "미달" } as const;

// AI가 써 준 것 같은 부풀려진 이력서. 가져오기가 이것을 키우지 않고 있는 그대로 나누는지 본다
export const IMPORT_SAMPLE = {
  name: "부풀려진 이력서 가져오기",
  source: `[경력]
가나다커머스 | 마케팅팀 | 2022.03 ~ 2024.02
- 신규 고객 유입 캠페인을 주도하여 매출 30% 향상에 기여
- 데이터 기반 의사결정 문화를 정착시키며 핵심 역할을 수행
- SNS 채널 운영을 총괄하고 팔로워를 2만 명까지 성장시킴

[프로젝트]
브랜드 리뉴얼 프로젝트 | 2023.06 ~ 2023.09
- 리뉴얼 TF에 참여하여 고객 설문을 설계하고 결과를 정리
- 성공적인 리뉴얼 론칭을 이끌며 브랜드 인지도 제고에 크게 기여

[학력]
한국대학교 경영학과 | 2016.03 ~ 2022.02`,
};

type Prepared = Extract<Awaited<ReturnType<typeof requestImport>>, { ok: true }>;

function importRows(prepared: Prepared): CheckRow[] {
  const sample = IMPORT_SAMPLE.name;
  const records = prepared.records;
  const text = records
    .map(({ input }) => [input.situation, input.actions, input.result, ...input.metrics.map((m) => m.text)].join(" "))
    .join(" ");
  const claims = records.flatMap((record) => record.claims);
  const invented = claims.filter((claim) => claim.status === "needs_fix").map((claim) => claim.quote);
  const aiClaims = claims.filter((claim) => claim.origin === "ai").map((claim) => claim.quote);
  const filled = records.filter(({ input }) => input.notDone || input.evidenceNote).map(({ input }) => input.name);
  const row = (check: string, expected: string, actual: string, pass: boolean): CheckRow => ({ sample, check, expected, actual, pass });

  return [
    row("경험 단위로 나눈다", "3건", `${records.length}건: ${records.map(({ input }) => input.name).join(", ")}`, records.length === 3),
    row("원본에 없던 숫자를 넣지 않는다", "없음", invented.length === 0 ? "없음" : invented.join(" / "), invented.length === 0),
    row(
      "원본의 표현을 그대로 둔다",
      "'매출 30% 향상에 기여'가 그대로 있음",
      text.includes("매출 30% 향상에 기여") ? "그대로 있음" : "바뀌었거나 빠짐",
      text.includes("매출 30% 향상에 기여"),
    ),
    row(
      "더 키우지 않는다",
      "'참여하여'가 '주도'로 바뀌지 않음",
      /리뉴얼 TF에 참여/.test(text) ? "그대로 있음" : "바뀌었거나 빠짐",
      /리뉴얼 TF에 참여/.test(text),
    ),
    row(
      "원본에 없는 칸을 채우지 않는다",
      "하지 않은 것·증빙이 비어 있음",
      filled.length === 0 ? "비어 있음" : `채워진 기록: ${filled.join(", ")}`,
      filled.length === 0,
    ),
    row(
      "코드가 숫자와 과장 낱말을 주장으로 잡는다",
      "30%, 2만, 주도, 총괄이 든 구절",
      claims.filter((claim) => claim.origin === "code").map((claim) => claim.quote).join(" / ") || "없음",
      ["30%", "2만", "주도", "총괄"].every((word) => claims.some((claim) => claim.origin === "code" && claim.quote.includes(word))),
    ),
    row(
      "AI가 부풀린 표현을 더 짚는다",
      "1개 이상 (예: 핵심 역할, 크게 기여)",
      aiClaims.length === 0 ? "없음" : aiClaims.join(" / "),
      aiClaims.length > 0,
    ),
  ];
}

function judgeRows(sample: JudgeSample, judgement: Judgement): CheckRow[] {
  const rows: CheckRow[] = (Object.keys(sample.expect) as Item[]).map((item) => ({
    sample: sample.name,
    check: RUBRIC_ITEM_LABELS[item],
    expected: STATUS_LABELS[sample.expect[item]!],
    actual: STATUS_LABELS[judgement[item].status] + (judgement[item].note ? ` (${judgement[item].note})` : ""),
    pass: judgement[item].status === sample.expect[item],
  }));
  if (sample.candidates) {
    const count = judgement.phraseCandidates.length;
    rows.push({
      sample: sample.name,
      check: "과장 표현 후보",
      expected: sample.candidates === "some" ? "1개 이상" : "없음",
      actual: count === 0 ? "없음" : judgement.phraseCandidates.join(", "),
      pass: sample.candidates === "some" ? count > 0 : count === 0,
    });
  }
  return rows;
}

const failed = (sample: string, reason: string): CheckRow[] => [
  { sample, check: "AI 호출", expected: "성공", actual: reason, pass: false },
];

export async function runPromptCheck(db: Db, ai: AiClient, userId: string, now: Date = new Date()): Promise<CheckRow[]> {
  const judged = JUDGE_SAMPLES.map(async (sample) => {
    const result = await runAi(
      db,
      ai,
      userId,
      {
        purpose: "judge",
        system: JUDGE_SYSTEM,
        messages: [{ role: "user", text: describeExperience(asExperience(sample.input)) }],
        schema: judgementSchema,
        effort: "medium",
        maxTokens: 8000,
      },
      now,
    );
    return result.ok ? judgeRows(sample, result.value) : failed(sample.name, result.reason);
  });

  const extracted = EXTRACT_SAMPLES.map(async (sample) => {
    const result = await requestDraft(db, ai, userId, sample.messages, null, now);
    if (!result.ok) return failed(sample.name, result.reason);
    const rows: CheckRow[] = sample.checks.map(({ check, expected, test }) => {
      const problem = test(result.draft);
      return { sample: sample.name, check, expected, actual: problem ?? "지켜짐", pass: problem === null };
    });
    const warned = Object.values(result.warnings);
    rows.push({
      sample: sample.name,
      check: "대화에 없던 숫자",
      expected: "없음",
      actual: warned.length === 0 ? "없음" : warned.join(" / "),
      pass: warned.length === 0,
    });
    return rows;
  });

  const imported = (async () => {
    const result = await requestImport(db, ai, userId, IMPORT_SAMPLE.source, now);
    return result.ok ? importRows(result) : failed(IMPORT_SAMPLE.name, result.reason);
  })();

  return (await Promise.all([...judged, ...extracted, imported])).flat();
}
