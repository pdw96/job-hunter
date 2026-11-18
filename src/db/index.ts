import { attachDatabasePool } from "@vercel/functions";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient, type PoolConfig } from "pg";
import { connectWithRetry, type ConnectRetryOptions } from "./connect-retry";
import * as schema from "./schema";
import type { Db } from "./types";

export type { Db } from "./types";

type ConnectCallback = (err: Error | undefined, client: PoolClient | undefined, done: (release?: unknown) => void) => void;

// Neon compute가 멈췄다 깨어나는 사이에는 연결을 맺다가 실패한다(docs/superpowers/plans/2026-11-18-db-cold-start.md).
// 연결을 맺는 단계만 다시 시도한다. pool.query도 안에서 this.connect(콜백)를 부르므로 둘 다 이 길을 지난다.
// 이미 맺은 연결에서 실패한 쿼리는 다시 보내지 않는다(쓰기가 두 번 될 수 있다).
export class RetryingPool extends Pool {
  private readonly retry: ConnectRetryOptions;

  constructor(config?: PoolConfig, retry: ConnectRetryOptions = {}) {
    super(config);
    this.retry = retry;
  }

  override connect(): Promise<PoolClient>;
  override connect(callback: ConnectCallback): void;
  override connect(callback?: ConnectCallback): Promise<PoolClient> | void {
    const attempt = () =>
      new Promise<[PoolClient, (release?: unknown) => void]>((resolve, reject) => {
        super.connect((err, client, done) => (err || !client ? reject(err) : resolve([client, done])));
      });
    const connected = connectWithRetry(attempt, this.retry);
    if (!callback) return connected.then(([client]) => client);
    connected.then(
      ([client, done]) => callback(undefined, client, done),
      (err: Error) => callback(err, undefined, () => {}),
    );
  }
}

// 운영용 인스턴스. Pool은 첫 쿼리 때 연결하므로 빌드 시점에는 DB에 접속하지 않는다.
// Better Auth가 트랜잭션을 쓰므로 풀 방식을 쓴다.
// 예전에는 @neondatabase/serverless의 WebSocket 풀을 요청 사이에 다시 써서, 함수가 멈춘 사이 끊긴 연결로
// 세션 조회가 실패했다(socket hang up). Neon과 Vercel이 권하는 pg + attachDatabasePool로 바꿨다.
const pool = new RetryingPool({ connectionString: process.env.DATABASE_URL });

// 함수가 멈추기 전에 쉬는 연결이 정리될 때까지 기다리게 한다
attachDatabasePool(pool);

// 쉬던 연결이 끊기면 pg는 풀에서 error를 낸다. 듣는 쪽이 없으면 프로세스가 죽는다.
// 끊긴 연결은 풀이 이미 버렸고 다음 쿼리는 새로 연결하므로 기록만 한다.
pool.on("error", (error) => {
  console.warn("DB 풀의 쉬던 연결이 끊겼습니다:", error.message);
});

export const db: Db = drizzle({ client: pool, schema });
