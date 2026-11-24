import type { Db } from "@/db/types";
import type { AiClient } from "@/modules/ai/client";
import { numbersIn } from "@/modules/experiences/grounding";
import type { CheckRow } from "@/modules/experiences/prompt-check";
import type { CareerItemSource, CareerSource } from "@/modules/experiences/sources";
import { buildCompany, buildItem } from "./career-entries";
import { checkCareer } from "./career-check";
import { writeCareerItems } from "./career-write";
import { detailFor } from "./resume-entries";
import { emphasisText } from "./resume-tailor";
import { cut } from "./text";

// 경력기술서 쓰기·강조 고르기 예시를 실제 AI에 돌려, 기록에 없는 것을 쓰지 않고 항목마다 제 기록만 쓰는지,
// 공고에 맞는 항목을 강조하는지 본다(관리자 전용, 호출 2번)

const SAMPLE = "경력기술서 쓰기";
const EMPHASIS_SAMPLE = "경력기술서 강조 고르기";
const EMPHASIS_POSTING = "주문 API 성능 개선 경험자";

const BASE: Pick<CareerItemSource, "organization" | "endMonth" | "isOngoing" | "notDone" | "bannedPhrases" | "contentVersion" | "metrics" | "tools" | "scope"> = {
  organization: null,
  endMonth: null,
  isOngoing: false,
  notDone: null,
  bannedPhrases: [],
  contentVersion: 0,
  metrics: [],
  tools: [],
  scope: "use",
};

// ①은 수치·하지 않은 것·금지 표현이 있는 사례이고, ②는 수치가 없는 프로젝트다
const SCENE: CareerItemSource = {
  ...BASE,
  id: "sample-career-scene",
  itemKind: "scene",
  name: "주문 API 응답 시간 개선",
  kind: "job",
  role: "백엔드 개발자",
  startMonth: "2023-03",
  situation: "주문 조회 화면이 느리다는 문의가 꾸준히 들어왔다",
  actions: "주문 API의 쿼리를 분석해 고치고 인덱스를 추가했다",
  result: "주문 조회 응답이 빨라졌다",
  notDone: "팀장 역할, 인프라 설계는 하지 않음",
  bannedPhrases: ["주도"],
  metrics: [{ text: "응답 시간 1.2초 → 0.4초", basis: "APM 주간 평균" }],
};
const PROJECT: CareerItemSource = {
  ...BASE,
  id: "sample-career-project",
  itemKind: "project",
  name: "사내 정산 시스템",
  kind: "project",
  role: "백엔드 개발자",
  startMonth: "2024-01",
  situation: "정산 담당자가 매달 엑셀로 정산을 맞췄다",
  actions: "정산 내역을 모아 보여 주는 화면과 조회 기능을 만들었다",
  result: "정산 담당자가 화면에서 바로 확인하게 되었다",
  tools: ["Kotlin", "Spring"],
};
const JOB: CareerSource = {
  id: "sample-career-job",
  company: "한빛소프트",
  department: "백엔드팀",
  title: "주임",
  startMonth: "2023-03",
  endMonth: null,
  isOngoing: true,
  duties: [],
  contentVersion: 0,
  scope: "use",
  items: [SCENE, PROJECT],
};

export async function runCareerCheck(db: Db, ai: AiClient, userId: string, now: Date = new Date()): Promise<CheckRow[]> {
  return (await Promise.all([write(db, ai, userId, now), emphasize(db, ai, userId, now)])).flat();
}

// 진단용 줄: 보이기만 하는 것이라 늘 통과한다(AI 호출을 더하지 않는다)
const diagnosticRow = (sample: string, raw: unknown): CheckRow => ({
  sample,
  check: "AI가 보낸 답(진단용)",
  expected: "-",
  actual: raw === undefined ? "AI 호출 실패" : cut(JSON.stringify(raw), 600),
  pass: true,
});

