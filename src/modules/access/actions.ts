"use server";

import { redirect } from "next/navigation";
import { db } from "@/db";
import { requireAdmin } from "@/lib/session";
import { addEmailAs, removeEmailAs } from "./admin-actions";

export async function addEmailAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const result = await addEmailAs(db, admin, String(formData.get("email") ?? ""));
  redirect(result.ok ? "/admin" : `/admin?error=${result.reason}`);
}

export async function removeEmailAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const result = await removeEmailAs(db, admin, String(formData.get("email") ?? ""));
  redirect(result.ok ? "/admin" : `/admin?error=${result.reason}`);
}
