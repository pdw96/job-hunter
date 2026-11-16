import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import type { Db } from "@/db/types";
import { checkSignUp } from "@/modules/access/signup-gate";
import { account, session, user, verification } from "./schema";

// 구글 로그인만 켠다. 이메일·비밀번호 로그인은 켜지 않는다.
export function createAuth(db: Db) {
  return betterAuth({
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: { user, session, account, verification },
    }),
    socialProviders: {
      google: {
        clientId: process.env.GOOGLE_CLIENT_ID ?? "",
        clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      },
    },
    databaseHooks: {
      user: {
        create: {
          // 허용 목록에 없거나 미인증이면 사용자 행을 만들지 않는다
          before: async (newUser) => {
            const decision = await checkSignUp(db, {
              email: newUser.email,
              emailVerified: newUser.emailVerified === true,
            });
            if (!decision.allowed) {
              throw new APIError("FORBIDDEN", { message: decision.reason });
            }
          },
        },
      },
    },
    // 가입이 거부된 로그인 흐름은 안내 화면으로 보낸다
    onAPIError: { errorURL: "/denied" },
    plugins: [nextCookies()], // 항상 마지막
  });
}
