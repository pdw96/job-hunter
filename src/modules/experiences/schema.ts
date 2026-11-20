import { sql } from "drizzle-orm";
import { boolean, check, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { user } from "../auth/schema";
import { tracks } from "../tracks/schema";
import type { ClaimKind, ClaimOrigin, ClaimStatus } from "./claims";
import type { Metric } from "./input";
import type { Kind, RubricItem, Scope } from "./options";
import type { CredentialType, Degree, Employment, GpaScale, RecordSource, SchoolStatus } from "./record-options";
import type { ItemStatus } from "./verification";

// experiences 모듈: 경험 기록과 그 검증 상태, 트랙별 사용 범위

// note는 미달일 때의 보완 방안. 판정을 코드·AI·사용자 중 누가 했든 같은 자리에 둔다
export type StoredRubric = Record<RubricItem, { status: ItemStatus; note: string | null }>;

export const experiences = pgTable(
  "experiences_experiences",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    kind: text("kind").$type<Kind>().notNull(),
    organization: text("organization"),
    role: text("role"),
    startMonth: text("start_month"), // YYYY-MM. 자격은 취득 월
    endMonth: text("end_month"),
    isOngoing: boolean("is_ongoing").notNull().default(false),
    situation: text("situation"),
    actions: text("actions"), // 본인이 한 일
    result: text("result"),
    metrics: jsonb("metrics").$type<Metric[]>().notNull(),
    notDone: text("not_done"), // 하지 않은 것
    bannedPhrases: jsonb("banned_phrases").$type<string[]>().notNull(), // 사용자가 승인한 것만
    evidenceNote: text("evidence_note"),
    tags: jsonb("tags").$type<string[]>().notNull(),
    rubric: jsonb("rubric").$type<StoredRubric>().notNull(),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }), // 사용자가 "내용이 맞습니다"를 누른 때
    // manual 직접 입력 / interview AI 인터뷰 / import 가져오기. 가져온 기록만 주장별 확인을 거친다
    source: text("source").$type<"manual" | "interview" | "import">().notNull().default("manual"),
    // 내용 칸이 바뀔 때마다 1씩 오른다. AI 판정처럼 시간이 걸리는 작업이, 읽었을 때의 내용에만 결과를 반영하게 한다
    contentVersion: integer("content_version").notNull().default(0),
    phraseCandidates: jsonb("phrase_candidates").$type<string[]>().notNull().default([]), // AI가 제안한 금지 표현 후보
    dismissedPhrases: jsonb("dismissed_phrases").$type<string[]>().notNull().default([]), // 사용자가 거절한 후보
    judgedAt: timestamp("judged_at", { withTimezone: true }), // AI 판정을 마지막으로 받은 때
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("experiences_experiences_user_idx").on(t.userId)],
);

// 행이 없는 (기록, 트랙)은 "사용"으로 본다
export const trackScopes = pgTable(
  "experiences_track_scopes",
  {
    experienceId: text("experience_id")
      .notNull()
      .references(() => experiences.id, { onDelete: "cascade" }),
    trackId: text("track_id")
      .notNull()
      .references(() => tracks.id, { onDelete: "cascade" }),
    scope: text("scope").$type<Scope>().notNull(),
  },
  (t) => [primaryKey({ columns: [t.experienceId, t.trackId] })],
);

export type InterviewMessage = { role: "user" | "assistant"; text: string };

// AI 인터뷰 한 번. experienceId가 있으면 그 기록의 미달 항목을 보완하는 인터뷰다
export const interviews = pgTable(
  "experiences_interviews",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    experienceId: text("experience_id").references(() => experiences.id, { onDelete: "cascade" }),
    // 새 기록: 장면(scene)에 대한 인터뷰면 sceneId, 머리(경력·프로젝트·활동)에 대한 것이면 headKind·headId
    sceneId: text("scene_id").references(() => scenes.id, { onDelete: "cascade" }),
    headKind: text("head_kind"),
    headId: text("head_id"),
    trackId: text("track_id").references(() => tracks.id, { onDelete: "set null" }), // 직무에 맞는 질문용
    messages: jsonb("messages").$type<InterviewMessage[]>().notNull(),
    status: text("status").$type<"active" | "done">().notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("experiences_interviews_user_idx").on(t.userId)],
);

