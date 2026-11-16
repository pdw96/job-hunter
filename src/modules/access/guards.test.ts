import { beforeEach, expect, test } from "vitest";
import { createTestDb } from "@/db/test-db";
import type { Db } from "@/db/types";
import { addAllowedEmail, removeAllowedEmail } from "./allowlist";
import { resolveAccess } from "./guards";

let db: Db;
const ADMIN = "admin@example.com";
const A = { id: "u1", email: "a@example.com", name: "A" };

beforeEach(async () => {
  process.env.ADMIN_EMAIL = ADMIN;
  db = await createTestDb();
});

test("세션이 없으면 anonymous", async () => {
  expect(await resolveAccess(db, null)).toEqual({ kind: "anonymous" });
});

test("허용 목록에 있는 사용자는 ok이고 isAdmin은 false", async () => {
  await addAllowedEmail(db, "a@example.com", ADMIN);
  expect(await resolveAccess(db, A)).toEqual({ kind: "ok", user: { ...A, isAdmin: false } });
});

test("관리자 이메일은 ok이고 isAdmin은 true", async () => {
  const admin = { id: "u0", email: ADMIN, name: "관리자" };
  expect(await resolveAccess(db, admin)).toEqual({ kind: "ok", user: { ...admin, isAdmin: true } });
});

test("로그인된 상태에서 허용 목록에서 지워지면 revoked", async () => {
  await addAllowedEmail(db, "a@example.com", ADMIN);
  await removeAllowedEmail(db, "a@example.com");
  expect(await resolveAccess(db, A)).toEqual({ kind: "revoked" });
});
