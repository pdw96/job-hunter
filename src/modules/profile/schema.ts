import { date, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { user } from "../auth/schema";

// profile 모듈: 연락처. 경험 기록과 분리해 보관하고 AI에게 보내지 않는다.
export const contacts = pgTable("profile_contacts", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  legalName: text("legal_name"),
  phone: text("phone"),
  address: text("address"),
  birthDate: date("birth_date"), // YYYY-MM-DD
  contactEmail: text("contact_email"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
