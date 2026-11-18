import { describe, expect, it, vi } from "vitest";
import { connectWithRetry, isTransientConnectError } from "./connect-retry";

function codeError(code: string, message = "실패") {
  return Object.assign(new Error(message), { code });
}

const transient = () => codeError("08P01", "Authentication timed out");

describe("isTransientConnectError", () => {
  it.each([
    ["08P01", codeError("08P01", "Authentication timed out")],
    ["57P01", codeError("57P01", "terminating connection due to administrator command")],
    ["57P03", codeError("57P03", "the database system is starting up")],
    ["ECONNRESET", codeError("ECONNRESET", "read ECONNRESET")],
    ["ECONNREFUSED", codeError("ECONNREFUSED", "connect ECONNREFUSED")],
    ["ETIMEDOUT", codeError("ETIMEDOUT", "connect ETIMEDOUT")],
    ["끊김 문구", new Error("Connection terminated unexpectedly")],
    ["시간 초과 문구", new Error("timeout expired")],
    ["compute 문구", new Error("Couldn't connect to compute node")],
  ])("일시적인 실패로 본다: %s", (_name, error) => {
    expect(isTransientConnectError(error)).toBe(true);
  });

  it.each([
    ["비밀번호 틀림 28P01", codeError("28P01", "password authentication failed for user")],
    ["문법 오류 42601", codeError("42601", 'syntax error at or near "SELEC"')],
    ["코드 없는 오류", new Error("something else")],
    ["오류가 아닌 값", "Connection refused"],
    ["null", null],
  ])("다시 시도하지 않는다: %s", (_name, error) => {
    expect(isTransientConnectError(error)).toBe(false);
  });
});

describe("connectWithRetry", () => {
  it("일시적으로 한 번 실패하면 0.5초 기다렸다가 다시 연결한다", async () => {
    const connect = vi.fn().mockRejectedValueOnce(transient()).mockResolvedValueOnce("client");
    const sleep = vi.fn(async () => {});

    await expect(connectWithRetry(connect, { sleep, onRetry: () => {} })).resolves.toBe("client");
    expect(connect).toHaveBeenCalledTimes(2);
    expect(sleep.mock.calls).toEqual([[500]]);
  });

  it("두 번 실패하면 0.5초, 1.5초 기다린다", async () => {
    const connect = vi
      .fn()
      .mockRejectedValueOnce(transient())
      .mockRejectedValueOnce(transient())
      .mockResolvedValueOnce("client");
    const sleep = vi.fn(async () => {});

    await expect(connectWithRetry(connect, { sleep, onRetry: () => {} })).resolves.toBe("client");
    expect(sleep.mock.calls).toEqual([[500], [1500]]);
  });

  it("세 번 실패하면 마지막 오류를 던진다", async () => {
    const last = codeError("ECONNRESET", "마지막");
    const connect = vi
      .fn()
      .mockRejectedValueOnce(transient())
      .mockRejectedValueOnce(transient())
      .mockRejectedValueOnce(last);
    const sleep = vi.fn(async () => {});

    await expect(connectWithRetry(connect, { sleep, onRetry: () => {} })).rejects.toBe(last);
    expect(connect).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("일시적이지 않은 오류는 바로 던지고 기다리지 않는다", async () => {
    const wrongPassword = codeError("28P01", "password authentication failed");
    const connect = vi.fn().mockRejectedValue(wrongPassword);
    const sleep = vi.fn(async () => {});
    const onRetry = vi.fn();

    await expect(connectWithRetry(connect, { sleep, onRetry })).rejects.toBe(wrongPassword);
    expect(connect).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
    expect(onRetry).not.toHaveBeenCalled();
  });

  it("다시 시도할 때마다 오류와 몇 번째인지 알린다", async () => {
    const first = transient();
    const second = codeError("57P03", "starting up");
    const connect = vi
      .fn()
      .mockRejectedValueOnce(first)
      .mockRejectedValueOnce(second)
      .mockResolvedValueOnce("client");
    const onRetry = vi.fn();

    await connectWithRetry(connect, { sleep: async () => {}, onRetry });
    expect(onRetry.mock.calls).toEqual([
      [first, 1],
      [second, 2],
    ]);
  });

  it("기본으로는 경고를 남긴다(오류 코드, 문구, 몇 번째)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const connect = vi.fn().mockRejectedValueOnce(transient()).mockResolvedValueOnce("client");

    await connectWithRetry(connect, { sleep: async () => {} });
    expect(warn).toHaveBeenCalledWith("DB 연결을 다시 시도합니다(1/2): 08P01 Authentication timed out");
    warn.mockRestore();
  });

  it("기다리는 간격을 바꿀 수 있다", async () => {
    const connect = vi.fn().mockRejectedValueOnce(transient()).mockResolvedValueOnce("client");
    const sleep = vi.fn(async () => {});

    await connectWithRetry(connect, { delaysMs: [10], sleep, onRetry: () => {} });
    expect(sleep.mock.calls).toEqual([[10]]);
  });
});
