import { and, desc, eq, inArray, sql } from "drizzle-orm";
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

// codeLines: 있으면 이력 사실(학력·자격 등). 코드가 쓴 이력서 줄이고 AI에 보내지 않는다
// duties: 경력 머리의 담당 업무. 옛 원천에는 두 칸이 없다
export type ResumeSource = WritingSource & { scope: "use" | "summary"; codeLines?: string[]; duties?: string[] };

// 이력서에 쓸 수 있는 경험. 자기소개서 쪽과 같은 거르기·순서에 "요약만"도 넣는다
export async function listResumeSources(db: Db, userId: string, trackId: string): Promise<ResumeSource[]> {
  return listSources(db, userId, trackId, ["use", "summary"]);
}

export async function listWritingSources(db: Db, userId: string, trackId: string): Promise<WritingSource[]> {
  const sources = await listSources(db, userId, trackId, ["use"]);
  return sources.map(({ scope, ...rest }) => {
    void scope;
    return rest;
  });
}

async function listSources(db: Db, userId: string, trackId: string, scopes: ("use" | "summary")[]): Promise<ResumeSource[]> {
  if (!(await ownsTrack(db, userId, trackId))) return [];
  const scopeOf = sql<"use" | "summary" | "exclude">`coalesce(${trackScopes.scope}, 'use')`;
  const rows = await db
    .select({ experience: experiences, scope: scopeOf })
    .from(experiences)
    .leftJoin(trackScopes, and(eq(trackScopes.experienceId, experiences.id), eq(trackScopes.trackId, trackId)))
    // 범위를 정하지 않은 기록은 "사용"이다
    .where(and(eq(experiences.userId, userId), inArray(scopeOf, scopes)))
    .orderBy(sql`${experiences.startMonth} desc nulls last`, desc(experiences.createdAt));

  const result: ResumeSource[] = [];
  for (const { experience: row, scope } of rows) {
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
      scope: scope === "summary" ? "summary" : "use",
    });
  }
  return result;
}
