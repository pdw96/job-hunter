// 로컬 미리보기 전용. 구글 로그인 없이 항상 같은 가짜 사용자로 로그인된 것처럼 동작한다.
import { connection } from "next/server";
import type { CurrentUser } from "@/modules/access/guards";
import { LOCAL_USER } from "./local-user";

if (process.env.VERCEL) throw new Error("로컬 미리보기는 배포 환경에서 쓸 수 없습니다");

export async function requireUser(): Promise<CurrentUser> {
  await connection(); // 실제 로그인 확인처럼 요청 때마다 실행되게 한다
  return LOCAL_USER;
}

export async function requireAdmin(): Promise<CurrentUser> {
  return requireUser();
}