// 가져온 기록의 주장. 하나씩 확인해 닫아야 그 기록을 확인할 수 있다
export const claims = pgTable(
  "experiences_claims",
  {
    id: text("id").primaryKey(),
    experienceId: text("experience_id")
      .notNull()
      .references(() => experiences.id, { onDelete: "cascade" }),
    kind: text("kind").$type<ClaimKind>().notNull(),
    quote: text("quote").notNull(), // 기록에 적힌 그대로의 구절
    phrase: text("phrase"), // "과장임"을 누르면 금지 표현에 넣을 글
    status: text("status").$type<ClaimStatus>().notNull().default("pending"),
    origin: text("origin").$type<ClaimOrigin>().notNull(),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("experiences_claims_experience_idx").on(t.experienceId)],
);

// ---- 새 경험 기록: 메뉴별 표. 전환 PR 전까지 쓰지 않는다 ----

// 모든 메뉴 표가 함께 갖는 칸
function factColumns() {
  return {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }), // 사용자가 "내용이 맞습니다"를 누른 때
    contentVersion: integer("content_version").notNull().default(0),
    source: text("source").$type<RecordSource>().notNull().default("manual"),
    trackScopes: jsonb("track_scopes").$type<Record<string, Scope>>().notNull().default({}),
    movedFrom: text("moved_from"), // 옮겨 온 옛 기록 id. 외래 키는 두지 않는다
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  };
}

export const education = pgTable(
  "experiences_education",
  {
    ...factColumns(),
    schoolName: text("school_name").notNull(),
    location: text("location"),
    degree: text("degree").$type<Degree>().notNull(),
    major: text("major"),
    startMonth: text("start_month"),
    endMonth: text("end_month"),
    status: text("status").$type<SchoolStatus>().notNull(),
    gpa: text("gpa"),
    gpaScale: text("gpa_scale").$type<GpaScale>(),
  },
  (t) => [index("experiences_education_user_idx").on(t.userId)],
);

export const courses = pgTable(
  "experiences_courses",
  {
    ...factColumns(),
    name: text("name").notNull(),
    institution: text("institution"),
    startMonth: text("start_month"),
    endMonth: text("end_month"),
    hours: integer("hours"),
    learned: text("learned"),
  },
  (t) => [index("experiences_courses_user_idx").on(t.userId)],
);

export const jobs = pgTable(
  "experiences_jobs",
  {
    ...factColumns(),
    company: text("company").notNull(),
    department: text("department"),
    title: text("title"),
    employment: text("employment").$type<Employment>().notNull(),
    startMonth: text("start_month"),
    endMonth: text("end_month"),
    isOngoing: boolean("is_ongoing").notNull().default(false),
    duties: jsonb("duties").$type<string[]>().notNull().default([]),
    bannedPhrases: jsonb("banned_phrases").$type<string[]>().notNull().default([]),
  },
  (t) => [index("experiences_jobs_user_idx").on(t.userId)],
);

export const gaps = pgTable(
  "experiences_gaps",
  {
    ...factColumns(),
    startMonth: text("start_month").notNull(),
    endMonth: text("end_month").notNull(),
    note: text("note"),
  },
  (t) => [index("experiences_gaps_user_idx").on(t.userId)],
);

export const credentials = pgTable(
  "experiences_credentials",
  {
    ...factColumns(),
    type: text("type").$type<CredentialType>().notNull(),
    name: text("name").notNull(),
    issuer: text("issuer"),
    month: text("month"),
    score: text("score"),
  },
  (t) => [index("experiences_credentials_user_idx").on(t.userId)],
);

