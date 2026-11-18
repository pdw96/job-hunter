import { and, desc, eq, sql } from "drizzle-orm";
import type { Db } from "@/db/types";
import { ownsTrack } from "@/modules/tracks/repo";
import type { Experience } from "./repo";
import { statuses } from "./rubric-store";
import { experiences, trackScopes } from "./schema";
import { verificationState } from "./verification";

// 공고의 요구 사항에 근거로 댈 수 있는 경험 후보. 확인됨·부분 확인만, 그 트랙에서 제외하지 않은 것만.
// 수치와 증빙 메모는 AI에 보내지 않으므로 이 모양에 없다. contentVersion은 근거가 어느 내용으로 짚혔는지
// 남기려고 두며 AI에 보내지 않는다

export type EvidenceCandidate = Pick<
  Experience,
  | "id"
  | "name"
  | "kind"
  | "organization"
  | "role"
  | "startMonth"
  | "endMonth"
  | "isOngoing"
  | "situation"
  | "actions"
  | "result"
  | "notDone"
  | "contentVersion"
> & { state: "confirmed" | "partial" };

export async function listEvidenceCandidates(db: Db, userId: string, trackId: string): Promise<EvidenceCandidate[]> {
  if (!(await ownsTrack(db, userId, trackId))) return [];
  const rows = await db
    .select({ experience: experiences })
    .from(experiences)
    .leftJoin(trackScopes, and(eq(trackScopes.experienceId, experiences.id), eq(trackScopes.trackId, trackId)))
    // 범위를 정하지 않은 기록은 "사용"이다. 그 트랙에서 "제외"한 것만 뺀다("요약만"은 근거로 쓸 수 있다)
    .where(and(eq(experiences.userId, userId), sql`coalesce(${trackScopes.scope}, 'use') <> 'exclude'`))
    .orderBy(sql`${experiences.startMonth} desc nulls last`, desc(experiences.createdAt));

  const result: EvidenceCandidate[] = [];
  for (const { experience: row } of rows) {
    const state = verificationState(row.kind, statuses(row.rubric), row.confirmedAt !== null);
    if (state === "unconfirmed") continue;
    result.push({
      id: row.id,
      name: row.name,
      kind: row.kind,
      organization: row.organization,
      role: row.role,
      startMonth: row.startMonth,
      endMonth: row.endMonth,
      isOngoing: row.isOngoing,
      situation: row.situation,
      actions: row.actions,
      result: row.result,
      notDone: row.notDone,
      contentVersion: row.contentVersion,
      state,
    });
  }
  return result;
}
