import { asc, eq } from "drizzle-orm";
import type { Db } from "@/db/types";
import { allowedEmails } from "./schema";

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(email));
}

export function isAdminEmail(email: string): boolean {
  const admin = normalizeEmail(process.env.ADMIN_EMAIL ?? "");
  return admin !== "" && normalizeEmail(email) === admin;
}

export async function isEmailAllowed(db: Db, email: string): Promise<boolean> {
  if (isAdminEmail(email)) return true;
  const rows = await db
    .select({ email: allowedEmails.email })
    .from(allowedEmails)
    .where(eq(allowedEmails.email, normalizeEmail(email)))
    .limit(1);
  return rows.length > 0;
}

export async function listAllowedEmails(
  db: Db,
): Promise<{ email: string; addedBy: string | null; createdAt: Date }[]> {
  return db.select().from(allowedEmails).orderBy(asc(allowedEmails.createdAt), asc(allowedEmails.email));
}

export async function addAllowedEmail(
  db: Db,
  email: string,
  addedBy: string,
): Promise<{ ok: true } | { ok: false; reason: "invalid" }> {
  if (!isValidEmail(email)) return { ok: false, reason: "invalid" };
  await db
    .insert(allowedEmails)
    .values({ email: normalizeEmail(email), addedBy: normalizeEmail(addedBy) })
    .onConflictDoNothing();
  return { ok: true };
}

export async function removeAllowedEmail(
  db: Db,
  email: string,
): Promise<{ ok: true } | { ok: false; reason: "admin" }> {
  if (isAdminEmail(email)) return { ok: false, reason: "admin" };
  await db.delete(allowedEmails).where(eq(allowedEmails.email, normalizeEmail(email)));
  return { ok: true };
}
