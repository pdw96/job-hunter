import { extraQuestionsFor } from "./extra-questions";
import {
  APPLICANT_TYPES,
  type ApplicantType,
  CRITERIA,
  type Criterion,
  EMPLOYMENT_TYPES,
  type EmploymentType,
  MAX_JOBS,
  MAX_NAME_LENGTH,
  MAX_REGIONS,
  REGION_IDS,
  WEIGHTS_BY_RANK,
} from "./options";

// 설문의 판단 규칙. 화면과 DB를 모르는 순수 함수만 둔다.

export type SurveyJob = { ncsCode: string | null; customName: string | null };

export type SurveyInput = {
  name: string;
  majorCode: string;
  jobs: SurveyJob[];
  applicantType: ApplicantType;
  experienceMonths: number | null;
  regions: string[];
  salaryMin: number | null; // 만원
  employmentTypes: EmploymentType[];
  importanceOrder: Criterion[];
  extraAnswers: Record<string, string>;
};

export type SurveyErrors = Partial<Record<keyof SurveyInput, string>>;

// 일한 기간을 묻는 방식
export function asksExperience(applicantType: ApplicantType): "required" | "optional" | "skip" {
  if (applicantType === "experienced") return "required";
  if (applicantType === "any") return "optional";
  return "skip";
}

// 채점의 "경력 요건"을 보는 방식: 신입 가능 여부 / 요구 연차와 비교
export function experienceMode(applicantType: ApplicantType): "entryLevelOk" | "compareYears" {
  return applicantType === "new" || applicantType === "intern" ? "entryLevelOk" : "compareYears";
}

// 중요도 순서를 배점으로 바꾼다. 1위부터 30 / 25 / 20 / 15 / 10
export function weightsFromOrder(order: Criterion[]): Record<Criterion, number> {
  return Object.fromEntries(order.map((criterion, rank) => [criterion, WEIGHTS_BY_RANK[rank]])) as Record<
    Criterion,
    number
  >;
}

const isOneOf = <T extends string>(list: readonly T[], value: unknown): value is T =>
  typeof value === "string" && (list as readonly string[]).includes(value);

const unique = <T>(items: T[]): T[] => [...new Set(items)];

function parseJobs(raw: unknown): SurveyJob[] | null {
  if (!Array.isArray(raw)) return null;
  const jobs: SurveyJob[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== "object" || item === null) return null;
    const { ncsCode, customName } = item as Record<string, unknown>;
    const code = typeof ncsCode === "string" && ncsCode !== "" ? ncsCode : null;
    const custom = typeof customName === "string" && customName.trim() !== "" ? customName.trim() : null;
    if ((code === null) === (custom === null)) return null; // 둘 중 정확히 하나
    if (code !== null && !/^\d{8}$/.test(code)) return null;
    if (custom !== null && custom.length > MAX_NAME_LENGTH) return null;
    const key = code ?? `custom:${custom}`;
    if (seen.has(key)) continue;
    seen.add(key);
    jobs.push({ ncsCode: code, customName: custom });
  }
  return jobs;
}

function isWholeNumber(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

// 입력을 다듬고 검사한다. 오류 문구는 화면에 그대로 보여 준다.
export function validateSurvey(
  input: unknown,
): { ok: true; value: SurveyInput } | { ok: false; errors: SurveyErrors } {
  const raw = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
  const errors: SurveyErrors = {};

  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  if (name === "") errors.name = "트랙 이름을 입력해 주세요";
  else if (name.length > MAX_NAME_LENGTH) errors.name = `트랙 이름은 ${MAX_NAME_LENGTH}자까지 쓸 수 있습니다`;

  const majorCode = typeof raw.majorCode === "string" ? raw.majorCode : "";
  if (!/^\d{2}$/.test(majorCode)) errors.majorCode = "분야를 골라 주세요";

  const jobs = parseJobs(raw.jobs);
  if (jobs === null) errors.jobs = "직무를 다시 골라 주세요";
  else if (jobs.length === 0) errors.jobs = "직무를 하나 이상 골라 주세요";
  else if (jobs.length > MAX_JOBS) errors.jobs = `직무는 ${MAX_JOBS}개까지 고를 수 있습니다`;

  const applicantType = isOneOf(APPLICANT_TYPES, raw.applicantType) ? raw.applicantType : null;
  if (applicantType === null) errors.applicantType = "지원 유형을 골라 주세요";

  let experienceMonths: number | null = null;
  if (applicantType !== null && asksExperience(applicantType) !== "skip") {
    const given = raw.experienceMonths ?? null;
    if (given === null) {
      if (applicantType === "experienced") errors.experienceMonths = "일한 기간을 입력해 주세요";
    } else if (!isWholeNumber(given, 0, 600)) {
      errors.experienceMonths = "일한 기간을 다시 확인해 주세요";
    } else if (given === 0 && applicantType === "experienced") {
      errors.experienceMonths = "일한 기간을 입력해 주세요";
    } else {
      experienceMonths = given;
    }
  }

  let regions: string[] = [];
  if (!Array.isArray(raw.regions) || raw.regions.some((r) => !REGION_IDS.includes(r as string))) {
    errors.regions = "근무 가능 지역을 다시 골라 주세요";
  } else {
    regions = unique(raw.regions as string[]);
    if (regions.includes("anywhere")) regions = ["anywhere"];
    if (regions.length === 0) errors.regions = "근무 가능 지역을 하나 이상 골라 주세요";
    else if (regions.length > MAX_REGIONS) errors.regions = `지역은 ${MAX_REGIONS}곳까지 고를 수 있습니다`;
  }

  let salaryMin: number | null = null;
  if (raw.salaryMin !== null && raw.salaryMin !== undefined) {
    if (isWholeNumber(raw.salaryMin, 0, 100000)) salaryMin = raw.salaryMin;
    else errors.salaryMin = "희망 연봉은 만원 단위 숫자로 입력해 주세요";
  }

  let employmentTypes: EmploymentType[] = [];
  if (!Array.isArray(raw.employmentTypes) || raw.employmentTypes.some((t) => !isOneOf(EMPLOYMENT_TYPES, t))) {
    errors.employmentTypes = "고용 형태를 다시 골라 주세요";
  } else {
    employmentTypes = unique(raw.employmentTypes as EmploymentType[]);
    if (employmentTypes.includes("any")) employmentTypes = ["any"];
    if (employmentTypes.length === 0) errors.employmentTypes = "고용 형태를 하나 이상 골라 주세요";
  }

  let importanceOrder: Criterion[] = [];
  const order = raw.importanceOrder;
  if (
    Array.isArray(order) &&
    order.length === CRITERIA.length &&
    CRITERIA.every((criterion) => order.includes(criterion))
  ) {
    importanceOrder = order as Criterion[];
  } else {
    errors.importanceOrder = "중요도 순서를 다시 정해 주세요";
  }

  // 그 분야의 질문이고 선택지에 있는 답만 남긴다
  const extraAnswers: Record<string, string> = {};
  const given = (typeof raw.extraAnswers === "object" && raw.extraAnswers !== null ? raw.extraAnswers : {}) as Record<
    string,
    unknown
  >;
  for (const question of extraQuestionsFor(majorCode)) {
    const answer = given[question.id];
    if (question.options.some((option) => option.value === answer)) extraAnswers[question.id] = answer as string;
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      name,
      majorCode,
      jobs: jobs!,
      applicantType: applicantType!,
      experienceMonths,
      regions,
      salaryMin,
      employmentTypes,
      importanceOrder,
      extraAnswers,
    },
  };
}
