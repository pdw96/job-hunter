import { and, desc, eq, sql } from "drizzle-orm";
import type { Db } from "@/db/types";
import { ownsTrack } from "@/modules/tracks/repo";
import type { Metric } from "./input";
import type { Experience } from "./repo";
import { statuses } from "./rubric-store";
import { experiences, trackScopes } from "./schema";
import { verificationState } from "./verification";

// 자기소개서에 쓸 수 있는 경험. 확인됨이고 그 트랙에서 "사용"인 것만("요약만"·"제외"는 빠진다).
// 수치는 루브릭의 수치가 충족인 경험만 담는다. 증빙 메모는 AI에 보내지 않으므로 이 모양에 없다

export type WritingSource = Pick<
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
  | "bannedPhrases"
  | "contentVersion"
> & { metrics: Metric[] };

export async function listWritingSources(db: Db, userId: string, trackId: string): Promise<WritingSource[]> {
  if (!(await ownsTrack(db, userId, trackId))) return [];
  const rows = await db
    .select({ experience: experiences })
    .from(experiences)
    .leftJoin(trackScopes, and(eq(trackScopes.experienceId, experiences.id), eq(trackScopes.trackId, trackId)))
    // 범위를 정하지 않은 기록은 "사용"이다
    .where(and(eq(experiences.userId, userId), sql`coalesce(${trackScopes.scope}, 'use') = 'use'`))
    .orderBy(sql`${experiences.startMonth} desc nulls last`, desc(experiences.createdAt));

  const result: WritingSource[] = [];
  for (const { experience: row } of rows) {
    if (verificationState(row.kind, statuses(row.rubric), row.confirmedAt !== null) !== "confirmed") continue;
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
      bannedPhrases: row.bannedPhrases,
      contentVersion: row.contentVersion,
      metrics: row.rubric.metrics.status === "met" ? row.metrics : [],
    });
  }
  return result;
}
