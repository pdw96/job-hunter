import type { Criterion } from "@/modules/tracks/options";

// 공고 분석과 점수의 모양. 타입만 둔다(계산은 score.ts, AI 호출은 analyze.ts)

export type RequirementKind = "required" | "preferred";
export type MatchLevel = "full" | "partial";
// contentVersion은 맞댈 때의 경험 내용 버전. 그 뒤 경험을 고쳤으면 이 근거는 세지 않는다
export type Evidence = { experienceId: string; contentVersion: number; level: MatchLevel; why: string };
export type Requirement = {
  kind: RequirementKind;
  text: string;
  quote: string; // 공고 원문에서 따온 구절
  quoteFound: boolean; // quote가 원문에 실제로 있는지
  evidence: Evidence[];
};
export type FieldLevel = "same_job" | "same_field" | "other";
export type PostingAnalysis = {
  target: string; // 분야를 볼 때의 트랙 분야·직무 (fieldTarget). 트랙이 바뀌면 분야는 다시 봐야 한다
  requirements: Requirement[];
  field: { level: FieldLevel; reason: string };
  analyzedAt: string; // ISO
};

export type CriterionScore = { score: number | null; weight: number }; // score는 0~1
export type PostingScore = {
  desire: number | null; // 0~100 정수
  fit: number | null; // 0~100 정수
  criteria: Record<Criterion, CriterionScore>;
};
export type AppliedScore = PostingScore & { analyzedAt: string; appliedAt: string };
