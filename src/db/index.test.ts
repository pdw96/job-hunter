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
    const { RetryingPool } = await import("./index");
    expect(pool).toBeInstanceOf(RetryingPool);

    // pg는 쉬던 연결이 끊기면 풀에서 error를 낸다. 듣는 쪽이 없으면 예외로 프로세스가 죽는다
    const quiet = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(() => pool.emit("error", new Error("Connection terminated unexpectedly"))).not.toThrow();
    quiet.mockRestore();
  });
});

describe("연결을 맺다가 잠깐 실패할 때", () => {
  // 쿼리 하나를 받아 결과를 돌려주는 가짜 연결
  function fakeClient() {
    return {
      query: vi.fn((_text: unknown, _values: unknown, cb: (err: unknown, res: unknown) => void) =>
        cb(undefined, { rows: [{ ok: 1 }] }),
      ),
      once: vi.fn(),
      removeListener: vi.fn(),
      release: vi.fn(),
    };
  }

  // 부모 Pool의 connect를 바꿔 처음 failures번은 연결 단계에서 실패하게 한다
  function failConnect(failures: number, error: Error, client: ReturnType<typeof fakeClient>) {
    let calls = 0;
    const spy = vi.spyOn(Pool.prototype, "connect").mockImplementation(function (
      this: Pool,
      cb?: (err: Error | undefined, client: unknown, done: () => void) => void,
    ) {
      calls += 1;
      const outcome: [Error | undefined, unknown] = calls <= failures ? [error, undefined] : [undefined, client];
      if (cb) {
        setImmediate(() => cb(outcome[0], outcome[1], () => {}));
        return undefined;
      }
      return outcome[0] ? Promise.reject(outcome[0]) : Promise.resolve(outcome[1]);
    } as never);
    return { spy, calls: () => calls };
  }

  const authTimeout = () => Object.assign(new Error("Authentication timed out"), { code: "08P01" });

  it("pool.query가 연결 단계를 다시 시도해 쿼리를 한 번만 보낸다", async () => {
    const { RetryingPool } = await import("./index");
    const client = fakeClient();
    const { spy, calls } = failConnect(2, authTimeout(), client);
    const sleep = vi.fn(async () => {});
    const pool = new RetryingPool({ connectionString: "postgres://x@127.0.0.1:1/x" }, { sleep, onRetry: () => {} });

    const result = await pool.query("select 1 as ok");

    expect(result.rows).toEqual([{ ok: 1 }]);
    expect(calls()).toBe(3);
    expect(sleep.mock.calls).toEqual([[500], [1500]]);
    expect(client.query).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it("Vercel에 맡긴 뒤에도 pool.connect()가 다시 시도한다", async () => {
    const { RetryingPool } = await import("./index");
    const { attachDatabasePool } = await import("@vercel/functions");
    const client = fakeClient();
    const { spy, calls } = failConnect(1, new Error("Connection terminated unexpectedly"), client);
    const pool = new RetryingPool(
      { connectionString: "postgres://x@127.0.0.1:1/x" },
      { sleep: async () => {}, onRetry: () => {} },
    );
    attachDatabasePool(pool);

    await expect(pool.connect()).resolves.toBe(client);
    expect(calls()).toBe(2);
    spy.mockRestore();
  });

  it("실제 pg도 연결이 거부되면 두 번 다시 시도한 뒤 그 오류를 낸다", async () => {
    const { RetryingPool } = await import("./index");
    const onRetry = vi.fn();
    const pool = new RetryingPool({ connectionString: "postgres://x@127.0.0.1:1/x" }, { sleep: async () => {}, onRetry });

    await expect(pool.query("select 1")).rejects.toMatchObject({ code: "ECONNREFUSED" });
    expect(onRetry.mock.calls.map(([, attempt]) => attempt)).toEqual([1, 2]);
    await pool.end();
  });

  it("비밀번호가 틀리면 다시 시도하지 않는다", async () => {
    const { RetryingPool } = await import("./index");
    const wrong = Object.assign(new Error("password authentication failed"), { code: "28P01" });
    const { spy, calls } = failConnect(5, wrong, fakeClient());
    const sleep = vi.fn(async () => {});
    const pool = new RetryingPool({ connectionString: "postgres://x@127.0.0.1:1/x" }, { sleep, onRetry: () => {} });

    await expect(pool.query("select 1")).rejects.toBe(wrong);
    expect(calls()).toBe(1);
    expect(sleep).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
