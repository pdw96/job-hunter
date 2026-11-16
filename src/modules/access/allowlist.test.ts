import { beforeEach, expect, test } from "vitest";
import { createTestDb } from "@/db/test-db";
import type { Db } from "@/db/types";
import {
  addAllowedEmail,
  isAdminEmail,
  isEmailAllowed,
  listAllowedEmails,
  removeAllowedEmail,
} from "./allowlist";

let db: Db;
const ADMIN = "admin@example.com";

beforeEach(async () => {
  process.env.ADMIN_EMAIL = ADMIN;
  db = await createTestDb();
});

test("목록에 없는 이메일은 허용되지 않는다", async () => {
  expect(await isEmailAllowed(db, "x@example.com")).toBe(false);
});

test("추가한 이메일은 허용된다", async () => {
  expect(await addAllowedEmail(db, "a@example.com", ADMIN)).toEqual({ ok: true });
  expect(await isEmailAllowed(db, "a@example.com")).toBe(true);
});

test("대소문자와 앞뒤 공백이 달라도 같은 이메일로 본다", async () => {
  await addAllowedEmail(db, " Hong@Gmail.com ", ADMIN);
  expect(await isEmailAllowed(db, "hong@gmail.com")).toBe(true);
  expect((await listAllowedEmails(db))[0].email).toBe("hong@gmail.com");
});

test("같은 이메일을 두 번 추가해도 한 건만 남는다", async () => {
  expect(await addAllowedEmail(db, "a@example.com", ADMIN)).toEqual({ ok: true });
  expect(await addAllowedEmail(db, "A@example.com", ADMIN)).toEqual({ ok: true });
  expect(await listAllowedEmails(db)).toHaveLength(1);
});

test("이메일 형식이 아니면 추가를 거부한다", async () => {
  expect(await addAllowedEmail(db, "not-an-email", ADMIN)).toEqual({ ok: false, reason: "invalid" });
  expect(await listAllowedEmails(db)).toHaveLength(0);
});

test("관리자 이메일은 목록에 없어도 허용된다", async () => {
  expect(await isEmailAllowed(db, "Admin@Example.com")).toBe(true);
});

test("관리자 이메일은 지울 수 없다", async () => {
  expect(await removeAllowedEmail(db, "admin@example.com")).toEqual({ ok: false, reason: "admin" });
});

test("지운 이메일은 더 이상 허용되지 않는다", async () => {
  await addAllowedEmail(db, "a@example.com", ADMIN);
  expect(await removeAllowedEmail(db, " A@example.com")).toEqual({ ok: true });
  expect(await isEmailAllowed(db, "a@example.com")).toBe(false);
});

test("ADMIN_EMAIL이 비어 있으면 누구도 관리자가 아니다", () => {
  process.env.ADMIN_EMAIL = "";
  expect(isAdminEmail("")).toBe(false);
  expect(isAdminEmail("a@example.com")).toBe(false);
});
