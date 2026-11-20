import type { FactsByKind } from "@/modules/experiences/facts-repo";

// 프로젝트가 딸릴 수 있는 곳: 내 경력·학교·교육 과정
export function parentOptionsOf(facts: FactsByKind): { value: string; label: string }[] {
  return [
    ...facts.job.map((f) => ({ value: `job:${f.id}`, label: `경력 · ${f.value.company}` })),
    ...facts.education.map((f) => ({ value: `education:${f.id}`, label: `학교 · ${f.value.schoolName}` })),
    ...facts.course.map((f) => ({ value: `course:${f.id}`, label: `교육 과정 · ${f.value.name}` })),
  ];
}
