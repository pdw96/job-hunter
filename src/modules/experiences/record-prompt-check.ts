import type { Db } from "@/db/types";
import type { AiClient } from "@/modules/ai/client";
import type { CheckRow } from "./prompt-check";
import type { SceneInput } from "./record-input";
import { requestRecordImport } from "./record-import";
import type { SceneHead } from "./scene-head";
import { requestSceneDraft } from "./scene-interview";
import type { InterviewMessage } from "./schema";

// 새 기록 구조의 프롬프트 점검. 장면 정리(extract_scene)와 새 가져오기(import_records)를 실제 AI에 돌려 기대대로 동작하는지 본다.
// prompt-check.ts와 같은 줄 모양(CheckRow)을 돌려주고, 관리자 화면이 함께 보인다.

const talk = (pairs: [string, string][]): InterviewMessage[] =>
  pairs.flatMap(([question, answer]) => [
    { role: "assistant" as const, text: question },
    { role: "user" as const, text: answer },
  ]);

const sampleHead = (kind: "job" | "activity", labels: SceneHead["labels"], period: SceneHead["period"]): SceneHead => ({
  ref: { kind, id: "sample" },
  isConfirmed: false,
  contentVersion: 0,
  period,
  labels,
});

const allText = (draft: SceneInput) =>
  [draft.title, draft.situation, draft.judgment, draft.actions, draft.result, draft.lessons, draft.notDone, ...draft.metrics.flatMap((m) => [m.text, m.basis])]
    .filter(Boolean)
    .join(" ");

type SceneSample = {
  name: string;
  head: SceneHead;
  messages: InterviewMessage[];
  // 초안이 지켜야 할 것. 지키면 null, 어기면 무엇이 문제인지
  checks: { check: string; expected: string; test: (draft: SceneInput) => string | null }[];
};

export const SCENE_SAMPLES: SceneSample[] = [
  {
    name: "장면 둘을 말한 대화",
    head: sampleHead("job", [["회사", "가나다물류"], ["부서", "운영팀"], ["직급", null]], { startMonth: "2021-03", endMonth: "2023-08", isOngoing: false }),
    messages: talk([
      ["이 회사에서 있었던 일 하나를 골라 주세요", "배송 지연 문의가 몰렸을 때 대응한 일이요. 그 전에 창고 재고 실사도 했는데 그건 다음에 할게요"],
      ["본인이 직접 한 일은 무엇이었나요?", "지연된 주문을 지역별로 묶어서 고객에게 안내 문자를 보냈어요. 보상 기준은 팀장님이 정했어요"],
      ["결과는 어땠나요?", "문의가 줄었어요. 수치는 따로 없어요"],
    ]),
    checks: [
      { check: "장면 하나만 정리한다", expected: "'재고 실사'가 없음", test: (d) => (/재고/.test(allText(d)) ? "다른 장면이 섞임" : null) },
      { check: "수치를 만들지 않는다", expected: "수치 0건", test: (d) => (d.metrics.length === 0 ? null : `수치 ${d.metrics.length}건`) },
      { check: "하지 않은 것을 받아 적는다", expected: "보상 기준은 팀장이 정했다는 내용", test: (d) => (/팀장/.test(`${d.notDone ?? ""} ${allText(d)}`) ? null : "빠짐") },
    ],
  },
  {
    name: "수치를 말한 대화",
    head: sampleHead("activity", [["활동", "지역아동센터 학습 봉사"], ["기관", null]], { startMonth: "2022-09", endMonth: "2024-02", isOngoing: false }),
    messages: talk([
      ["이 활동에서 있었던 일 하나를 골라 주세요", "초등학생 수학 공부를 봐 준 일이요. 2023년 3월부터 12월까지 했어요"],
      ["본인이 직접 한 일은 무엇이었나요?", "매주 토요일 4명을 맡아서 문제집 풀이를 도왔어요. 교재는 센터에서 정했어요"],
      ["결과는 어땠나요?", "4명 중 3명이 단원평가 점수가 올랐어요. 센터 선생님이 알려 주셨어요"],
    ]),
    checks: [
      { check: "말한 수치를 적는다", expected: "'3명'이 들어 있음", test: (d) => (/3명/.test(allText(d)) ? null : "3명이 없음") },
      {
        check: "장면의 기간을 말한 대로 적는다",
        expected: "2023-03 ~ 2023-12",
        test: (d) => (d.startMonth === "2023-03" && d.endMonth === "2023-12" ? null : `${d.startMonth ?? "없음"} ~ ${d.endMonth ?? "없음"}`),
      },
      { check: "하지 않은 것을 받아 적는다", expected: "교재는 센터가 정했다는 내용", test: (d) => (/교재/.test(allText(d)) ? null : "빠짐") },
    ],
  },
];

