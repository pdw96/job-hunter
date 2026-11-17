import { REGION_IDS } from "@/modules/tracks/options";
import {
  CAREER_TYPES,
  type CareerType,
  POSTING_EMPLOYMENT_TYPES,
  type PostingEmploymentType,
  POSTING_LIMITS,
} from "./options";

// 공고 입력 검사. 화면과 DB를 모르는 순수 함수

export type PostingInput = {
  company: string;
  title: string;
  deadline: string | null; // YYYY-MM-DD
  isRolling: boolean;
  locationText: string | null;
  regions: string[];
  careerType: CareerType;
  minYears: number | null;
  employmentType: PostingEmploymentType;
  url: string | null;
  rawText: string;
  companyNote: string | null;
};

export type PostingErrors = Partial<Record<keyof PostingInput, string>>;

const text = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
};

// 실제로 있는 날짜인가 (2026-02-30 같은 값을 거른다)
export function isDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function validatePosting(raw: unknown): { ok: true; value: PostingInput } | { ok: false; errors: PostingErrors } {
  const data = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const errors: PostingErrors = {};

  const company = text(data.company);
  if (!company) errors.company = "회사명을 적어 주세요";
  else if (company.length > POSTING_LIMITS.shortText) errors.company = `회사명은 ${POSTING_LIMITS.shortText}자까지 쓸 수 있습니다`;

  const title = text(data.title);
  if (!title) errors.title = "직무명을 적어 주세요";
  else if (title.length > POSTING_LIMITS.shortText) errors.title = `직무명은 ${POSTING_LIMITS.shortText}자까지 쓸 수 있습니다`;

  const isRolling = data.isRolling === true;
  let deadline = text(data.deadline);
  if (deadline && !isDate(deadline)) errors.deadline = "마감일을 날짜로 적어 주세요";
  if (isRolling) deadline = null; // 상시 채용이면 마감일을 두지 않는다

  const locationText = text(data.locationText);
  if (locationText && locationText.length > POSTING_LIMITS.shortText) {
    errors.locationText = `근무지는 ${POSTING_LIMITS.shortText}자까지 쓸 수 있습니다`;
  }

  const regions = Array.isArray(data.regions) ? [...new Set(data.regions)] : [];
  // "전국 어디든"은 내 희망을 적는 값이라 공고의 근무지로는 받지 않는다
  if (!regions.every((region) => typeof region === "string" && REGION_IDS.includes(region) && region !== "anywhere")) {
    errors.regions = "지역을 목록에서 골라 주세요";
  }

  const careerType = data.careerType as CareerType;
  if (!CAREER_TYPES.includes(careerType)) errors.careerType = "신입·경력 구분을 골라 주세요";

  let minYears: number | null = null;
  if (data.minYears !== null && data.minYears !== undefined && data.minYears !== "") {
    const years = Number(data.minYears);
    if (!Number.isInteger(years) || years < 0 || years > POSTING_LIMITS.maxYears) {
      errors.minYears = `요구 경력은 0~${POSTING_LIMITS.maxYears}년 사이의 숫자로 적어 주세요`;
    } else minYears = years;
  }

  const employmentType = data.employmentType as PostingEmploymentType;
  if (!POSTING_EMPLOYMENT_TYPES.includes(employmentType)) errors.employmentType = "고용 형태를 골라 주세요";

  const url = text(data.url);
  if (url && (url.length > POSTING_LIMITS.url || !/^https?:\/\/\S+$/i.test(url))) {
    errors.url = "주소는 http:// 또는 https://로 시작하게 적어 주세요";
  }

  // 원문은 다듬지 않고 그대로 둔다(앞뒤 빈 줄만 뗀다)
  const rawText = typeof data.rawText === "string" ? data.rawText.trim() : "";
  if (rawText === "") errors.rawText = "공고 원문을 붙여 넣어 주세요";
  else if (rawText.length > POSTING_LIMITS.rawText) {
    errors.rawText = `공고 원문은 ${POSTING_LIMITS.rawText.toLocaleString()}자까지 넣을 수 있습니다`;
  }

  const companyNote = text(data.companyNote);
  if (companyNote && companyNote.length > POSTING_LIMITS.companyNote) {
    errors.companyNote = `인재상·회사 소개는 ${POSTING_LIMITS.companyNote.toLocaleString()}자까지 넣을 수 있습니다`;
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      company: company!,
      title: title!,
      deadline,
      isRolling,
      locationText,
      regions: regions as string[],
      careerType,
      minYears,
      employmentType,
      url,
      rawText,
      companyNote,
    },
  };
}
