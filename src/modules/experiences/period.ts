import type { Kind } from "./options";

const dot = (month: string) => month.replace("-", ".");

// 2023.03 ~ 2023.11 / 2023.03 ~ 진행 중 / 2023.06 취득
export function formatPeriod(kind: Kind, startMonth: string | null, endMonth: string | null, isOngoing: boolean) {
  if (!startMonth) return "기간 없음";
  if (kind === "certificate") return `${dot(startMonth)} 취득`;
  if (isOngoing) return `${dot(startMonth)} ~ 진행 중`;
  return endMonth ? `${dot(startMonth)} ~ ${dot(endMonth)}` : `${dot(startMonth)} ~`;
}
