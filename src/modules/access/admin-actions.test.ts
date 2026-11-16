import { beforeEach, expect, test } from "vitest";
import { createTestDb } from "@/db/test-db";
import type { Db } from "@/db/types";
import { addEmailAs, removeEmailAs } from "./admin-actions";
import { isEmailAllowed, listAllowedEmails } from "./allowlist";
import type { CurrentUser } from "./guards";

let db: Db;
const admin: CurrentUser = { id: "a", email: "admin@example.com", name: "관리자", isAdmin: true };
const member: CurrentUser = { id: "m", email: "m@example.com", name: "지인", isAdmin: false };

beforeEach(async () => {
  process.env.ADMIN_EMAIL = "admin@example.com";
  db = await createTestDb();
});

test("관리자는 이메일을 추가할 수 있다", async () => {
  expect(await addEmailAs(db, admin, "new@example.com")).toEqual({ ok: true });
  expect(await isEmailAllowed(db, "new@example.com")).toBe(true);
});

test("일반 사용자가 추가하면 forbidden이고 목록은 그대로다", async () => {
  expect(await addEmailAs(db, member, "new@example.com")).toEqual({ ok: false, reason: "forbidden" });
  expect(await listAllowedEmails(db)).toHaveLength(0);
});

test("로그인하지 않은 호출은 forbidden이다", async () => {
  expect(await addEmailAs(db, null, "new@example.com")).toEqual({ ok: false, reason: "forbidden" });
});

test("일반 사용자는 이메일을 지울 수 없다", async () => {
  await addEmailAs(db, admin, "new@example.com");
  expect(await removeEmailAs(db, member, "new@example.com")).toEqual({ ok: false, reason: "forbidden" });
  expect(await isEmailAllowed(db, "new@example.com")).toBe(true);
});

test("관리자도 관리자 이메일은 지울 수 없다", async () => {
  expect(await removeEmailAs(db, admin, "admin@example.com")).toEqual({ ok: false, reason: "admin" });
});

test("형식이 틀린 이메일은 invalid다", async () => {
  expect(await addEmailAs(db, admin, "not-an-email")).toEqual({ ok: false, reason: "invalid" });
});
