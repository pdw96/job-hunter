import { db } from "@/db";
import { createAuth } from "@/modules/auth/create-auth";

type Auth = ReturnType<typeof createAuth>;
let instance: Auth | undefined;

// 처음 쓸 때 만든다. 빌드 시점에는 비밀값이 없어도 되게 하기 위해서다.
export function getAuth(): Auth {
  instance ??= createAuth(db);
  return instance;
}
