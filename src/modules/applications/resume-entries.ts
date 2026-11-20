import { formatPeriod } from "@/modules/experiences/period";
import type { Kind } from "@/modules/experiences/options";
import type { ResumeSource } from "@/modules/experiences/sources";
import { RESUME_LIMITS, RESUME_SECTIONS } from "./options";
import { cut } from "./text";
import type { ResumeContent, ResumeDetail, ResumeEntry } from "./types";

// 이력서 항목을 만들고 옮기고 고치는 순수 함수. 화면과 DB를 모른다

const sectionIndex = (kind: Kind) => RESUME_SECTIONS.findIndex((section) => section.kind === kind);

// 섹션 순서로 묶는다. 같은 섹션 안의 순서는 그대로
const grouped = (entries: ResumeEntry[]): ResumeEntry[] =>
  entries
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => sectionIndex(a.entry.kind) - sectionIndex(b.entry.kind) || a.index - b.index)
    .map(({ entry }) => entry);

export const detailFor = (scope: "use" | "summary"): ResumeDetail => (scope === "use" ? "full" : "summary");

export function buildEntry(source: ResumeSource, detail: ResumeDetail, emphasized: boolean, lines: string[], now: Date): ResumeEntry {
  return {
    experienceId: source.id,
    contentVersion: source.contentVersion,
    kind: source.kind,
    heading: {
      name: source.name,
      organization: source.organization,
      role: source.role,
      period: formatPeriod(source.kind, source.startMonth, source.endMonth, source.isOngoing),
    },
    detail,
    emphasized,
    lines: lines.map((text) => ({ text, edited: false })),
    writtenAt: now.toISOString(),
  };
}

// 한 줄을 다듬는다: 줄 앞뒤 공백과 글머리표를 뗀다
const normalizeLine = (line: string) => line.trim().replace(/^[-•·*○]+\s*/u, "").trim();

// 사용자가 친 글을 줄로 나눈다. 자르지 않는다
export function parseLines(text: string): string[] {
  return text.split(/\r?\n/u).map(normalizeLine).filter((line) => line !== "");
}

export function cleanLines(lines: string[], max: number): string[] {
  return lines
    .map(normalizeLine)
    .filter((line) => line !== "")
    .map((line) => cut(line, RESUME_LIMITS.line))
    .slice(0, max);
}

// 있는 항목은 그 자리에서 바꾸고, 없는 항목은 그 섹션 끝에 붙인다
export function upsertEntries(content: ResumeContent, entries: ResumeEntry[]): ResumeContent {
  const next = [...content.entries];
  for (const entry of entries) {
    const at = next.findIndex((existing) => existing.experienceId === entry.experienceId);
    if (at >= 0) next[at] = entry;
    else next.push(entry);
  }
  return { ...content, entries: grouped(next) };
}

export function moveEntry(content: ResumeContent, experienceId: string, direction: "up" | "down"): ResumeContent {
  const at = content.entries.findIndex((entry) => entry.experienceId === experienceId);
  if (at < 0) return content;
  const step = direction === "up" ? -1 : 1;
  let to = at + step;
  while (to >= 0 && to < content.entries.length && content.entries[to].kind !== content.entries[at].kind) to += step;
  if (to < 0 || to >= content.entries.length) return content;
  const next = [...content.entries];
  [next[at], next[to]] = [next[to], next[at]];
  return { ...content, entries: next };
}

export function removeEntry(content: ResumeContent, experienceId: string): ResumeContent {
  return { ...content, entries: content.entries.filter((entry) => entry.experienceId !== experienceId) };
}

// 글이 그대로인 줄은 edited를 지키고, 나머지는 직접 고친 줄로 본다
export function replaceLines(content: ResumeContent, experienceId: string, lines: string[]): ResumeContent {
  return {
    ...content,
    entries: content.entries.map((entry) => {
      if (entry.experienceId !== experienceId) return entry;
      const kept = new Set(entry.lines.filter((line) => !line.edited).map((line) => line.text));
      return { ...entry, lines: lines.map((text) => ({ text, edited: !kept.has(text) })) };
    }),
  };
}

// 고른 항목을 각 섹션 맨 위로 고른 순서대로 올린다. 공통본에 있던 같은 경험은 뺀다
export function emphasize(common: ResumeContent, chosen: ResumeEntry[], commonVersion: number): ResumeContent {
  const chosenIds = new Set(chosen.map((entry) => entry.experienceId));
  const rest = common.entries.filter((entry) => !chosenIds.has(entry.experienceId));
  return { entries: grouped([...chosen, ...rest]), commonVersion };
}

export function sections(content: ResumeContent): { kind: Kind; label: string; entries: ResumeEntry[] }[] {
  return RESUME_SECTIONS.map(({ kind, label }) => ({ kind, label, entries: content.entries.filter((entry) => entry.kind === kind) })).filter(
    (section) => section.entries.length > 0,
  );
}

// 복사용 글
export function resumeText(content: ResumeContent): string {
  return sections(content)
    .map((section) => {
      const body = section.entries.flatMap(({ heading, lines }) => [
        [heading.name, heading.organization, heading.role, heading.period].filter(Boolean).join(" | "),
        ...lines.map((line) => `- ${line.text}`),
      ]);
      return [section.label, ...body].join("\n");
    })
    .join("\n\n");
}
