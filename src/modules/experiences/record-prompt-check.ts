import type { Db } from "@/db/types";
import { type AiClient, runAi } from "@/modules/ai/client";
import type { ExperienceInput } from "./input";
import { type AffiliationInput, requestAffiliation } from "./move";
import { type ClassifyRecord, requestClassify, type RoleChoice } from "./move-classify";
import type { CheckRow } from "./prompt-check";
import { describeExperience } from "./prompts";
import type { SceneInput } from "./record-input";
import { requestRecordImport } from "./record-import";
import type { SceneHead } from "./scene-head";
import { requestSceneDraft } from "./scene-interview";
import type { Judgement } from "./judge";
import { RUBRIC_ITEM_LABELS } from "./options";
import { sceneJudgeRequest } from "./scene-judge";
import type { InterviewMessage } from "./schema";

// 새 기록 구조의 프롬프트 점검. 장면 판정(judge), 장면 정리(extract_scene), 새 가져오기(import_records), 옮기기(migrate: 나누기·소속·정리)를 실제 AI에 돌려 기대대로 동작하는지 본다.
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

// ---- 장면 판정 ----
// 옛 경험 기록의 판정 예시(5-4 전 prompt-check.ts)를 장면 모양으로 옮겼다. 기대도 같다.
// judgeScene과 같은 요청(sceneJudgeRequest: describeScene + JUDGE_SYSTEM + judgementSchema)을 보낸다

type JudgeItem = "role" | "level" | "metrics" | "evidence";
type SceneJudgeSample = {
  name: string;
  head: SceneHead;
  scene: SceneInput;
  expect: Partial<Record<JudgeItem, "met" | "unmet">>;
  candidates?: "some" | "none";
};

const orderHead = sampleHead("job", [["회사", "가나다 주식회사"], ["부서", "개발팀"], ["직급", "백엔드 개발"]], {
  startMonth: "2021-03",
  endMonth: null,
  isOngoing: true,
});

const orderScene: SceneInput = {
  head: orderHead.ref,
  title: "주문 조회 API 개선",
  startMonth: "2023-03",
  endMonth: "2023-11",
  isOngoing: false,
  // 본문에 근거 없는 숫자를 두지 않는다. 실제 AI는 본문의 숫자에도 근거를 요구한다(2026-11-17 점검에서 확인)
  situation: "주문 조회 화면이 느리다는 고객 문의가 꾸준히 들어왔다.",
  judgment: null,
  actions:
    "주문 조회 API 3개의 쿼리를 직접 분석해 인덱스 2개를 추가하고, 한 번에 불러오던 목록을 페이지 단위로 나누도록 구현했다. 설계 방향은 팀장이 정했고 나는 구현과 부하 테스트를 맡았다.",
  result: "조회 응답 시간이 줄어 관련 문의가 줄었다.",
  lessons: null,
  metrics: [{ text: "평균 응답 시간 2.1초에서 0.6초", basis: "사내 모니터링 도구의 개선 전후 각 2주 평균" }],
  notDone: "API 설계 방향 결정과 프론트엔드 수정은 하지 않았다.",
  bannedPhrases: [],
  evidenceNote: "사내 모니터링 대시보드 캡처와 작업 티켓 목록을 보관하고 있다.",
  tags: [],
};

const storeHead = sampleHead("job", [["회사", "동네 편의점"], ["부서", null], ["직급", "야간 근무"]], {
  startMonth: "2019-03",
  endMonth: "2019-12",
  isOngoing: false,
});