// 학력·자격·경력(장면 둘)·프로젝트가 섞인 글. 메뉴별로 나누고, 학력에 서술을 넣지 않는지 본다
export const RECORD_IMPORT_SAMPLE = {
  name: "섞인 이력서 새 구조로 가져오기",
  source: `[학력]
한국대학교 경영학과 졸업 (2016.03 ~ 2022.02)
학생회 총무로 축제 예산을 정리했다

[자격]
정보처리기사 (2021.11)

[경력]
가나다커머스 마케팅팀 | 정규직 | 2022.03 ~ 2024.02
담당 업무: SNS 채널 운영, 캠페인 집행
- 재방문 쿠폰 캠페인: 이탈 고객이 늘어 재방문 쿠폰 캠페인을 기획하고 문구를 직접 썼다. 재방문율이 12%에서 15%로 올랐다(사내 대시보드 기준).
- 고객 설문 개편: 응답률이 낮던 설문을 문항 수를 줄여 다시 만들었다. 설문 도구 선정은 팀장이 했다.

[프로젝트]
가나다커머스 브랜드 리뉴얼 TF (2023.06 ~ 2023.09)
- 고객 설문 결과를 정리해 TF 회의 자료로 만들었다`,
};

type Prepared = Extract<Awaited<ReturnType<typeof requestRecordImport>>, { ok: true }>;

function importRows({ plan }: Prepared): CheckRow[] {
  const sample = RECORD_IMPORT_SAMPLE.name;
  const row = (check: string, expected: string, actual: string, pass: boolean): CheckRow => ({ sample, check, expected, actual, pass });
  const counts = `학력 ${plan.education.length} · 자격 ${plan.credentials.length} · 경력 ${plan.jobs.length} · 프로젝트 ${plan.projects.length}`;
  const schoolText = plan.education.flatMap((school) => Object.values(school).filter((value) => typeof value === "string")).join(" ");
  const narrated = ["축제", "예산"].filter((word) => schoolText.includes(word));
  const scenes = [...plan.jobs, ...plan.projects, ...plan.activities].flatMap((head) => head.scenes);
  const invented = [...plan.jobs, ...plan.projects, ...scenes]
    .flatMap((item) => item.claims)
    .filter((claim) => claim.status === "needs_fix")
    .map((claim) => claim.quote);
  const jobScenes = plan.jobs[0]?.scenes.length ?? 0;
  const parent = plan.projects[0]?.parentIndex;

  return [
    row(
      "메뉴별로 나눈다",
      "학력 1 · 자격 1 · 경력 1 · 프로젝트 1",
      counts,
      plan.education.length === 1 && plan.credentials.length === 1 && plan.jobs.length === 1 && plan.projects.length === 1,
    ),
    row("학력에 서술을 넣지 않는다", "학력 칸에 '축제'·'예산'이 없음", narrated.length === 0 ? "없음" : `들어 있음: ${schoolText}`, narrated.length === 0),
    row("원본에 없던 숫자를 넣지 않는다", "없음", invented.length === 0 ? "없음" : invented.join(" / "), invented.length === 0),
    row(
      "경력의 장면을 나눈다",
      "경력 장면 2개 이상",
      `${jobScenes}개${jobScenes > 0 ? `: ${plan.jobs[0].scenes.map((s) => s.input.title).join(", ")}` : ""}`,
      jobScenes >= 2,
    ),
    row("프로젝트의 소속을 잡는다", "경력(가나다커머스)", parent ? `${parent.kind} ${parent.index}` : "개인", parent?.kind === "job" && parent.index === 0),
  ];
}

const failed = (sample: string, reason: string): CheckRow[] => [{ sample, check: "AI 호출", expected: "성공", actual: reason, pass: false }];

export async function runRecordCheck(db: Db, ai: AiClient, userId: string, now: Date = new Date()): Promise<CheckRow[]> {
  const extracted = SCENE_SAMPLES.map(async (sample) => {
    const result = await requestSceneDraft(db, ai, userId, sample.messages, sample.head, null, now);
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
    const result = await requestRecordImport(db, ai, userId, RECORD_IMPORT_SAMPLE.source, {}, now);
    return result.ok ? importRows(result) : failed(RECORD_IMPORT_SAMPLE.name, result.reason);
  })();

  return (await Promise.all([...extracted, imported])).flat();
}
