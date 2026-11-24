import { careerText } from "@/modules/applications/career-entries";
import type { CareerCompany, SubmissionContent } from "@/modules/applications/types";

// 제출본 화면의 경력기술서 구역에 그릴 값. 경력기술서 없이 냈거나 5-7 전에 얼린 제출본(career 키 없음)이면 null(구역을 그리지 않는다)
export function submittedCareerView(content: SubmissionContent): { label: string; copyText: string; companies: CareerCompany[] } | null {
  const career = content.career;
  if (!career) return null;
  return {
    label: career.from === "tailored" ? "맞춤본" : "트랙 공통본",
    copyText: careerText(career.content),
    companies: career.content.companies,
  };
}