export const SCENE_JUDGE_SAMPLES: SceneJudgeSample[] = [
  {
    name: "구체적인 기록",
    head: orderHead,
    scene: orderScene,
    expect: { role: "met", level: "met", metrics: "met", evidence: "met" },
    candidates: "some", // 설계를 하지 않았다고 했으므로 과장 후보가 나와야 한다
  },
  {
    name: "본인 역할이 흐린 기록",
    head: orderHead,
    scene: { ...orderScene, actions: "주문 조회 성능 개선 프로젝트에 참여하여 성능 개선에 기여했다.", notDone: null },
    expect: { role: "unmet" },
  },
  {
    name: "수치에 근거가 없는 기록",
    head: orderHead,
    scene: { ...orderScene, metrics: [{ text: "응답 속도 70% 개선", basis: null }] },
    expect: { role: "met", metrics: "unmet" },
  },
  {
    name: "수치가 없는 기록",
    head: orderHead,
    scene: { ...orderScene, situation: "주문 조회 화면이 느리다는 문의가 있었다.", metrics: [] },
    expect: { metrics: "met" }, // 없는 수치를 요구하지 않는다
  },
  {
    name: "증빙이 없는 기록",
    head: orderHead,
    scene: { ...orderScene, evidenceNote: null },
    expect: { evidence: "unmet", role: "met" },
  },
  {
    name: "평범하지만 분명한 기록",
    head: storeHead,
    scene: {
      ...orderScene,
      head: storeHead.ref,
      title: "편의점 야간 근무",
      startMonth: null,
      endMonth: null,
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

const VERDICT_LABELS = { met: "충족", unmet: "미달" } as const;

function judgeRows(sample: SceneJudgeSample, judgement: Judgement): CheckRow[] {
  const rows: CheckRow[] = (Object.keys(sample.expect) as JudgeItem[]).map((item) => ({
    sample: sample.name,
    check: RUBRIC_ITEM_LABELS[item],
    expected: VERDICT_LABELS[sample.expect[item]!],
    actual: VERDICT_LABELS[judgement[item].status] + (judgement[item].note ? ` (${judgement[item].note})` : ""),
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

function importRows({ plan, inventedDropped }: Prepared): CheckRow[] {
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
    // 고칠 주장으로 남은 것뿐 아니라, 코드가 비우거나 버린 칸이 있어도 AI가 숫자를 지어낸 것이다
    row(
      "원본에 없던 숫자를 넣지 않는다",
      "없음",
      invented.length === 0 && inventedDropped === 0
        ? "없음"
        : [...invented, ...(inventedDropped > 0 ? [`코드가 비우거나 버린 칸 ${inventedDropped}개`] : [])].join(" / "),
      invented.length === 0 && inventedDropped === 0,
    ),
    row(
      "경력의 장면을 나눈다",
      "경력 장면 2개 이상",
      `${jobScenes}개${jobScenes > 0 ? `: ${plan.jobs[0].scenes.map((s) => s.input.title).join(", ")}` : ""}`,
      jobScenes >= 2,
    ),
    row("프로젝트의 소속을 잡는다", "경력(가나다커머스)", parent ? `${parent.kind} ${parent.index}` : "개인", parent?.kind === "job" && parent.index === 0),
  ];
}

// 옮기기: 예전 재직 기록 한 건. 경력 하나와 장면 둘 이상으로 나누고, 원본에 없는 숫자를 넣지 않는지 본다
export const MOVE_SPLIT_SAMPLE = {
  name: "예전 재직 기록 옮기기",
  record: {
    name: "나라물산 구매 담당",
    kind: "job",
    organization: "나라물산",
    role: "구매팀 사원",
    startMonth: "2019-01",
    endMonth: "2021-06",
    isOngoing: false,
    situation: null,
    actions: "협력사 납품 일정을 매주 표로 정리해 생산팀과 맞췄다.\n부품 단가 비교표를 만들어 팀장에게 올렸다.",
    result: "단가 비교표는 견적 비교에 쓰였다.",
    metrics: [],
    notDone: "계약 협상은 팀장이 했다",
    bannedPhrases: [],
    evidenceNote: null,
    tags: [],
  } satisfies ExperienceInput,
};

function moveRows({ plan, inventedDropped }: Prepared): CheckRow[] {
  const sample = MOVE_SPLIT_SAMPLE.name;
  const row = (check: string, expected: string, actual: string, pass: boolean): CheckRow => ({ sample, check, expected, actual, pass });
  const others = plan.education.length + plan.courses.length + plan.credentials.length + plan.gaps.length + plan.projects.length + plan.activities.length;
  const scenes = plan.jobs.flatMap((job) => job.scenes);
  const invented = [...plan.jobs, ...scenes].flatMap((item) => item.claims).filter((claim) => claim.status === "needs_fix").map((claim) => claim.quote);
  return [
    row("경력 하나로 나눈다", "경력 1 · 다른 메뉴 0", `경력 ${plan.jobs.length} · 다른 메뉴 ${others}`, plan.jobs.length === 1 && others === 0),
    row(
      "장면을 둘 이상으로 나눈다",
      "장면 2개 이상",
      `${scenes.length}개${scenes.length > 0 ? `: ${scenes.map((s) => s.input.title).join(", ")}` : ""}`,
      scenes.length >= 2,
    ),
    row(
      "원본에 없던 숫자를 넣지 않는다",
      "없음",
      invented.length === 0 && inventedDropped === 0
        ? "없음"
        : [...invented, ...(inventedDropped > 0 ? [`코드가 비우거나 버린 칸 ${inventedDropped}개`] : [])].join(" / "),
      invented.length === 0 && inventedDropped === 0,
    ),
  ];
}

// 옮기기: 프로젝트 둘(회사에서 한 것, 학교에서 한 것)을 경력 하나·학교 하나에 잇는다
export const AFFILIATE_SAMPLE = {
  name: "옮긴 프로젝트의 소속 잇기",
  input: {
    projects: [
      { name: "물류 대시보드", organization: "나라물산", role: "데이터 정리", span: { startMonth: "2020-03", endMonth: "2020-09", isOngoing: false } },
      { name: "졸업 작품", organization: "한국대학교 산업공학과", role: "화면 설계", span: { startMonth: "2018-03", endMonth: "2018-12", isOngoing: false } },
    ],
    jobs: [{ company: "나라물산", department: "구매팀", span: { startMonth: "2019-01", endMonth: "2021-06", isOngoing: false } }],
    schools: [{ schoolName: "한국대학교", major: "산업공학과", span: { startMonth: "2015-03", endMonth: "2019-02" } }],
    courses: [],
  } satisfies AffiliationInput,
};

function affiliateRows(links: Extract<Awaited<ReturnType<typeof requestAffiliation>>, { ok: true }>["links"]): CheckRow[] {
  const sample = AFFILIATE_SAMPLE.name;
  const { input } = AFFILIATE_SAMPLE;
  const parentName = (link: (typeof links)[number] | undefined) => {
    if (!link) return "개인";
    const { kind, index } = link.parent;
    return kind === "job" ? input.jobs[index].company : kind === "education" ? input.schools[index].schoolName : `과정 ${index + 1}`;
  };
  const linkOf = (project: number) => links.find((link) => link.project === project);
  const job = linkOf(0);
  const school = linkOf(1);
  return [
    {
      sample,
      check: "회사에서 한 프로젝트를 경력에 잇는다",
      expected: "물류 대시보드 → 나라물산",
      actual: `물류 대시보드 → ${parentName(job)}`,
      pass: job?.parent.kind === "job" && job.parent.index === 0,
    },
    {
      sample,
      check: "학교에서 한 프로젝트를 학교에 잇는다",
      expected: "졸업 작품 → 한국대학교",
      actual: `졸업 작품 → ${parentName(school)}`,
      pass: school?.parent.kind === "education" && school.parent.index === 0,
    },
  ];
}

// 옮기기 전 정리: 같은 학력 둘, 재직 하나와 그 회사의 성과 사례 둘, 같은 이름 프로젝트 셋
const classifyRecord = (over: Partial<ClassifyRecord> & Pick<ClassifyRecord, "name" | "kind">): ClassifyRecord => ({
  organization: null,
  role: null,
  startMonth: null,
  endMonth: null,
  isOngoing: false,
  body: "",
  ...over,
});
export const CLASSIFY_SAMPLE = {
  name: "옮기기 전 기록 정리",
  records: [
    classifyRecord({ name: "한빛대학교 경영학과", kind: "school", organization: "한빛대학교", startMonth: "2015-03", endMonth: "2019-02", body: "경영학을 전공했다." }),
    classifyRecord({ name: "한빛대학교 경영학과 졸업", kind: "school", organization: "한빛대학교", startMonth: "2015-03", endMonth: "2019-02" }),
    classifyRecord({
      name: "한빛전자 영업 담당",
      kind: "job",
      organization: "한빛전자",
      role: "영업팀 사원",
      startMonth: "2019-07",
      endMonth: "2023-12",
      body: "거래처 관리와 주문 처리를 맡았다. 재고 정리와 재계약 자료 작성도 했다.",
    }),
    classifyRecord({
      name: "성과 사례 · 재고 정리 (STAR)",
      kind: "project",
      organization: "한빛전자",
      startMonth: "2021-03",
      endMonth: "2021-08",
      body: "상황: 창고 재고가 장부와 맞지 않았다. 한 일: 품목별로 실사 표를 만들어 매주 맞췄다. 결과: 장부 차이가 줄었다.",
    }),
    classifyRecord({
      name: "성과 사례 · 거래처 재계약 (STAR)",
      kind: "project",
      organization: "한빛전자",
      startMonth: "2022-03",
      endMonth: "2022-06",
      body: "상황: 큰 거래처의 계약 만료가 다가왔다. 한 일: 거래 내역을 정리해 재계약 자료를 만들었다. 결과: 재계약됐다.",
    }),
    classifyRecord({
      name: "AI 기반 ERP 구축",
      kind: "project",
      role: "기획",
      startMonth: "2024-01",
      endMonth: "2024-12",
      body: "사내 ERP에 AI 요약 기능을 붙이는 프로젝트. 요구사항 정리부터 시험 운영까지 맡았다.",
    }),
    classifyRecord({ name: "AI 기반 ERP 구축 · 1단계 요구사항 정리", kind: "project", startMonth: "2024-01", endMonth: "2024-04", body: "부서별 면담으로 요구사항을 정리했다." }),
    classifyRecord({ name: "AI 기반 ERP 구축 · 2단계 시험 운영", kind: "project", startMonth: "2024-05", endMonth: "2024-12", body: "영업팀에서 시험 운영하고 의견을 모았다." }),
  ],
};

function classifyRows(roles: RoleChoice[]): CheckRow[] {
  const sample = CLASSIFY_SAMPLE.name;
  const label = (index: number) => `R${index + 1}`;
  const show = (indexes: number[]) => indexes.map((i) => `${label(i)} ${roles[i].role}${roles[i].ref === null ? "" : `→${label(roles[i].ref!)}`}`).join(", ");
  const [a, b] = [roles[0], roles[1]];
  const schoolPaired = (a.role === "duplicate" && a.ref === 1 && b.role === "fact") || (b.role === "duplicate" && b.ref === 0 && a.role === "fact");
  const starScenes = roles[2].role === "head" && [3, 4].every((i) => roles[i].role === "scene" && roles[i].ref === 2);
  const erp = [5, 6, 7];
  const heads = erp.filter((i) => roles[i].role === "head");
  const erpGrouped = heads.length === 1 && erp.filter((i) => i !== heads[0]).every((i) => roles[i].role === "scene" && roles[i].ref === heads[0]);
  return [
    { sample, check: "같은 학력 둘은 하나만 남긴다", expected: "R1·R2 중 하나가 다른 하나의 duplicate", actual: show([0, 1]), pass: schoolPaired },
    { sample, check: "회사의 성과 사례는 그 재직의 장면이다", expected: "R3 head, R4·R5 scene→R3", actual: show([2, 3, 4]), pass: starScenes },
    { sample, check: "같은 이름 프로젝트 셋은 머리 하나와 장면 둘이다", expected: "하나 head, 둘 scene→그 head", actual: show(erp), pass: erpGrouped },
  ];
}

const failed = (sample: string, reason: string): CheckRow[] => [{ sample, check: "AI 호출", expected: "성공", actual: reason, pass: false }];

export async function runRecordCheck(db: Db, ai: AiClient, userId: string, now: Date = new Date()): Promise<CheckRow[]> {
  const judged = SCENE_JUDGE_SAMPLES.map(async (sample) => {
    const result = await runAi(db, ai, userId, sceneJudgeRequest(sample.scene, sample.head), now);
    return result.ok ? judgeRows(sample, result.value) : failed(sample.name, result.reason);
  });

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

  const moved = (async () => {
    const result = await requestRecordImport(db, ai, userId, describeExperience(MOVE_SPLIT_SAMPLE.record), { purpose: "migrate", hint: "job" }, now);
    return result.ok ? moveRows(result) : failed(MOVE_SPLIT_SAMPLE.name, result.reason);
  })();

  const affiliated = (async () => {
    const result = await requestAffiliation(db, ai, userId, AFFILIATE_SAMPLE.input, now);
    return result.ok ? affiliateRows(result.links) : failed(AFFILIATE_SAMPLE.name, result.reason);
  })();

  const classified = (async () => {
    const result = await requestClassify(db, ai, userId, CLASSIFY_SAMPLE.records, now);
    return result.ok ? classifyRows(result.roles) : failed(CLASSIFY_SAMPLE.name, result.reason);
  })();

  return (await Promise.all([...judged, ...extracted, imported, moved, affiliated, classified])).flat();
}
