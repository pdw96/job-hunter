import { eq, sql } from "drizzle-orm";
import { expect, test } from "vitest";
import { createTestDb } from "@/db/test-db";
import { ncsCategories } from "./schema";

test("NCS 분류가 단계별로 24 / 79 / 231 / 867건 들어 있다", async () => {
  const db = await createTestDb();
  const rows = await db
    .select({ level: ncsCategories.level, count: sql<number>`count(*)::int` })
    .from(ncsCategories)
    .groupBy(ncsCategories.level)
    .orderBy(ncsCategories.level);
  expect(rows.map((r) => r.count)).toEqual([24, 79, 231, 867]);
});

test("2단계 이상은 모두 상위 분류가 있고, 대분류는 상위가 없다", async () => {
  const db = await createTestDb();
  const rows = await db.select().from(ncsCategories);
  const codes = new Set(rows.map((r) => r.code));
  for (const row of rows) {
    if (row.level === 1) expect(row.parentCode).toBeNull();
    else expect(codes.has(row.parentCode ?? "")).toBe(true);
  }
});

test("02010101은 경영기획이고 상위는 020101이다", async () => {
  const db = await createTestDb();
  const [row] = await db.select().from(ncsCategories).where(eq(ncsCategories.code, "02010101"));
  expect(row).toEqual({ code: "02010101", level: 4, name: "경영기획", parentCode: "020101" });
});
