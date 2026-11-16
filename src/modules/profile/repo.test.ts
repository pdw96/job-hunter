import { eq } from "drizzle-orm";
import { beforeEach, expect, test } from "vitest";
import { createTestDb } from "@/db/test-db";
import type { Db } from "@/db/types";
import { user } from "@/modules/auth/schema";
import { type ContactInput, getContact, saveContact } from "./repo";
import { contacts } from "./schema";

let db: Db;

const contact = (phone: string): ContactInput => ({
  legalName: "홍길동",
  phone,
  address: null,
  birthDate: "1996-01-02",
  contactEmail: null,
});

beforeEach(async () => {
  db = await createTestDb();
  await db.insert(user).values([
    { id: "u1", name: "A", email: "u1@example.com" },
    { id: "u2", name: "B", email: "u2@example.com" },
  ]);
});

test("저장한 연락처를 본인이 다시 읽을 수 있다", async () => {
  await saveContact(db, "u1", contact("010-0000-0001"));
  expect(await getContact(db, "u1")).toEqual(contact("010-0000-0001"));
});

test("다른 사용자의 연락처는 읽히지 않는다", async () => {
  await saveContact(db, "u1", contact("010-0000-0001"));
  expect(await getContact(db, "u2")).toBeNull();
});

test("두 번 저장하면 마지막 값으로 덮어쓴다", async () => {
  await saveContact(db, "u1", contact("010-0000-0001"));
  await saveContact(db, "u1", contact("010-0000-0002"));
  expect(await db.select().from(contacts).where(eq(contacts.userId, "u1"))).toHaveLength(1);
  expect((await getContact(db, "u1"))?.phone).toBe("010-0000-0002");
});

test("한 사용자의 저장이 다른 사용자의 값을 바꾸지 않는다", async () => {
  await saveContact(db, "u1", contact("010-0000-0001"));
  await saveContact(db, "u2", contact("010-0000-0002"));
  await saveContact(db, "u1", contact("010-0000-0003"));
  expect((await getContact(db, "u2"))?.phone).toBe("010-0000-0002");
});

test("사용자가 삭제되면 연락처도 함께 삭제된다", async () => {
  await saveContact(db, "u1", contact("010-0000-0001"));
  await db.delete(user).where(eq(user.id, "u1"));
  expect(await db.select().from(contacts).where(eq(contacts.userId, "u1"))).toEqual([]);
});
