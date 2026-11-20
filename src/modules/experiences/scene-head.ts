import { and, eq } from "drizzle-orm";
import type { Db } from "@/db/types";
import type { HeadRef } from "./record-options";
import type { SceneInput } from "./record-input";
import { activities, jobs, projects, scenes } from "./schema";
import type { HeadPeriod } from "./scene-rules";

// 장면이 딸린 머리(경력·프로젝트·활동)를 읽는 도우미. scenes-repo, record-claims-repo, scene-judge가 함께 쓴다.

type Tx = Pick<Db, "select">;

export type SceneHead = {
  ref: HeadRef;
  isConfirmed: boolean;
  contentVersion: number; // 머리의 내용 버전. 판정하는 사이 머리가 바뀌었는지 본다
  period: HeadPeriod;
  labels: [string, string | null][]; // AI에게 보낼 머리의 이름 칸(연락처는 없다)
};

export async function loadHead(db: Tx, userId: string, ref: HeadRef): Promise<SceneHead | null> {
  if (ref.kind === "job") {
    const [row] = await db.select().from(jobs).where(and(eq(jobs.id, ref.id), eq(jobs.userId, userId))).limit(1);
    return row && toHead(ref, row, [["회사", row.company], ["부서", row.department], ["직급", row.title]]);
  }
  if (ref.kind === "project") {
    const [row] = await db.select().from(projects).where(and(eq(projects.id, ref.id), eq(projects.userId, userId))).limit(1);
    return row && toHead(ref, row, [["프로젝트", row.name], ["역할", row.role]]);
  }
  const [row] = await db.select().from(activities).where(and(eq(activities.id, ref.id), eq(activities.userId, userId))).limit(1);
  return row && toHead(ref, row, [["활동", row.name], ["기관", row.organization]]);
}

// 머리 행을 잠그고 아직 있는지 본다(트랜잭션 안에서). 다시 옮기기(resetMoves)와 같은 순서(머리 → 사례)로 잠가, 지워지는 머리에 딸림 행을 달지 않게 한다
export async function lockHead(tx: Tx, userId: string, ref: HeadRef): Promise<boolean> {
  const table = ref.kind === "job" ? jobs : ref.kind === "project" ? projects : activities;
  const rows = await tx.select({ id: table.id }).from(table).where(and(eq(table.id, ref.id), eq(table.userId, userId))).for("update");
  return rows.length > 0;
}

function toHead(ref: HeadRef, row: HeadPeriod & { confirmedAt: Date | null; contentVersion: number }, labels: SceneHead["labels"]): SceneHead {
  return {
    ref,
    isConfirmed: row.confirmedAt !== null,
    contentVersion: row.contentVersion,
    period: { startMonth: row.startMonth, endMonth: row.endMonth, isOngoing: row.isOngoing },
    labels,
  };
}

export const headOfRow = (row: typeof scenes.$inferSelect): HeadRef =>
  row.jobId ? { kind: "job", id: row.jobId } : row.projectId ? { kind: "project", id: row.projectId } : { kind: "activity", id: row.activityId as string };

// 장면 행에서 사용자가 입력하는 칸만 고른다
export const sceneInputOf = (row: typeof scenes.$inferSelect): SceneInput => ({
  head: headOfRow(row),
  title: row.title,
  startMonth: row.startMonth,
  endMonth: row.endMonth,
  isOngoing: row.isOngoing,
  situation: row.situation,
  judgment: row.judgment,
  actions: row.actions,
  result: row.result,
  lessons: row.lessons,
  metrics: row.metrics,
  notDone: row.notDone,
  bannedPhrases: row.bannedPhrases,
  evidenceNote: row.evidenceNote,
  tags: row.tags,
});
