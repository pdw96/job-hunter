import { boolean, index, integer, jsonb, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";
import { user } from "../auth/schema";
import { tracks } from "../tracks/schema";
import type { ClaimKind, ClaimOrigin, ClaimStatus } from "./claims";
import type { Metric } from "./input";
import type { Kind, RubricItem, Scope } from "./options";
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
