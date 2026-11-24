import { formatPeriod } from "@/modules/experiences/period";
import type { CareerItemSource, CareerSource } from "@/modules/experiences/sources";
import { CAREER_LIMITS } from "./options";
import { cleanLines } from "./resume-entries";
import type { CareerCompany, CareerContent, CareerItem, ResumeDetail } from "./types";

// 경력기술서 항목을 만들고 옮기고 고치는 순수 함수. 화면과 DB를 모른다

export const lineCaps = (detail: ResumeDetail) =>
  detail === "full"
    ? { done: CAREER_LIMITS.fullDone, results: CAREER_LIMITS.fullResults }
    : { done: CAREER_LIMITS.summaryDone, results: CAREER_LIMITS.summaryResults };

// 회사 머리는 경력에서 코드가 만든다. 항목은 따로 채운다
export function buildCompany(source: CareerSource): CareerCompany {
  return {
    experienceId: source.id,
    contentVersion: source.contentVersion,
    heading: {
      company: source.company,
      department: source.department,
      title: source.title,
      period: formatPeriod("job", source.startMonth, source.endMonth, source.isOngoing),
      duties: [...source.duties],
    },
    items: [],
  };
}

export function buildItem(
  item: CareerItemSource,
  detail: ResumeDetail,
  emphasized: boolean,
  lines: { done: string[]; results: string[] },
  now: Date,
): CareerItem {
  const caps = lineCaps(detail);
  const toLines = (texts: string[]) => texts.map((text) => ({ text, edited: false }));
  return {
    experienceId: item.id,
    contentVersion: item.contentVersion,
    kind: item.itemKind,
    heading: {
      name: item.name,
      role: item.role,
      period: formatPeriod("project", item.startMonth, item.endMonth, item.isOngoing),
      tools: [...item.tools],
    },
    detail,
    emphasized,
    done: toLines(cleanLines(lines.done, caps.done)),
    results: toLines(cleanLines(lines.results, caps.results)),
    writtenAt: now.toISOString(),
  };
}

// 회사를 원천 순서(최근 순) 자리에 넣는다. 원천에 없는 회사는 건드리지 않는다
function insertCompany(companies: CareerCompany[], company: CareerCompany, sources: CareerSource[]): CareerCompany[] {
  const order = new Map(sources.map((source, index) => [source.id, index]));
  const mine = order.get(company.experienceId) ?? Number.MAX_SAFE_INTEGER;
  const at = companies.findIndex((existing) => (order.get(existing.experienceId) ?? Number.MAX_SAFE_INTEGER) > mine);
  const next = [...companies];
  next.splice(at < 0 ? next.length : at, 0, company);
  return next;
}

// 회사 머리는 source로 바꾸고(없으면 회사를 원천 순서 자리에 넣는다), 항목은 있으면 그 자리, 없으면 그 회사 끝에
export function upsertItems(content: CareerContent, sources: CareerSource[], items: { companyId: string; item: CareerItem }[]): CareerContent {
  let companies = content.companies.map((company) => ({ ...company, items: [...company.items] }));
  for (const { companyId, item } of items) {
    const source = sources.find((candidate) => candidate.id === companyId);
    let company = companies.find((existing) => existing.experienceId === companyId);
    if (!company) {
      if (!source) continue;
      company = buildCompany(source);
      companies = insertCompany(companies, company, sources);
    } else if (source) {
      const head = buildCompany(source);
      company.heading = head.heading;
      company.contentVersion = head.contentVersion;
    }
    const at = company.items.findIndex((existing) => existing.experienceId === item.experienceId);
    if (at >= 0) company.items[at] = item;
    else company.items.push(item);
  }
  return { ...content, companies };
}

// 머리만 바꾸거나, 없는 회사는 빈 회사로 원천 순서 자리에 넣는다
export function refreshCompany(content: CareerContent, source: CareerSource, sources: CareerSource[]): CareerContent {
  const fresh = buildCompany(source);
  if (content.companies.some((company) => company.experienceId === source.id)) {
    return {
      ...content,
      companies: content.companies.map((company) =>
        company.experienceId === source.id ? { ...company, heading: fresh.heading, contentVersion: fresh.contentVersion } : company,
      ),
    };
  }
  return { ...content, companies: insertCompany(content.companies, fresh, sources) };
}

