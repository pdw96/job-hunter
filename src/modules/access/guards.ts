import type { Db } from "@/db/types";
import { isAdminEmail, isEmailAllowed } from "./allowlist";

export type CurrentUser = { id: string; email: string; name: string; isAdmin: boolean };

export type Access =
  | { kind: "anonymous" }
  | { kind: "revoked" }
  | { kind: "ok"; user: CurrentUser };

// 세션의 사용자가 지금도 들어올 수 있는지 판정한다.
// 관리자 여부는 DB에 저장하지 않고 매번 ADMIN_EMAIL과 비교한다.
export async function resolveAccess(
  db: Db,
  sessionUser: { id: string; email: string; name: string } | null,
): Promise<Access> {
  if (!sessionUser) return { kind: "anonymous" };
  if (!(await isEmailAllowed(db, sessionUser.email))) return { kind: "revoked" };
  return {
    kind: "ok",
    user: {
      id: sessionUser.id,
      email: sessionUser.email,
      name: sessionUser.name,
      isAdmin: isAdminEmail(sessionUser.email),
    },
  };
}
