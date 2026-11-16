// 설문의 선택지. 값(id)은 DB에 저장되므로 바꾸지 않는다. 화면에는 label을 보여 준다.

export const APPLICANT_TYPES = ["new", "experienced", "intern", "any"] as const;
export type ApplicantType = (typeof APPLICANT_TYPES)[number];
export const APPLICANT_TYPE_LABELS: Record<ApplicantType, string> = {
  new: "신입",
  experienced: "경력",
  intern: "인턴",
  any: "무관",
};

export const EMPLOYMENT_TYPES = ["regular", "contract", "intern", "any"] as const;
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];
export const EMPLOYMENT_TYPE_LABELS: Record<EmploymentType, string> = {
  regular: "정규직",
  contract: "계약직",
  intern: "인턴",
  any: "무관",
};

export const REGIONS = [
  { id: "anywhere", label: "전국 어디든" },
  { id: "seoul", label: "서울" },
  { id: "gyeonggi", label: "경기" },
  { id: "incheon", label: "인천" },
  { id: "busan", label: "부산" },
  { id: "daegu", label: "대구" },
  { id: "gwangju", label: "광주" },
  { id: "daejeon", label: "대전" },
  { id: "ulsan", label: "울산" },
  { id: "sejong", label: "세종" },
  { id: "gangwon", label: "강원" },
  { id: "chungbuk", label: "충북" },
  { id: "chungnam", label: "충남" },
  { id: "jeonbuk", label: "전북" },
  { id: "jeonnam", label: "전남" },
  { id: "gyeongbuk", label: "경북" },
  { id: "gyeongnam", label: "경남" },
  { id: "jeju", label: "제주" },
] as const;
export const REGION_IDS: readonly string[] = REGIONS.map((r) => r.id);
export const MAX_REGIONS = 5;

// 적합도 채점의 다섯 항목
export const CRITERIA = ["jobMatch", "location", "experience", "field", "preferred"] as const;
export type Criterion = (typeof CRITERIA)[number];
export const CRITERION_LABELS: Record<Criterion, string> = {
  jobMatch: "직무 일치",
  location: "근무지",
  experience: "경력 요건",
  field: "분야",
  preferred: "우대 요건",
};

// 중요도 1~5위의 배점. 합계 100
export const WEIGHTS_BY_RANK = [30, 25, 20, 15, 10] as const;

export const MAX_JOBS = 5;
export const MAX_NAME_LENGTH = 50;
