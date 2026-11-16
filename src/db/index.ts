import { neonConfig, Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import ws from "ws";
import * as schema from "./schema";
import type { Db } from "./types";

export type { Db } from "./types";

// Node에는 내장 WebSocket이 없을 수 있어 직접 지정한다
neonConfig.webSocketConstructor = ws;

// 운영용 인스턴스. Pool은 첫 쿼리 때 연결하므로 빌드 시점에는 DB에 접속하지 않는다.
// Better Auth가 트랜잭션을 쓰므로 neon-http가 아닌 풀 방식을 쓴다.
export const db: Db = drizzle(new Pool({ connectionString: process.env.DATABASE_URL }), { schema });
