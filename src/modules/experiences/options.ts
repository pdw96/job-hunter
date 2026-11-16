// 경험 기록의 선택지. 값(id)은 DB에 저장되므로 바꾸지 않는다.

export const KINDS = ["job", "project", "training", "school", "certificate", "gap", "other"] as const;
export type Kind = (typeof KINDS)[number];
export const KIND_LABELS: Record<Kind, string> = {
  job: "재직",
  project: "프로젝트",
  training: "교육",
  school: "학력",
  certificate: "자격",
  gap: "공백",
  other: "기타",
};

// 검증 루브릭의 다섯 항목
export const RUBRIC_ITEMS = ["period", "role", "level", "metrics", "evidence"] as const;
export type RubricItem = (typeof RUBRIC_ITEMS)[number];
export const RUBRIC_ITEM_LABELS: Record<RubricItem, string> = {
  period: "기간",
  role: "본인 역할",
  level: "수준",
  metrics: "수치",
  evidence: "증빙",
};
export const RUBRIC_ITEM_QUESTIONS: Record<RubricItem, string> = {
  period: "시작과 끝이 월 단위로 적혀 있는가",
  role: "본인이 한 일과 팀·타 부서가 한 일이 구분되어 있는가",
  level: "어느 수준까지 했는지, 하지 않은 것이 무엇인지 적혀 있는가",
  metrics: "수치가 있다면 기준과 산출 근거가 적혀 있는가",
  evidence: "뒷받침할 서류나 자료가 있는가",
};

// 트랙별 사용 범위
export const SCOPES = ["use", "summary", "exclude"] as const;
export type Scope = (typeof SCOPES)[number];
export const SCOPE_LABELS: Record<Scope, string> = { use: "사용", summary: "요약만", exclude: "제외" };
export const DEFAULT_SCOPE: Scope = "use";

export const VERIFICATION_LABELS = { unconfirmed: "미확인", partial: "부분 확인", confirmed: "확인됨" } as const;

export const LIMITS = { shortText: 100, longText: 4000, metrics: 10, tags: 10, tagLength: 30, bannedPhrases: 30 };
