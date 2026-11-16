import type { Db } from "@/db/types";
import { addAllowedEmail, removeAllowedEmail } from "./allowlist";
import type { CurrentUser } from "./guards";

// 화면을 거치지 않은 호출도 여기서 막는다
export async function addEmailAs(
  db: Db,
  actor: CurrentUser | null,
  email: string,
): Promise<{ ok: true } | { ok: false; reason: "forbidden" | "invalid" }> {
  if (!actor?.isAdmin) return { ok: false, reason: "forbidden" };
  return addAllowedEmail(db, email, actor.email);
}

export async function removeEmailAs(
  db: Db,
  actor: CurrentUser | null,
  email: string,
): Promise<{ ok: true } | { ok: false; reason: "forbidden" | "admin" }> {
  if (!actor?.isAdmin) return { ok: false, reason: "forbidden" };
  return removeAllowedEmail(db, email);
}
