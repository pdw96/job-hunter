"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { requireUser } from "@/lib/session";
import { parseContactForm } from "./form";
import { saveContact } from "./repo";

export async function saveContactAction(formData: FormData): Promise<void> {
  const user = await requireUser(); // userId는 여기서만 얻는다
  await saveContact(db, user.id, parseContactForm(formData));
  revalidatePath("/settings/contact");
  redirect("/settings/contact?saved=1");
}
