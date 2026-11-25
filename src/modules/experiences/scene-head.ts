import { and, eq } from "drizzle-orm";
import type { Db } from "@/db/types";
import { DEGREE_LABELS, type HeadRef } from "./record-options";
import type { CourseInput, EducationInput, SceneInput } from "./record-input";
import { activities, courses, education, jobs, projects, scenes } from "./schema";
import type { HeadPeriod } from "./scene-rules";

// 장면이 딸린 머리(경력·학교·교육 과정·활동·프로젝트)를 읽는 도우미. scenes-repo, record-claims-repo, scene-judge가 함께 쓴다.

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
  if (ref.kind === "education") {
    const [row] = await db.select().from(education).where(and(eq(education.id, ref.id), eq(education.userId, userId))).limit(1);
    return row && toHead(ref, { ...row, ...educationPeriod(row) }, [["학교", row.schoolName], ["전공", row.major], ["학위", DEGREE_LABELS[row.degree]]]);
  }
  if (ref.kind === "course") {
    const [row] = await db.select().from(courses).where(and(eq(courses.id, ref.id), eq(courses.userId, userId))).limit(1);
    return row && toHead(ref, { ...row, ...coursePeriod(row) }, [["과정", row.name], ["기관", row.institution]]);
  }
  const [row] = await db.select().from(activities).where(and(eq(activities.id, ref.id), eq(activities.userId, userId))).limit(1);
  return row && toHead(ref, row, [["활동", row.name], ["기관", row.organization]]);
}

// 머리 행을 잠그고 아직 있는지 본다(트랜잭션 안에서). 다시 옮기기(resetMoves)와 같은 순서(머리 → 사례)로 잠가, 지워지는 머리에 딸림 행을 달지 않게 한다
export async function lockHead(tx: Tx, userId: string, ref: HeadRef): Promise<boolean> {
  const table = { job: jobs, project: projects, activity: activities, education, course: courses }[ref.kind];
  const rows = await tx.select({ id: table.id }).from(table).where(and(eq(table.id, ref.id), eq(table.userId, userId))).for("update");
  return rows.length > 0;
}

// 학교·교육 과정 표에는 isOngoing 칸이 없어 머리 기간을 규칙으로 만든다.
// 학교: 재학·휴학이면 진행 중(카드 표시와 같은 규칙). 교육 과정: 시작 월이 있고 끝 월이 없으면 진행 중(공백과 같은 규칙)
export const educationPeriod = (v: EducationInput): HeadPeriod => ({
  startMonth: v.startMonth,
  endMonth: v.endMonth,
  isOngoing: v.status === "enrolled" || v.status === "leave",
});
export const coursePeriod = (v: CourseInput): HeadPeriod => ({
  startMonth: v.startMonth,
  endMonth: v.endMonth,
  isOngoing: v.startMonth !== null && v.endMonth === null,
});

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
  row.jobId
    ? { kind: "job", id: row.jobId }
    : row.projectId
      ? { kind: "project", id: row.projectId }
      : row.educationId
        ? { kind: "education", id: row.educationId }
        : row.courseId
          ? { kind: "course", id: row.courseId }
          : { kind: "activity", id: row.activityId as string };

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
