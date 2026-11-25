import type { FactsByKind } from "@/modules/experiences/facts-repo";
import { HEAD_NOUNS, type HeadKind } from "@/modules/experiences/record-options";
import { parentOptionsOf } from "../parent-options";

// 장면이 딸리는 머리의 이름 낱말. 화면 문구에 쓴다
export const HEAD_NOUN: Record<HeadKind, string> = HEAD_NOUNS;

// 장면 폼의 머리 고르기. 값은 `job:<id>`. 순서는 이력 탭의 대분류(경력·학력·교육 기관·대내외활동) 다음 프로젝트
export function headOptionsOf(facts: FactsByKind): { value: string; label: string }[] {
  return [...parentOptionsOf(facts), ...facts.project.map((f) => ({ value: `project:${f.id}`, label: `프로젝트 · ${f.value.name}` }))];
}
