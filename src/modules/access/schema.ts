import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

// access 모듈: 누가 이 서비스에 들어올 수 있는지
export const allowedEmails = pgTable("access_allowed_emails", {
  // 항상 trim 후 소문자로 저장한다 (allowlist.ts의 normalizeEmail)
  email: text("email").primaryKey(),
  addedBy: text("added_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
