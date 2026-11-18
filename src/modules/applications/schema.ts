import { boolean, index, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { user } from "../auth/schema";
import { postings } from "../postings/schema";
import type { Draft, Selection } from "./types";

// applications 모듈: 공고별 자기소개서 문항, 고른 경험, 쓴 답

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
    selection: jsonb("selection").$type<Selection>(),
    draft: jsonb("draft").$type<Draft>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("applications_questions_user_posting_idx").on(t.userId, t.postingId)],
);
