import { expect, test } from "vitest";
import { createTestDb } from "./test-db";
import { allowedEmails } from "@/modules/access/schema";

test("테스트 DB에 마이그레이션이 적용되어 access_allowed_emails에 쓰고 읽을 수 있다", async () => {
  const db = await createTestDb();
  await db.insert(allowedEmails).values({ email: "a@example.com" });
  const rows = await db.select().from(allowedEmails);
  expect(rows.map((r) => r.email)).toEqual(["a@example.com"]);
});

test("createTestDb는 호출마다 서로 독립된 DB를 준다", async () => {
  const a = await createTestDb();
  const b = await createTestDb();
  await a.insert(allowedEmails).values({ email: "a@example.com" });
  expect(await b.select().from(allowedEmails)).toEqual([]);
});
