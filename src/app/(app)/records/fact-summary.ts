import type { Fact } from "@/modules/experiences/facts-repo";
import type { FactInputs } from "@/modules/experiences/record-input";
import {
  CREDENTIAL_TYPE_LABELS,
  DEGREE_LABELS,
  EMPLOYMENT_LABELS,
  FACT_KIND_LABELS,
  type FactKind,
  SCHOOL_STATUS_LABELS,
} from "@/modules/experiences/record-options";

// 카드에 보여 줄 짧은 글. 화면 컴포넌트는 이 모양만 안다.
export type CardData = {
  kind: FactKind;
  id: string;
  title: string;
  lines: string[];
  duties: string[];
  confirmed: boolean;
};

const dot = (month: string) => month.replace("-", ".");

export function periodText(start: string | null, end: string | null, ongoing = false): string | null {
  if (!start && !end) return null;
  if (!start) return `~ ${dot(end as string)}`;
  if (ongoing) return `${dot(start)} ~ 진행 중`;
  return end ? `${dot(start)} ~ ${dot(end)}` : `${dot(start)} ~`;
}

const compact = (parts: (string | null | undefined)[]) => parts.filter((p): p is string => Boolean(p));

export function cardOf(fact: Fact, parentLabel?: string | null): CardData {
  const base = { kind: fact.kind, id: fact.id, confirmed: fact.isConfirmed, duties: [] as string[] };
  switch (fact.kind) {
    case "education": {
      const v = fact.value as FactInputs["education"];
      return {
        ...base,
        title: v.schoolName,
        lines: compact([
          [DEGREE_LABELS[v.degree], v.major].filter(Boolean).join(" "),
          v.location,
          SCHOOL_STATUS_LABELS[v.status],
          periodText(v.startMonth, v.endMonth, v.status === "enrolled" || v.status === "leave"),
          v.gpa ? `학점 ${v.gpa} / ${v.gpaScale}` : null,
        ]),
      };
    }
    case "course": {
      const v = fact.value as FactInputs["course"];
      return {
        ...base,
        title: v.name,
        lines: compact([v.institution, periodText(v.startMonth, v.endMonth), v.hours ? `${v.hours}시간` : null, v.learned]),
      };
    }
    case "job": {
      const v = fact.value as FactInputs["job"];
      return {
        ...base,
        title: v.company,
        lines: compact([EMPLOYMENT_LABELS[v.employment], v.department, v.title, periodText(v.startMonth, v.endMonth, v.isOngoing)]),
        duties: v.duties,
      };
    }
    case "gap": {
      const v = fact.value as FactInputs["gap"];
      // 공백은 끝 월이 없으면 진행 중이다
      const period = v.startMonth || v.endMonth ? periodText(v.startMonth, v.endMonth, v.startMonth !== null && v.endMonth === null) : "기간 없음";
      return { ...base, title: "공백", lines: compact([period, v.note]) };
    }
    case "credential": {
      const v = fact.value as FactInputs["credential"];
      return {
        ...base,
        title: v.name,
        lines: compact([CREDENTIAL_TYPE_LABELS[v.type], v.issuer, v.month ? `${dot(v.month)} 취득` : null, v.score]),
      };
    }
    case "project": {
      const v = fact.value as FactInputs["project"];
      return {
        ...base,
        title: v.name,
        lines: compact([parentLabel ?? "개인", v.role, periodText(v.startMonth, v.endMonth, v.isOngoing), v.tools.join(", "), v.summary]),
      };
    }
    case "activity": {
      const v = fact.value as FactInputs["activity"];
      return {
        ...base,
        title: v.name,
        lines: compact([v.organization, v.role, periodText(v.startMonth, v.endMonth, v.isOngoing)]),
      };
    }
  }
}

export const kindLabel = (kind: FactKind) => FACT_KIND_LABELS[kind];

// 추가·고친 뒤 돌아갈 탭
export const TAB_OF_KIND: Record<FactKind, string | null> = {
  education: "school",
  course: "school",
  job: "job",
  gap: "job",
  credential: "credential",
  project: null,
  activity: null,
};
