import { sql } from "drizzle-orm";
import { check, index, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { user } from "../auth/schema";
import { ncsCategories } from "../ncs/schema";
import type { ApplicantType, Criterion, EmploymentType } from "./options";

// tracks 모듈: 트랙(지원 방향 하나)과 그 트랙의 희망 조건·채점 배점

export const tracks = pgTable(
  "tracks_tracks",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    majorCode: text("major_code")
      .notNull()
      .references(() => ncsCategories.code),
    applicantType: text("applicant_type").$type<ApplicantType>().notNull(),
    experienceMonths: integer("experience_months"),
    regions: jsonb("regions").$type<string[]>().notNull(), // 선호 순서
    salaryMin: integer("salary_min"), // 만원
    employmentTypes: jsonb("employment_types").$type<EmploymentType[]>().notNull(),
    importanceOrder: jsonb("importance_order").$type<Criterion[]>().notNull(),
    // 저장할 때의 식으로 계산해 둔다. 나중에 식을 바꿔도 이미 만든 트랙의 기준이 조용히 바뀌지 않는다
    weights: jsonb("weights").$type<Record<Criterion, number>>().notNull(),
    extraAnswers: jsonb("extra_answers").$type<Record<string, string>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("tracks_tracks_user_idx").on(t.userId)],
);

export const trackJobs = pgTable(
  "tracks_jobs",
  {
    id: text("id").primaryKey(),
    trackId: text("track_id")
      .notNull()
      .references(() => tracks.id, { onDelete: "cascade" }),
    ncsCode: text("ncs_code").references(() => ncsCategories.code),
    customName: text("custom_name"), // NCS에 없어 직접 입력한 직무
    position: integer("position").notNull(),
  },
  (t) => [
    index("tracks_jobs_track_idx").on(t.trackId),
    check("tracks_jobs_one_of", sql`(${t.ncsCode} is null) <> (${t.customName} is null)`),
  ],
);
