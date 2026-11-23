import { sql } from "drizzle-orm";
import { boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { user } from "../auth/schema";
import { postings } from "../postings/schema";
import { tracks } from "../tracks/schema";
import type { AnswerTopic, QuestionKind } from "./options";
import type { Asks, Draft, ResumeContent, ResumeSelection, Selection, SubmissionContent } from "./types";

// applications 모듈: 공고별 자기소개서 문항, 고른 경험, 쓴 답, 지원자의 답(묻기), 이력서 공통본·맞춤본, 제출본

export const questions = pgTable(
  "applications_questions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    postingId: text("posting_id")
      .notNull()
      .references(() => postings.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    prompt: text("prompt").notNull(),
    charLimit: integer("char_limit"), // 글자 수 제한. 없으면 비운다
    countSpaces: boolean("count_spaces").notNull().default(true),
    version: integer("version").notNull().default(0), // 문항 글이 바뀔 때마다 1씩 오른다
    kinds: jsonb("kinds").$type<QuestionKind[]>(), // 문항 유형. 아직 안 정했으면 null
    topics: jsonb("topics").$type<AnswerTopic[]>(), // 답의 주제
    freeformItem: text("freeform_item"), // 자유양식으로 넣은 항목. 아니면 null
    selection: jsonb("selection").$type<Selection>(),
    draft: jsonb("draft").$type<Draft>(),
    asks: jsonb("asks").$type<Asks>(), // 묻기 질문. 답하면 그 항목이 빠지고, 다 빠지면 null
    answerIds: jsonb("answer_ids").$type<string[]>().notNull().default([]), // 붙인 답(applications_answers)의 id
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("applications_questions_user_posting_idx").on(t.userId, t.postingId)],
);

// 지원자의 답(묻기). 고치지 않는다: 새로 고르거나 직접 적으면 새 행을 만들고 문항에 id를 붙인다.
// 공고를 지워도 다른 공고에서 지난 답으로 다시 쓸 수 있게 남긴다(posting_id만 비운다)
export const answers = pgTable(
  "applications_answers",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    topic: text("topic").$type<AnswerTopic>().notNull(),
    question: text("question").notNull(), // 답한 질문(직접 적었으면 "직접 적음")
    answer: text("answer").notNull(),
    postingId: text("posting_id").references(() => postings.id, { onDelete: "set null" }),
    company: text("company").notNull(), // 답한 공고의 회사 이름(지난 답 표시용)
    companyKey: text("company_key"), // 지원동기·입사 후 포부일 때만 회사 이름 정리 값. 같은 값의 공고에서만 다시 쓴다
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("applications_answers_user_topic_idx").on(t.userId, t.topic)],
);

// 이력서. 공통본은 posting_id가 비고 트랙마다 1행, 맞춤본은 지원 공고마다 1행
export const resumes = pgTable(
  "applications_resumes",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    trackId: text("track_id")
      .notNull()
      .references(() => tracks.id, { onDelete: "cascade" }),
    postingId: text("posting_id").references(() => postings.id, { onDelete: "cascade" }),
    version: integer("version").notNull().default(0), // 저장마다 1씩 오른다
    selection: jsonb("selection").$type<ResumeSelection>(), // 맞춤본만
    content: jsonb("content").$type<ResumeContent>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("applications_resumes_common_idx").on(t.userId, t.trackId).where(sql`${t.postingId} is null`),
    uniqueIndex("applications_resumes_tailored_idx").on(t.postingId).where(sql`${t.postingId} is not null`),
  ],
);

// 제출본. 공고마다 번호(1, 2, …)로 쌓는다. 마지막 제출본의 reopened_at이 비어 있으면 잠긴 상태다
export const submissions = pgTable(
  "applications_submissions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    postingId: text("posting_id")
      .notNull()
      .references(() => postings.id, { onDelete: "cascade" }),
    number: integer("number").notNull(),
    content: jsonb("content").$type<SubmissionContent>().notNull(),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull(),
    reopenedAt: timestamp("reopened_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("applications_submissions_posting_number_idx").on(t.postingId, t.number),
    index("applications_submissions_user_posting_idx").on(t.userId, t.postingId),
  ],
);