async function write(db: Db, ai: AiClient, userId: string, now: Date): Promise<CheckRow[]> {
  const row = (check: string, expected: string, actual: string, pass: boolean): CheckRow => ({ sample: SAMPLE, check, expected, actual, pass });
  const checks = [
    "①의 한 일이 비지 않는다",
    "①의 성과에 1.2초·0.4초 말고 다른 숫자가 없다",
    "쓰면 안 되는 표현(주도)이 없다",
    "인프라 설계를 했다고 쓰지 않는다",
    "②의 성과에 숫자가 없다",
    "②의 줄에 ①의 내용(응답 시간)이 섞이지 않는다",
  ];

  let raw: unknown;
  const requests = [SCENE, PROJECT].map((item) => ({ companyId: JOB.id, item, detail: detailFor(item.scope), emphasize: false }));
  const result = await writeCareerItems(db, ai, userId, { requests, posting: null }, now, (value) => {
    raw = value;
  });
  const diagnostic = () => diagnosticRow(SAMPLE, raw);
  if (!result.ok) return [...checks.map((check) => row(check, "AI 호출 성공", `실패: ${result.reason}`, false)), diagnostic()];

  const lines = (id: string) => result.value[id] ?? { done: [], results: [] };
  const [scene, project] = [lines(SCENE.id), lines(PROJECT.id)];
  const content = {
    companies: [{ ...buildCompany(JOB), items: requests.map((r) => buildItem(r.item, r.detail, false, lines(r.item.id), now)) }],
    commonVersion: null,
  };
  const [sceneCheck] = checkCareer(content, [JOB], null).companies[0].items;
  const sceneText = [...scene.done, ...scene.results];
  const infra = sceneText.some((line) => line.includes("인프라 설계"));
  const projectNumbers = [...new Set(project.results.flatMap(numbersIn))];
  const mixed = [...project.done, ...project.results].some((line) => line.includes("응답 시간"));
  return [
    row(checks[0], "1줄 이상", `${scene.done.length}줄`, scene.done.length > 0),
    row(checks[1], "없음", sceneCheck.ungrounded.join(", ") || "없음", sceneCheck.ungrounded.length === 0),
    row(checks[2], "없음", sceneCheck.banned.join(", ") || "없음", sceneCheck.banned.length === 0),
    row(checks[3], "없음", infra ? "인프라 설계를 씀" : "없음", !infra),
    row(checks[4], "없음", projectNumbers.join(", ") || "없음", projectNumbers.length === 0),
    row(checks[5], "없음", mixed ? "응답 시간이 섞임" : "없음", !mixed),
    diagnostic(),
  ];
}

// 후보는 ①(주문 API 응답 시간)과 ②(정산 화면)다. 공고는 ①에만 맞는다
async function emphasize(db: Db, ai: AiClient, userId: string, now: Date): Promise<CheckRow[]> {
  const row = (check: string, expected: string, actual: string, pass: boolean): CheckRow => ({ sample: EMPHASIS_SAMPLE, check, expected, actual, pass });
  const checks = ["①을 강조한다", "②를 강조하지 않는다", "①의 이유가 비지 않는다"];

  let raw: unknown;
  const input = { postingText: EMPHASIS_POSTING, requirements: [EMPHASIS_POSTING], sources: [SCENE, PROJECT] };
  const onRaw = (value: unknown) => {
    raw = value;
  };
  const result = await emphasisText(db, ai, userId, input, now, onRaw, "career_emphasis");
  const diagnostic = () => diagnosticRow(EMPHASIS_SAMPLE, raw);
  if (!result.ok) return [...checks.map((check) => row(check, "AI 호출 성공", `실패: ${result.reason}`, false)), diagnostic()];

  const { picks } = result.value;
  const picked = (id: string) => picks.some((pick) => pick.experienceId === id);
  // 지어낸 숫자가 든 이유는 emphasisText가 비우므로, 비어 있으면 근거를 제대로 쓰지 못한 것이다
  const scenePick = picks.find((pick) => pick.experienceId === SCENE.id);
  const hasReason = scenePick !== undefined && scenePick.why !== "";
  const pickedNames = picks.map((pick) => [SCENE, PROJECT].find((s) => s.id === pick.experienceId)?.name ?? pick.experienceId).join(", ") || "없음";
  return [
    row(checks[0], "강조함", picked(SCENE.id) ? "①을 강조함" : `강조하지 않음 · 고른 것: ${pickedNames}`, picked(SCENE.id)),
    row(checks[1], "강조하지 않음", picked(PROJECT.id) ? "②를 강조함" : "강조하지 않음", !picked(PROJECT.id)),
    row(checks[2], "이유 있음", hasReason ? "이유 있음" : "비어 있음", hasReason),
    diagnostic(),
  ];
}
