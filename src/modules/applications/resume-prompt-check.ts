import type { Db } from "@/db/types";
import type { AiClient } from "@/modules/ai/client";
import type { CheckRow } from "@/modules/experiences/prompt-check";
import type { ResumeSource } from "@/modules/experiences/writing";
import { FULL_POSTING } from "@/modules/postings/prompt-check";
import { SAMPLE_SOURCES } from "./prompt-check";
import { checkResume } from "./resume-check";
import { buildEntry, detailFor } from "./resume-entries";
import { emphasisText } from "./resume-tailor";
import { writeResumeLines } from "./resume-write";

// 이력서 쓰기·강조 고르기 예시를 실제 AI에 돌려, 기록에 없는 것을 쓰지 않고 맞는 경험을 강조하는지 본다(관리자 전용, 호출 2번)

const SAMPLE = "이력서 쓰기·강조 고르기";

// ①②는 자소서 예시를 "사용"으로 쓰고, ③은 요약만 하는 자격이다(줄이 없어도 되는 항목)
const CERTIFICATE: ResumeSource = {
  id: "sample-resume-cert",
  name: "정보처리기사",
  kind: "certificate",
  organization: "한국산업인력공단",
  role: null,
  startMonth: "2022-11",
  endMonth: null,
  isOngoing: false,
  situation: "",
  actions: "",
  result: "",
  notDone: null,
  bannedPhrases: [],
  contentVersion: 0,
  metrics: [],
  scope: "summary",
};
const RESUME_SOURCES: ResumeSource[] = [...SAMPLE_SOURCES.map((s): ResumeSource => ({ ...s, scope: "use" })), CERTIFICATE];
const [KOTLIN, CAFE] = RESUME_SOURCES;

export async function runResumeCheck(db: Db, ai: AiClient, userId: string, now: Date = new Date()): Promise<CheckRow[]> {
  const row = (check: string, expected: string, actual: string, pass: boolean): CheckRow => ({ sample: SAMPLE, check, expected, actual, pass });
  const failed = (checks: string[], reason: string) => checks.map((check) => row(check, "AI 호출 성공", `실패: ${reason}`, false));

  const writeChecks = [
    "①의 줄이 비지 않는다",
    "①에 쓰면 안 되는 표현이 없다",
    "기록에 없는 숫자가 없다",
    "인프라 설계를 했다고 쓰지 않는다",
    "②의 줄에 ①의 내용(Kotlin, API)이 섞이지 않는다",
  ];
  const emphasisChecks = ["①을 강조한다", "②를 강조하지 않는다", "①의 이유가 비지 않는다"];

  const write = async (): Promise<CheckRow[]> => {
    const requests = RESUME_SOURCES.map((source) => ({ source, detail: detailFor(source.scope), emphasize: false }));
    const result = await writeResumeLines(db, ai, userId, { requests, posting: null }, now);
    if (!result.ok) return failed(writeChecks, result.reason);

    const entries = RESUME_SOURCES.map((s) => buildEntry(s, detailFor(s.scope), false, result.value[s.id] ?? [], now));
    const check = checkResume({ entries, commonVersion: null }, RESUME_SOURCES, null);
    const [kotlinLines, cafeLines] = [result.value[KOTLIN.id] ?? [], result.value[CAFE.id] ?? []];
    const banned = check.entries[0].banned;
    const ungrounded = [...new Set(check.entries.flatMap((e, i) => e.ungrounded.map((n) => `${RESUME_SOURCES[i].name} ${n}`)))];
    const infra = kotlinLines.some((line) => line.includes("인프라 설계"));
    const mixed = ["Kotlin", "API"].filter((word) => cafeLines.some((line) => line.includes(word)));
    return [
      row(writeChecks[0], "1줄 이상", `${kotlinLines.length}줄`, kotlinLines.length > 0),
      row(writeChecks[1], "없음", banned.join(", ") || "없음", banned.length === 0),
      row(writeChecks[2], "없음", ungrounded.join(", ") || "없음", ungrounded.length === 0),
      row(writeChecks[3], "없음", infra ? "인프라 설계를 씀" : "없음", !infra),
      row(writeChecks[4], "없음", mixed.join(", ") || "없음", mixed.length === 0),
    ];
  };

  // 강조 후보는 "사용"인 ①②만이다
  const emphasize = async (): Promise<CheckRow[]> => {
    const result = await emphasisText(db, ai, userId, { postingText: FULL_POSTING.source, requirements: [], sources: [KOTLIN, CAFE] }, now);
    if (!result.ok) return failed(emphasisChecks, result.reason);
    const { picks } = result.value;
    const picked = (id: string) => picks.some((pick) => pick.experienceId === id);
    // 지어낸 숫자가 든 이유는 emphasisText가 비우므로, 비어 있으면 근거를 제대로 쓰지 못한 것이다
    const kotlinPick = picks.find((pick) => pick.experienceId === KOTLIN.id);
    const hasReason = kotlinPick !== undefined && kotlinPick.why !== "";
    return [
      row(emphasisChecks[0], "강조함", picked(KOTLIN.id) ? "①을 강조함" : "강조하지 않음", picked(KOTLIN.id)),
      row(emphasisChecks[1], "강조하지 않음", picked(CAFE.id) ? "②를 강조함" : "강조하지 않음", !picked(CAFE.id)),
      row(emphasisChecks[2], "이유 있음", hasReason ? "이유 있음" : "비어 있음", hasReason),
    ];
  };

  return (await Promise.all([write(), emphasize()])).flat();
}
