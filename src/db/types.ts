import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type * as schema from "./schema";

// 운영(Neon)과 테스트(PGlite) 양쪽 인스턴스를 모두 받는 공통 타입
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;
