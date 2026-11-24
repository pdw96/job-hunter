import type { Career } from "@/modules/applications/career-repo";
import { checkCareer, type CareerCompanyCheck, type CareerItemCheck } from "@/modules/applications/career-check";
import { careerText, itemCount } from "@/modules/applications/career-entries";
import { CAREER_LIMITS } from "@/modules/applications/options";
import type { CareerCompany, CareerItem } from "@/modules/applications/types";
import type { CareerSource } from "@/modules/experiences/sources";

// 서버 컴포넌트가 경력기술서를 지금의 기록으로 검사하고 회사·항목마다 결과를 붙여 CareerEditor에 넘길 값을 만든다

export type CareerItemView = { item: CareerItem; check: CareerItemCheck; href: string | null };
export type CareerCompanyView = { company: CareerCompany; check: CareerCompanyCheck; items: CareerItemView[] };
export type CareerEditorData = {
  careerId: string;
  version: number;
  companies: CareerCompanyView[];
  missing: { id: string; name: string; companyId: string; companyName: string; moved: boolean }[]; // 넣을 수 있는데 없는 회사(id=companyId=경력 id, name=회사 이름)와 항목. moved: 항목이 지금 다른 회사 아래에 있다(30개가 차도 제자리를 바꿔 넣을 수 있다)
  commonChanged: boolean;
  full: boolean; // 이미 항목이 한도(30개)까지 찼다
  copyText: string;
};

// currentCommonVersion이 null이면 공통본, 숫자면 맞춤본. hrefs는 항목 id → 기록 화면 주소(recordHrefs)
export function careerEditorData(
  career: Career,
  sources: CareerSource[],
  currentCommonVersion: number | null,
  hrefs: Map<string, string>,
): CareerEditorData | null {
  const content = career.content;
  if (!content) return null;
  // 검사 결과는 content.companies와, 회사마다 items와 같은 순서다
  const check = checkCareer(content, sources, currentCommonVersion);
  const placedIn = new Map(content.companies.flatMap((company) => company.items.map((item) => [item.experienceId, company.experienceId] as const)));
  const companyNames = new Map(sources.map((source) => [source.id, source.company]));
  return {
    careerId: career.id,
    version: career.version,
    companies: content.companies.map((company, index) => {
      const companyCheck = check.companies[index];
      return {
        company,
        check: companyCheck,
        items: company.items.map((item, itemIndex) => ({
          item,
          check: companyCheck.items[itemIndex],
          href: hrefs.get(item.experienceId) ?? null,
        })),
      };
    }),
    missing: check.missing.map((entry) => ({ id: entry.id, name: entry.name, companyId: entry.companyId, companyName: companyNames.get(entry.companyId) ?? "", moved: placedIn.has(entry.id) })),
    commonChanged: check.commonChanged,
    full: itemCount(content) >= CAREER_LIMITS.items,
    copyText: careerText(content),
  };
}
