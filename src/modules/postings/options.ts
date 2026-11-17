// postings 모듈에서 쓰는 선택지와 한도

// 공고가 뽑는 사람: 신입 / 경력 / 신입·경력 / 적혀 있지 않음
export const CAREER_TYPES = ["new", "experienced", "both", "any"] as const;
export type CareerType = (typeof CAREER_TYPES)[number];
export const CAREER_TYPE_LABELS: Record<CareerType, string> = {
  new: "신입",
  experienced: "경력",
  both: "신입·경력",
  any: "적혀 있지 않음",
};

export const POSTING_EMPLOYMENT_TYPES = ["regular", "contract", "intern", "unknown"] as const;
export type PostingEmploymentType = (typeof POSTING_EMPLOYMENT_TYPES)[number];
export const POSTING_EMPLOYMENT_LABELS: Record<PostingEmploymentType, string> = {
  regular: "정규직",
  contract: "계약직",
  intern: "인턴",
  unknown: "적혀 있지 않음",
};

// 지원 판단. 4-1에서는 관심으로 시작하고 보류·제외만 고른다. 지원은 4-2에서 연다
export const POSTING_STATUSES = ["interest", "apply", "hold", "excluded"] as const;
export type PostingStatus = (typeof POSTING_STATUSES)[number];
export const POSTING_STATUS_LABELS: Record<PostingStatus, string> = {
  interest: "관심",
  apply: "지원",
  hold: "보류",
  excluded: "제외",
};

export const POSTING_LIMITS = {
  shortText: 100,
  url: 500,
  rawText: 30_000,
  companyNote: 10_000,
  maxYears: 40,
  perUser: 500,
};

// 요구 경력이 내 경력보다 이만큼(년) 넘게 높으면 제외 사유로 본다
export const YEARS_GAP = 2;

// 점수: 희망 지역 순위(1~5위)별 근무지 점수, 분야·요구 사항 일치 정도별 점수
export const LOCATION_BY_RANK = [1, 0.85, 0.7, 0.55, 0.4];
export const FIELD_SCORES = { same_job: 1, same_field: 0.5, other: 0 } as const;
export const MATCH_SCORES = { full: 1, partial: 0.5, none: 0 } as const;
