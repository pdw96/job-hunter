import { beforeEach, expect, test } from "vitest";
import { createTestDb } from "@/db/test-db";
import type { Db } from "@/db/types";
import { addAllowedEmail } from "@/modules/access/allowlist";
import { createAuth } from "./create-auth";
import { session, user } from "./schema";

let db: Db;
const SOURCE = { method: "oauth", oauth: { providerId: "google" } } as const;

beforeEach(async () => {
  process.env.ADMIN_EMAIL = "admin@example.com";
  process.env.BETTER_AUTH_SECRET = "test-secret-test-secret-test-secret-1234";
  process.env.BETTER_AUTH_URL = "http://localhost:3000";
  db = await createTestDb();
});

async function adapterOf(db: Db) {
  return (await createAuth(db).$context).internalAdapter;
}

test("초대받지 않은 이메일은 가입이 거부되고 사용자 행이 만들어지지 않는다", async () => {
  const adapter = await adapterOf(db);
  await expect(
    adapter.createUser({ email: "x@example.com", name: "X", emailVerified: true }, SOURCE),
  ).rejects.toMatchObject({ body: { code: "not_invited" } }); // code가 있어야 /denied로 이동한다
  expect(await db.select().from(user)).toEqual([]);
});

test("미인증 이메일은 초대받았어도 가입이 거부된다", async () => {
  await addAllowedEmail(db, "a@example.com", "admin@example.com");
  const adapter = await adapterOf(db);
  await expect(
    adapter.createUser({ email: "a@example.com", name: "A", emailVerified: false }, SOURCE),
  ).rejects.toThrow();
  expect(await db.select().from(user)).toEqual([]);
});

test("초대받은 이메일은 가입되고 세션을 만들 수 있다", async () => {
  await addAllowedEmail(db, "a@example.com", "admin@example.com");
  const adapter = await adapterOf(db);
  const created = await adapter.createUser({ email: "a@example.com", name: "A", emailVerified: true }, SOURCE);
  await adapter.createSession(created.id);
  expect((await db.select().from(user)).map((u) => u.email)).toEqual(["a@example.com"]);
  expect((await db.select().from(session)).map((s) => s.userId)).toEqual([created.id]);
});
