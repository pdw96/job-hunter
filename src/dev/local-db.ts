// 로컬 미리보기 전용 (npm run preview:local). 실제 배포에는 들어가지 않는다.
// 외부 DB 없이 메모리 Postgres에 마이그레이션을 적용하고 가짜 사용자를 넣어 쓴다.
import { createTestDb } from "@/db/test-db";
import type { Db } from "@/db/types";
import { user } from "@/modules/auth/schema";
import { LOCAL_USER } from "./local-user";

export type { Db } from "@/db/types";

if (process.env.VERCEL) throw new Error("로컬 미리보기는 배포 환경에서 쓸 수 없습니다");

const store = globalThis as { __localDb?: Promise<Db> };

store.__localDb ??= (async () => {
  const created = await createTestDb();
  await created.insert(user).values({ id: LOCAL_USER.id, name: LOCAL_USER.name, email: LOCAL_USER.email });
  // 기본은 빈 기록(처음 로그인한 사용자처럼 설문부터). LOCAL_SEED=career면 경력기술서를 볼 수 있는 기록을 넣는다
  if (process.env.LOCAL_SEED === "career") await (await import("./local-seed")).seedCareer(created, LOCAL_USER.id);
  return created;
})();

export const db: Db = await store.__localDb;
