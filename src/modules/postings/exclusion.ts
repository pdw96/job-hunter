import type { ApplicantType, EmploymentType } from "@/modules/tracks/options";
import { type CareerType, type PostingEmploymentType, YEARS_GAP } from "./options";

// 제외 조건. 점수를 매기기 전에, 트랙의 희망 조건과 맞지 않는 공고를 알려 준다.
// 화면과 DB를 모르는 순수 함수다. 값을 알 수 없으면 걸리지 않는 쪽으로 둔다(모르는 것을 이유로 제외하지 않는다).

export type ExclusionReason = "deadline_passed" | "experience_too_high" | "location_outside" | "employment_mismatch";

export const EXCLUSION_LABELS: Record<ExclusionReason, string> = {
  deadline_passed: "마감이 지났습니다",
  experience_too_high: "요구 경력이 내 경력보다 높습니다",
  location_outside: "근무지가 희망 지역 밖입니다",
  employment_mismatch: "고용 형태가 희망과 다릅니다",
};

type PostingFacts = {
  deadline: string | null;
  isRolling: boolean;
  regions: string[];
  careerType: CareerType;
  minYears: number | null;
  employmentType: PostingEmploymentType;
};

type TrackWishes = {
  applicantType: ApplicantType;
  experienceMonths: number | null;
  regions: string[];
  employmentTypes: EmploymentType[];
};

function experienceTooHigh(posting: PostingFacts, track: TrackWishes): boolean {
  // 신입·인턴으로 지원하는 트랙: 경력만 뽑는 공고가 걸린다
  if (track.applicantType === "new" || track.applicantType === "intern") {
    return posting.careerType === "experienced";
  }
  // 경력·무관 트랙: 요구 연차와 내 경력을 견준다. 어느 쪽이든 모르면 걸리지 않는다
  if (posting.minYears === null || track.experienceMonths === null) return false;
  return posting.minYears * 12 > track.experienceMonths + YEARS_GAP * 12;
}

// today는 YYYY-MM-DD (사용자가 있는 곳의 오늘)
export function exclusionReasons(posting: PostingFacts, track: TrackWishes, today: string): ExclusionReason[] {
  const reasons: ExclusionReason[] = [];

  if (!posting.isRolling && posting.deadline !== null && posting.deadline < today) reasons.push("deadline_passed");

  if (experienceTooHigh(posting, track)) reasons.push("experience_too_high");

  if (
    posting.regions.length > 0 &&
    !track.regions.includes("anywhere") &&
    !posting.regions.some((region) => track.regions.includes(region))
  ) {
    reasons.push("location_outside");
  }

  if (
    posting.employmentType !== "unknown" &&
    !track.employmentTypes.includes("any") &&
    !track.employmentTypes.includes(posting.employmentType)
  ) {
    reasons.push("employment_mismatch");
  }

  return reasons;
}

// 마감까지 남은 날. 지났으면 음수, 마감일이 없으면 null
export function daysLeft(deadline: string | null, today: string): number | null {
  if (deadline === null) return null;
  const day = (value: string) => Date.parse(`${value}T00:00:00Z`) / 86_400_000;
  return Math.round(day(deadline) - day(today));
}
