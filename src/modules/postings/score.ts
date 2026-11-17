import type { ApplicantType, Criterion } from "@/modules/tracks/options";
import { experienceMode } from "@/modules/tracks/survey";
import type { CriterionScore, Evidence, PostingAnalysis, PostingScore, Requirement } from "./analysis";
import { type CareerType, FIELD_SCORES, LOCATION_BY_RANK, MATCH_SCORES } from "./options";

// 공고와 트랙을 견줘 "원하는 정도"와 "자격이 맞는 정도"를 0~100으로 계산한다.
// 화면과 DB를 모르는 순수 함수다. 값을 알 수 없는 항목은 null이고, 점수 계산에서 빠진다.

// 원하는 정도는 근무지·분야, 자격이 맞는 정도는 직무 일치·경력 요건·우대 요건
export const DESIRE_CRITERIA = ["location", "field"] as const satisfies readonly Criterion[];
export const FIT_CRITERIA = ["jobMatch", "experience", "preferred"] as const satisfies readonly Criterion[];

export type ScoreInput = {
  posting: { regions: string[]; careerType: CareerType; minYears: number | null };
  track: {
    regions: string[];
    applicantType: ApplicantType;
    experienceMonths: number | null;
    weights: Record<Criterion, number>;
  };
  analysis: PostingAnalysis | null;
  usable: Usable;
};

// 지금 근거로 쓸 수 있는 경험 id → 지금의 내용 버전 (listEvidenceCandidates로 만든다)
export type Usable = ReadonlyMap<string, number>;

export const usableOf = (candidates: readonly { id: string; contentVersion: number }[]): Usable =>
  new Map(candidates.map((c) => [c.id, c.contentVersion]));

// 지금 쓸 수 있고, 맞댄 뒤 내용을 고치지 않은 경험의 근거만 센다
export const evidenceUsable = (e: Evidence, usable: Usable): boolean => usable.get(e.experienceId) === e.contentVersion;

// 경험은 쓸 수 있지만 맞댄 뒤 내용이 바뀌어 뺀 근거가 있는지 (화면이 다시 보기를 권한다)
export const hasStaleEvidence = (analysis: PostingAnalysis, usable: Usable): boolean =>
  analysis.requirements.some((r) =>
    r.evidence.some((e) => usable.has(e.experienceId) && !evidenceUsable(e, usable)),
  );

type Level = "full" | "partial" | "none";

// 근거 경험 중 지금 쓸 수 있는 것의 가장 높은 일치 정도
export function requirementLevel(requirement: Requirement, usable: Usable): Level {
  const levels = requirement.evidence.filter((e) => evidenceUsable(e, usable)).map((e) => e.level);
  if (levels.includes("full")) return "full";
  if (levels.includes("partial")) return "partial";
  return "none";
}

function locationScore(posting: ScoreInput["posting"], track: ScoreInput["track"]): number | null {
  if (posting.regions.length === 0) return null;
  if (track.regions.includes("anywhere")) return 1;
  const ranks = posting.regions.map((region) => track.regions.indexOf(region)).filter((rank) => rank >= 0);
  if (ranks.length === 0) return 0;
  return LOCATION_BY_RANK[Math.min(...ranks)] ?? 0;
}

function experienceScore(posting: ScoreInput["posting"], track: ScoreInput["track"]): number {
  if (experienceMode(track.applicantType) === "entryLevelOk") {
    return posting.careerType === "experienced" ? 0 : 1;
  }
  if (posting.careerType === "new") return 0.5;
  if (posting.minYears === null) return 1;
  const gap = posting.minYears * 12 - (track.experienceMonths ?? 0);
  if (gap <= 0) return 1;
  if (gap <= 12) return 0.7;
  if (gap <= 24) return 0.4;
  return 0;
}

// 원문에서 찾은 요구 사항만 센다. 하나도 없으면 null
function requirementsScore(
  analysis: PostingAnalysis | null,
  kind: Requirement["kind"],
  usable: Usable,
): number | null {
  if (!analysis) return null;
  const found = analysis.requirements.filter((r) => r.kind === kind && r.quoteFound);
  if (found.length === 0) return null;
  const total = found.reduce((sum, r) => sum + MATCH_SCORES[requirementLevel(r, usable)], 0);
  return total / found.length;
}

function bundle(criteria: Record<Criterion, CriterionScore>, keys: readonly Criterion[]): number | null {
  let weighted = 0;
  let weights = 0;
  for (const key of keys) {
    const { score, weight } = criteria[key];
    if (score === null) continue;
    weighted += weight * score;
    weights += weight;
  }
  return weights === 0 ? null : Math.round((weighted / weights) * 100);
}

export function scorePosting({ posting, track, analysis, usable }: ScoreInput): PostingScore {
  const scores: Record<Criterion, number | null> = {
    location: locationScore(posting, track),
    field: analysis ? FIELD_SCORES[analysis.field.level] : null,
    experience: experienceScore(posting, track),
    jobMatch: requirementsScore(analysis, "required", usable),
    preferred: requirementsScore(analysis, "preferred", usable),
  };
  const criteria = Object.fromEntries(
    (Object.keys(scores) as Criterion[]).map((c) => [c, { score: scores[c], weight: track.weights[c] }]),
  ) as Record<Criterion, CriterionScore>;
  return { desire: bundle(criteria, DESIRE_CRITERIA), fit: bundle(criteria, FIT_CRITERIA), criteria };
}
