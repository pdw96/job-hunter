import { getSessionCookie } from "better-auth/cookies";
import { type NextRequest, NextResponse } from "next/server";

// 로그인 쿠키가 없으면 화면을 그리기 전에 바로 로그인 화면으로 보낸다.
// 쿠키가 있는지만 보는 빠른 1차 확인이다. 실제 판정(유효한 로그인인지, 허용 목록에
// 남아 있는지)은 각 페이지와 서버 액션의 requireUser()가 한다.
export function proxy(request: NextRequest) {
  if (!getSessionCookie(request)) {
    return NextResponse.redirect(new URL("/sign-in", request.url));
  }
  return NextResponse.next();
}

export const config = {
  // 로그인 화면, 거부 화면, 로그인 API, 정적 파일은 누구나 볼 수 있다
  matcher: ["/((?!sign-in|denied|api/auth|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|ico)$).*)"],
};
