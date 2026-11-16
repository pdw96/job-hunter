import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { db } from "@/db";
import { type CurrentUser, resolveAccess } from "@/modules/access/guards";
import { getAuth } from "./auth";

// 로그인한 사용자를 돌려준다. userId는 반드시 이 함수에서만 얻는다.
// 레이아웃은 페이지 이동 때 다시 실행되지 않으므로, 모든 페이지와 서버 액션에서 직접 부른다.
export const requireUser = cache(async (): Promise<CurrentUser> => {
  const requestHeaders = await headers(); // 요청이 있을 때만 아래로 진행한다
  const auth = getAuth();
  const session = await auth.api.getSession({ headers: requestHeaders });
  const access = await resolveAccess(db, session?.user ?? null);

  if (access.kind === "anonymous") redirect("/sign-in");
  if (access.kind === "revoked") {
    // 허용 목록에서 지워진 사용자: 남아 있는 로그인을 모두 끊는다
    const ctx = await auth.$context;
    await ctx.internalAdapter.deleteUserSessions(session!.user.id);
    redirect("/denied");
  }
  return access.user;
});

// 관리자가 아니면 페이지가 없는 것처럼 보이게 한다
export async function requireAdmin(): Promise<CurrentUser> {
  const user = await requireUser();
  if (!user.isAdmin) notFound();
  return user;
}
