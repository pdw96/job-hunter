import { eq } from "drizzle-orm";
import type { Db } from "@/db/types";
import { contacts } from "./schema";

export type ContactInput = {
  legalName: string | null;
  phone: string | null;
  address: string | null;
  birthDate: string | null; // YYYY-MM-DD
  contactEmail: string | null;
};

export async function getContact(db: Db, userId: string): Promise<ContactInput | null> {
  const [row] = await db
    .select({
      legalName: contacts.legalName,
      phone: contacts.phone,
      address: contacts.address,
      birthDate: contacts.birthDate,
      contactEmail: contacts.contactEmail,
    })
    .from(contacts)
    .where(eq(contacts.userId, userId))
    .limit(1);
  return row ?? null;
}

// 있으면 덮어쓰고 없으면 만든다
export async function saveContact(db: Db, userId: string, input: ContactInput): Promise<void> {
  const values = { ...input, updatedAt: new Date() };
  await db
    .insert(contacts)
    .values({ userId, ...values })
    .onConflictDoUpdate({ target: contacts.userId, set: values });
}
