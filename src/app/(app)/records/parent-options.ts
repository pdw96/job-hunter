import type { FactsByKind } from "@/modules/experiences/facts-repo";

// 프로젝트가 딸릴 수 있는 곳: 내 경력·학교·교육 과정·대내외활동. 이력 탭의 대분류 이름을 앞에 붙인다
export function parentOptionsOf(facts: FactsByKind): { value: string; label: string }[] {
  return [
    ...facts.job.map((f) => ({ value: `job:${f.id}`, label: `경력 · ${f.value.company}` })),
    ...facts.education.map((f) => ({ value: `education:${f.id}`, label: `학력 · ${f.value.schoolName}` })),
    ...facts.course.map((f) => ({ value: `course:${f.id}`, label: `교육 기관 · ${f.value.name}` })),
    ...facts.activity.map((f) => ({ value: `activity:${f.id}`, label: `대내외활동 · ${f.value.name}` })),
  ];
}
