import { numbersIn } from "@/modules/experiences/grounding";
import type { CareerSource } from "@/modules/experiences/sources";
import { knownNumbers } from "./check";
import { detailFor } from "./resume-entries";
import type { CareerContent } from "./types";

// 경력기술서를 코드로 검사한다. 표시할 뿐 저장과 복사는 막지 않는다. 화면과 DB를 모르는 순수 함수

export type CareerItemCheck = { unavailable: boolean; empty: boolean; stale: boolean; scopeChanged: boolean; banned: string[]; ungrounded: string[] };
export type CareerCompanyCheck = { unavailable: boolean; stale: boolean; items: CareerItemCheck[] };
// missing: 넣을 수 있는데 없는 회사(id=경력 id, companyId도 같은 값)와 항목
export type CareerCheck = { companies: CareerCompanyCheck[]; missing: { id: string; name: string; companyId: string }[]; commonChanged: boolean };

const squash = (text: string) => text.replace(/\s+/g, "").toLowerCase();
const gone = (): CareerItemCheck => ({ unavailable: true, empty: false, stale: false, scopeChanged: false, banned: [], ungrounded: [] });

// currentCommonVersion이 null이면 공통본, 숫자면 맞춤본
export function checkCareer(content: CareerContent, sources: CareerSource[], currentCommonVersion: number | null): CareerCheck {
  const byId = new Map(sources.map((source) => [source.id, source]));
  const isCommon = currentCommonVersion === null;

  const companies = content.companies.map((company): CareerCompanyCheck => {
    const source = byId.get(company.experienceId);
    if (!source) return { unavailable: true, stale: false, items: company.items.map(gone) };
    const sourceItems = new Map(source.items.map((item) => [item.id, item]));
    return {
      unavailable: false,
      stale: company.contentVersion !== source.contentVersion,
      items: company.items.map((item): CareerItemCheck => {
        const current = sourceItems.get(item.experienceId);
        if (!current) return gone();
        const texts = [...item.done, ...item.results];
        const squashed = squash(texts.map((line) => line.text).join("\n"));
        const banned = [...new Set(current.bannedPhrases)].filter((phrase) => squash(phrase) !== "" && squashed.includes(squash(phrase)));
        // 이 항목의 원천 숫자만 근거다. 다른 항목의 숫자는 근거가 아니다
        const known = new Set(knownNumbers(current));
        const ungrounded = [...new Set(texts.filter((line) => !line.edited).flatMap((line) => numbersIn(line.text)).filter((n) => !known.has(n)))];
        return {
          unavailable: false,
          empty: item.detail === "full" && item.done.length === 0,
          stale: item.contentVersion !== current.contentVersion,
          scopeChanged: isCommon && item.detail !== detailFor(current.scope),
          banned,
          ungrounded,
        };
      }),
    };
  });

  const missing: CareerCheck["missing"] = [];
  for (const source of sources) {
    const company = content.companies.find((candidate) => candidate.experienceId === source.id);
    if (!company) {
      missing.push({ id: source.id, name: source.company, companyId: source.id });
    }
    const present = new Set((company?.items ?? []).map((item) => item.experienceId));
    for (const item of source.items) if (!present.has(item.id)) missing.push({ id: item.id, name: item.name, companyId: source.id });
  }

  return { companies, missing, commonChanged: !isCommon && content.commonVersion !== currentCommonVersion };
}
