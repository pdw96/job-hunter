import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "./schema";
import type { Db } from "./types";

// 마이그레이션을 마친 빈 DB의 데이터 디렉터리. 테스트 파일(작업자)마다 한 번만 만든다.
// 새 PGlite를 처음부터 띄우는 것(initdb)이 테스트 하나에 2초 가까이 걸려, 그다음부터는 이 사본을 읽어 띄운다
let migrated: Promise<File | Blob> | null = null;

async function migratedDataDir(): Promise<File | Blob> {
  const pg = new PGlite();
  await migrate(drizzle(pg, { schema }), { migrationsFolder: "./drizzle" });
  const dump = await pg.dumpDataDir("none");
  await pg.close();
  return dump;
}

// 테스트 하나(beforeEach~afterEach) 안에서 만든 DB. 사본에서 띄운 DB는 닫지 않으면 메모리가 쌓인다(src/test-setup.ts가 닫는다)
let inTest: PGlite[] | null = null;

export function beginTestDbScope(): void {
  inTest = [];
}

export async function endTestDbScope(): Promise<void> {
  const opened = inTest ?? [];
  inTest = null;
  await Promise.all(opened.map((pg) => pg.close()));
}

// 메모리 Postgres에 실제 마이그레이션을 모두 적용한 새 DB를 만든다. 호출마다 서로 독립이다
export async function createTestDb(): Promise<Db> {
  migrated ??= migratedDataDir();
  const pg = new PGlite({ loadDataDir: await migrated });
  inTest?.push(pg);
  return drizzle(pg, { schema });
}
