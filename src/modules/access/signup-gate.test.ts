import { beforeEach, expect, test } from "vitest";
import { createTestDb } from "@/db/test-db";
import type { Db } from "@/db/types";
import { addAllowedEmail } from "./allowlist";
import { checkSignUp } from "./signup-gate";

let db: Db;

beforeEach(async () => {
  process.env.ADMIN_EMAIL = "admin@example.com";
  db = await createTestDb();
});

test("목록에 없는 이메일은 not_invited로 거부한다", async () => {
  expect(await checkSignUp(db, { email: "x@example.com", emailVerified: true })).toEqual({
    allowed: false,
    reason: "not_invited",
  });
});

test("목록에 있고 인증된 이메일은 허용한다", async () => {
  await addAllowedEmail(db, "a@example.com", "admin@example.com");
  expect(await checkSignUp(db, { email: "a@example.com", emailVerified: true })).toEqual({ allowed: true });
});

test("목록에 있어도 구글이 미인증으로 준 이메일은 unverified로 거부한다", async () => {
  await addAllowedEmail(db, "a@example.com", "admin@example.com");
  expect(await checkSignUp(db, { email: "a@example.com", emailVerified: false })).toEqual({
    allowed: false,
    reason: "unverified",
  });
});

test("관리자 이메일은 목록에 없어도 허용한다", async () => {
  expect(await checkSignUp(db, { email: "admin@example.com", emailVerified: true })).toEqual({ allowed: true });
});