// 같은 회사 안에서만 옮긴다
export function moveItem(content: CareerContent, itemId: string, direction: "up" | "down"): CareerContent {
  const step = direction === "up" ? -1 : 1;
  return {
    ...content,
    companies: content.companies.map((company) => {
      const at = company.items.findIndex((item) => item.experienceId === itemId);
      const to = at + step;
      if (at < 0 || to < 0 || to >= company.items.length) return company;
      const items = [...company.items];
      [items[at], items[to]] = [items[to], items[at]];
      return { ...company, items };
    }),
  };
}

// 경력 id면 회사째 뺀다
export function removeItem(content: CareerContent, id: string): CareerContent {
  return {
    ...content,
    companies: content.companies
      .filter((company) => company.experienceId !== id)
      .map((company) => ({ ...company, items: company.items.filter((item) => item.experienceId !== id) })),
  };
}

// 글이 그대로인 줄은 edited를 지키고, 나머지는 직접 고친 줄로 본다
export function replaceItemLines(content: CareerContent, itemId: string, field: "done" | "results", lines: string[]): CareerContent {
  return {
    ...content,
    companies: content.companies.map((company) => ({
      ...company,
      items: company.items.map((item) => {
        if (item.experienceId !== itemId) return item;
        const kept = new Set(item[field].filter((line) => !line.edited).map((line) => line.text));
        return { ...item, [field]: lines.map((text) => ({ text, edited: !kept.has(text) })) };
      }),
    })),
  };
}

// 고른 항목을 각 회사 맨 위로 고른 순서대로 올린다. 회사 순서는 그대로, 공통본의 같은 항목은 뺀다
export function emphasizeItems(
  common: CareerContent,
  chosen: { companyId: string; item: CareerItem }[],
  sources: CareerSource[],
  commonVersion: number,
): CareerContent {
  const chosenIds = new Set(chosen.map(({ item }) => item.experienceId));
  let companies = common.companies.map((company) => ({
    ...company,
    items: company.items.filter((item) => !chosenIds.has(item.experienceId)),
  }));
  for (const { companyId } of chosen) {
    if (companies.some((company) => company.experienceId === companyId)) continue;
    const source = sources.find((candidate) => candidate.id === companyId);
    if (source) companies = insertCompany(companies, buildCompany(source), sources);
  }
  companies = companies.map((company) => ({
    ...company,
    items: [...chosen.filter(({ companyId }) => companyId === company.experienceId).map(({ item }) => item), ...company.items],
  }));
  return { companies, commonVersion };
}

export const itemCount = (content: CareerContent): number => content.companies.reduce((sum, company) => sum + company.items.length, 0);

const section = (label: string, lines: { text: string }[]) => (lines.length > 0 ? [label, ...lines.map((line) => `- ${line.text}`)] : []);

// 복사용 글. 빈 칸과 빈 구역은 줄째 뺀다
export function careerText(content: CareerContent): string {
  return content.companies
    .map(({ heading, items }) => {
      const head = [
        [heading.company, heading.department, heading.title, heading.period].filter(Boolean).join(" | "),
        ...(heading.duties.length > 0 ? [`담당: ${heading.duties.join(", ")}`] : []),
      ].join("\n");
      const blocks = items.map((item) =>
        [
          `■ ${[item.heading.name, item.heading.role, item.heading.period].filter(Boolean).join(" | ")}`,
          ...(item.heading.tools.length > 0 ? [`기술: ${item.heading.tools.join(", ")}`] : []),
          ...section("한 일", item.done),
          ...section("성과", item.results),
        ].join("\n"),
      );
      return [head, ...(blocks.length > 0 ? [blocks.join("\n\n")] : [])].join("\n");
    })
    .join("\n\n\n");
}
