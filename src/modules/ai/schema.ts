import { index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { user } from "../auth/schema";

// ai 모듈: AI 호출 한 번마다 한 줄. 월 한도 계산과 사용량 표시에 쓴다.
export const aiUsage = pgTable(
  "ai_usage",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    purpose: text("purpose").notNull(), // judge / interview / extract
    model: text("model").notNull(),
    inputTokens: integer("input_tokens").notNull(),
    outputTokens: integer("output_tokens").notNull(),
    cacheReadTokens: integer("cache_read_tokens").notNull(),
    cacheWriteTokens: integer("cache_write_tokens").notNull(),
    costMicroUsd: integer("cost_micro_usd").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ai_usage_user_time_idx").on(t.userId, t.createdAt)],
);
