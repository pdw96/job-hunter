import { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";

// 실제 attachDatabasePool을 그대로 쓰되, 어떤 풀을 넘겼는지 잡는다
const attached = vi.hoisted(() => ({ pools: [] as unknown[] }));
vi.mock("@vercel/functions", async (importOriginal) => {
  const original = await importOriginal<typeof import("@vercel/functions")>();
  return {
    ...original,
    attachDatabasePool: (pool: Parameters<typeof original.attachDatabasePool>[0]) => {
      attached.pools.push(pool);
      return original.attachDatabasePool(pool);
    },
  };
});

describe("운영 DB 연결", () => {
  it("pg 풀을 만들어 Vercel에 맡기고, 쉬던 연결이 끊겨도 프로세스를 죽이지 않는다", async () => {
    // 접속하면 실패하는 주소: 불러오는 동안 DB에 붙지 않아야 한다
    process.env.DATABASE_URL = "postgres://nobody:nothing@127.0.0.1:1/none";
    const { db } = await import("./index");

    expect(typeof db.transaction).toBe("function");
    expect(attached.pools).toHaveLength(1);
    const pool = attached.pools[0] as Pool;
    expect(pool).toBeInstanceOf(Pool);

    // pg는 쉬던 연결이 끊기면 풀에서 error를 낸다. 듣는 쪽이 없으면 예외로 프로세스가 죽는다
    const quiet = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(() => pool.emit("error", new Error("Connection terminated unexpectedly"))).not.toThrow();
    quiet.mockRestore();
  });
});
