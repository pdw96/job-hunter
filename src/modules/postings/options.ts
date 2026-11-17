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
