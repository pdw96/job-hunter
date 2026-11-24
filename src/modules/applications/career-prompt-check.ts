import type { Db } from "@/db/types";
import type { AiClient } from "@/modules/ai/client";
import { numbersIn } from "@/modules/experiences/grounding";
import type { CheckRow } from "@/modules/experiences/prompt-check";
import type { CareerItemSource, CareerSource } from "@/modules/experiences/sources";
import { buildCompany, buildItem } from "./career-entries";
import { checkCareer } from "./career-check";
import { writeCareerItems } from "./career-write";
import { detailFor } from "./resume-entries";
import { cut } from "./text";

// 경력기술서 쓰기 예시를 실제 AI에 돌려, 기록에 없는 것을 쓰지 않고 항목마다 제 기록만 쓰는지 본다(관리자 전용, 호출 1번)

const SAMPLE = "경력기술서 쓰기";

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
  // 진단용 줄: 보이기만 하는 것이라 늘 통과한다(AI 호출을 더하지 않는다)
  const diagnostic = () => row("AI가 보낸 답(진단용)", "-", raw === undefined ? "AI 호출 실패" : cut(JSON.stringify(raw), 600), true);
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
