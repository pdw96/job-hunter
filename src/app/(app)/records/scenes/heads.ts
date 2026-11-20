import type { FactsByKind } from "@/modules/experiences/facts-repo";
import type { HeadKind } from "@/modules/experiences/record-options";

// 장면이 딸리는 머리의 이름 낱말. 화면 문구에 쓴다
export const HEAD_NOUN: Record<HeadKind, string> = { job: "회사", project: "프로젝트", activity: "활동" };

// 장면 폼의 머리 고르기. 값은 `job:<id>`
export function headOptionsOf(facts: Pick<FactsByKind, "job" | "project" | "activity">): { value: string; label: string }[] {
  return [
    ...facts.job.map((f) => ({ value: `job:${f.id}`, label: `경력 · ${f.value.company}` })),
    ...facts.project.map((f) => ({ value: `project:${f.id}`, label: `프로젝트 · ${f.value.name}` })),
    ...facts.activity.map((f) => ({ value: `activity:${f.id}`, label: `활동 · ${f.value.name}` })),
  ];
}
