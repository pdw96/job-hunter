// 새 경험 기록(메뉴별 표)의 선택지. 값(id)은 DB에 저장되므로 바꾸지 않는다.

export const FACT_KINDS = ["education", "course", "job", "gap", "credential", "project", "activity"] as const;
export type FactKind = (typeof FACT_KINDS)[number];
export const FACT_KIND_LABELS: Record<FactKind, string> = {
  education: "학력",
  course: "교육·과정",
  job: "경력",
  gap: "공백",
  credential: "자격·어학·수상",
  project: "프로젝트",
  activity: "활동",
};

// 장면이 딸리는 머리
export const HEAD_KINDS = ["job", "project", "activity"] as const satisfies readonly FactKind[];
export type HeadKind = (typeof HEAD_KINDS)[number];
export type HeadRef = { kind: HeadKind; id: string };

export const DEGREES = ["high", "associate", "bachelor", "master", "doctor"] as const;
export type Degree = (typeof DEGREES)[number];
export const DEGREE_LABELS: Record<Degree, string> = {
  high: "고등학교",
  associate: "전문학사",
  bachelor: "학사",
  master: "석사",
  doctor: "박사",
};

export const SCHOOL_STATUSES = ["graduated", "expected", "enrolled", "leave", "completed", "dropped"] as const;
export type SchoolStatus = (typeof SCHOOL_STATUSES)[number];
export const SCHOOL_STATUS_LABELS: Record<SchoolStatus, string> = {
  graduated: "졸업",
  expected: "졸업 예정",
  enrolled: "재학",
  leave: "휴학",
  completed: "수료",
  dropped: "중퇴",
};

export const GPA_SCALES = ["4.5", "4.3", "4.0"] as const;
export type GpaScale = (typeof GPA_SCALES)[number];

export const EMPLOYMENTS = ["regular", "contract", "intern", "freelance", "parttime"] as const;
export type Employment = (typeof EMPLOYMENTS)[number];
export const EMPLOYMENT_LABELS: Record<Employment, string> = {
  regular: "정규직",
  contract: "계약직",
  intern: "인턴",
  freelance: "프리랜서",
  parttime: "아르바이트",
};

export const CREDENTIAL_TYPES = ["license", "language", "award"] as const;
export type CredentialType = (typeof CREDENTIAL_TYPES)[number];
export const CREDENTIAL_TYPE_LABELS: Record<CredentialType, string> = {
  license: "자격증",
  language: "어학",
  award: "수상",
};

// 프로젝트가 딸릴 수 있는 조직
export const PARENT_KINDS = ["job", "education", "course"] as const satisfies readonly FactKind[];
export type ParentKind = (typeof PARENT_KINDS)[number];
export type ProjectParent = { kind: ParentKind; id: string } | null; // null = 개인

export const RECORD_LIMITS = { duties: 8, dutyLength: 100, tools: 10, summary: 200 };

export type RecordSource = "manual" | "interview" | "import" | "migrate";
