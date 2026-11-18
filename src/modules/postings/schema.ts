import { boolean, date, index, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { user } from "../auth/schema";
import { tracks } from "../tracks/schema";
import type { AppliedScore, PostingAnalysis } from "./analysis";
import type { CareerType, PostingEmploymentType, PostingStatus } from "./options";

// postings 모듈: 사용자가 붙여 넣은 채용 공고. 트랙 하나에 속한다

export const postings = pgTable(
  "postings_postings",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    trackId: text("track_id")
      .notNull()
      .references(() => tracks.id, { onDelete: "cascade" }),
    company: text("company").notNull(),
    title: text("title").notNull(),
    deadline: date("deadline"), // YYYY-MM-DD. 상시 채용이거나 모르면 비운다
    isRolling: boolean("is_rolling").notNull().default(false),
    locationText: text("location_text"), // 공고에 적힌 근무지 표기
    regions: jsonb("regions").$type<string[]>().notNull(), // 설문의 지역 목록으로 바꾼 값
    careerType: text("career_type").$type<CareerType>().notNull(),
    minYears: integer("min_years"),
    employmentType: text("employment_type").$type<PostingEmploymentType>().notNull(),
    url: text("url"),
    rawText: text("raw_text").notNull(), // 공고 원문 전체. 고치지 않는다
    companyNote: text("company_note"), // 사용자가 더 붙여 넣은 인재상·회사 소개
    status: text("status").$type<PostingStatus>().notNull().default("interest"),
    excludeOverride: boolean("exclude_override").notNull().default(false), // 제외 사유가 있어도 진행하기로 함
    analysis: jsonb("analysis").$type<PostingAnalysis>(), // 요구 사항 분석. 원문이나 인재상 글이 바뀌면 지운다
    appliedScore: jsonb("applied_score").$type<AppliedScore>(), // 지원으로 정할 때의 점수. 이후 기준이 바뀌어도 그대로
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("postings_postings_user_track_idx").on(t.userId, t.trackId)],
);
