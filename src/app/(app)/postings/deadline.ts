import { daysLeft } from "@/modules/postings/exclusion";

// 마감일을 "D-3 (11월 20일)"처럼 보여 준다
export function deadlineLabel(deadline: string | null, isRolling: boolean, today: string): string {
  if (isRolling) return "상시 채용";
  const left = daysLeft(deadline, today);
  if (deadline === null || left === null) return "마감일 없음";
  const [, month, day] = deadline.split("-").map(Number);
  const date = `${month}월 ${day}일`;
  if (left < 0) return `마감 지남 (${date})`;
  if (left === 0) return `오늘 마감 (${date})`;
  return `D-${left} (${date})`;
}