// 딸린 조직은 job_id·education_id·course_id 중 하나까지. 모두 비면 개인 프로젝트
export const projects = pgTable(
  "experiences_projects",
  {
    ...factColumns(),
    name: text("name").notNull(),
    jobId: text("job_id").references(() => jobs.id, { onDelete: "set null" }),
    educationId: text("education_id").references(() => education.id, { onDelete: "set null" }),
    courseId: text("course_id").references(() => courses.id, { onDelete: "set null" }),
    startMonth: text("start_month"),
    endMonth: text("end_month"),
    isOngoing: boolean("is_ongoing").notNull().default(false),
    role: text("role"),
    tools: jsonb("tools").$type<string[]>().notNull().default([]),
    summary: text("summary"),
    bannedPhrases: jsonb("banned_phrases").$type<string[]>().notNull().default([]),
  },
  (t) => [
    index("experiences_projects_user_idx").on(t.userId),
    check("experiences_projects_one_parent", sql`num_nonnulls(${t.jobId}, ${t.educationId}, ${t.courseId}) <= 1`),
  ],
);

export const activities = pgTable(
  "experiences_activities",
  {
    ...factColumns(),
    name: text("name").notNull(),
    organization: text("organization"),
    startMonth: text("start_month"),
    endMonth: text("end_month"),
    isOngoing: boolean("is_ongoing").notNull().default(false),
    role: text("role"),
  },
  (t) => [index("experiences_activities_user_idx").on(t.userId)],
);

// 장면: 경력·프로젝트·활동 중 하나(머리)에 딸린 서술형 기록
export const scenes = pgTable(
  "experiences_scenes",
  {
    ...factColumns(),
    jobId: text("job_id").references(() => jobs.id),
    projectId: text("project_id").references(() => projects.id),
    activityId: text("activity_id").references(() => activities.id),
    title: text("title").notNull(),
    startMonth: text("start_month"),
    endMonth: text("end_month"),
    isOngoing: boolean("is_ongoing").notNull().default(false),
    situation: text("situation"),
    judgment: text("judgment"),
    actions: text("actions"),
    result: text("result"),
    lessons: text("lessons"),
    metrics: jsonb("metrics").$type<Metric[]>().notNull().default([]),
    notDone: text("not_done"),
    bannedPhrases: jsonb("banned_phrases").$type<string[]>().notNull().default([]),
    evidenceNote: text("evidence_note"),
    tags: jsonb("tags").$type<string[]>().notNull().default([]),
    rubric: jsonb("rubric").$type<StoredRubric>().notNull(),
    phraseCandidates: jsonb("phrase_candidates").$type<string[]>().notNull().default([]),
    dismissedPhrases: jsonb("dismissed_phrases").$type<string[]>().notNull().default([]),
    judgedAt: timestamp("judged_at", { withTimezone: true }),
  },
  (t) => [
    index("experiences_scenes_user_idx").on(t.userId),
    check("experiences_scenes_one_head", sql`num_nonnulls(${t.jobId}, ${t.projectId}, ${t.activityId}) = 1`),
  ],
);

// 새 기록의 주장. 장면·경력·프로젝트 중 하나에 딸린다
export const recordClaims = pgTable(
  "experiences_record_claims",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    sceneId: text("scene_id").references(() => scenes.id, { onDelete: "cascade" }),
    jobId: text("job_id").references(() => jobs.id, { onDelete: "cascade" }),
    projectId: text("project_id").references(() => projects.id, { onDelete: "cascade" }),
    kind: text("kind").$type<ClaimKind>().notNull(),
    quote: text("quote").notNull(),
    phrase: text("phrase"),
    status: text("status").$type<ClaimStatus>().notNull().default("pending"),
    origin: text("origin").$type<ClaimOrigin>().notNull(),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("experiences_record_claims_user_idx").on(t.userId),
    check("experiences_record_claims_one_owner", sql`num_nonnulls(${t.sceneId}, ${t.jobId}, ${t.projectId}) = 1`),
  ],
);

// 옛 기록을 새 표로 옮기는 진행 상황
export const moves = pgTable(
  "experiences_moves",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    step: text("step").$type<"record" | "affiliate">().notNull(),
    oldId: text("old_id"), // step이 record일 때 옛 기록 id
    status: text("status").$type<"pending" | "running" | "done" | "failed">().notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("experiences_moves_user_idx").on(t.userId),
    uniqueIndex("experiences_moves_user_old_idx").on(t.userId, t.oldId),
  ],
);
