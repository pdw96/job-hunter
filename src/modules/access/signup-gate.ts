import type { Db } from "@/db/types";
import { isEmailAllowed } from "./allowlist";

export type SignUpDecision =
  | { allowed: true }
  | { allowed: false; reason: "unverified" | "not_invited" };

// 새 사용자 행을 만들기 직전에 부른다. 거부되면 행이 만들어지지 않는다.
export async function checkSignUp(
  db: Db,
  user: { email: string; emailVerified: boolean },
): Promise<SignUpDecision> {
  if (!user.emailVerified) return { allowed: false, reason: "unverified" };
  if (!(await isEmailAllowed(db, user.email))) return { allowed: false, reason: "not_invited" };
  return { allowed: true };
}
