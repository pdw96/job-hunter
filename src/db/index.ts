import { attachDatabasePool } from "@vercel/functions";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";
import type { Db } from "./types";

export type { Db } from "./types";

// 운영용 인스턴스. Pool은 첫 쿼리 때 연결하므로 빌드 시점에는 DB에 접속하지 않는다.
// Better Auth가 트랜잭션을 쓰므로 풀 방식을 쓴다.
// 예전에는 @neondatabase/serverless의 WebSocket 풀을 요청 사이에 다시 써서, 함수가 멈춘 사이 끊긴 연결로
// 세션 조회가 실패했다(socket hang up). Neon과 Vercel이 권하는 pg + attachDatabasePool로 바꿨다.
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// 함수가 멈추기 전에 쉬는 연결이 정리될 때까지 기다리게 한다
attachDatabasePool(pool);

// 쉬던 연결이 끊기면 pg는 풀에서 error를 낸다. 듣는 쪽이 없으면 프로세스가 죽는다.
// 끊긴 연결은 풀이 이미 버렸고 다음 쿼리는 새로 연결하므로 기록만 한다.
pool.on("error", (error) => {
  console.warn("DB 풀의 쉬던 연결이 끊겼습니다:", error.message);
});

export const db: Db = drizzle({ client: pool, schema });
