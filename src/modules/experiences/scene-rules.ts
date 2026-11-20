import type { Scope } from "./options";
import { judgePeriod, type Rubric, type VerificationState, usableInApplications, verificationState } from "./verification";

// 장면의 검증 규칙. 화면과 DB를 모르는 순수 함수만 둔다. 장면은 옛 "project" 구분과 같은 규칙을 쓴다.

export type HeadPeriod = { startMonth: string | null; endMonth: string | null; isOngoing: boolean };

// 장면의 시작 월이 비어 있으면 머리의 기간으로 판정한다
export function scenePeriodStatus(scene: HeadPeriod, head: HeadPeriod): "met" | "unmet" {
  const range = scene.startMonth === null ? head : scene;
  return judgePeriod("project", range.startMonth, range.endMonth, range.isOngoing);
}

export const sceneState = (rubric: Rubric, isConfirmed: boolean): VerificationState =>
  verificationState("project", rubric, isConfirmed);

// 지원서에는 장면이 확인됨이고 머리도 확인됐을 때만 쓴다
export const sceneUsable = (state: VerificationState, headConfirmed: boolean): boolean =>
  usableInApplications(state) && headConfirmed;

const NARROWNESS: Record<Scope, number> = { use: 0, summary: 1, exclude: 2 };
// 두 범위 중 더 좁은 것: exclude > summary > use
export const narrowerScope = (a: Scope, b: Scope): Scope => (NARROWNESS[a] >= NARROWNESS[b] ? a : b);

// FNV-1a 32비트. 내용이 같은지 가볍게 비교할 때 쓴다
export function versionHash(parts: (string | number)[]): number {
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(parts.join("\u0000"))) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}
