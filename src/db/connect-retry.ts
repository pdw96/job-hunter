// Neon은 5분 쉬면 compute를 멈추고, 깨어나는 0.5초쯤 사이에 연결을 맺으려 하면 실패한다.
// 그래서 연결을 맺는 단계(쿼리를 보내기 전)의 일시적인 실패만 잠깐 기다렸다가 다시 시도한다.
// 쿼리를 보낸 뒤의 실패는 다시 시도하지 않는다. 쓰기가 두 번 될 수 있다.

const TRANSIENT_CODES = new Set(["08P01", "57P01", "57P03", "ECONNRESET", "ECONNREFUSED", "ETIMEDOUT"]);
const TRANSIENT_MESSAGES = ["Connection terminated unexpectedly", "timeout expired", "Couldn't connect to compute node"];

export function isTransientConnectError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as { code?: unknown }).code;
  if (typeof code === "string" && TRANSIENT_CODES.has(code)) return true;
  return TRANSIENT_MESSAGES.some((text) => error.message.includes(text));
}

export type ConnectRetryOptions = {
  delaysMs?: number[];
  sleep?: (ms: number) => Promise<void>;
  onRetry?: (error: unknown, attempt: number) => void;
};

const DEFAULT_DELAYS_MS = [500, 1500];

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// 연결 문자열이나 비밀번호는 남기지 않고 오류 코드와 문구만 남긴다
function warnRetry(error: unknown, attempt: number, total: number) {
  const code = error instanceof Error ? (error as { code?: unknown }).code : undefined;
  const message = error instanceof Error ? error.message : String(error);
  const detail = typeof code === "string" ? `${code} ${message}` : message;
  console.warn(`DB 연결을 다시 시도합니다(${attempt}/${total}): ${detail}`);
}

export async function connectWithRetry<T>(connect: () => Promise<T>, options: ConnectRetryOptions = {}): Promise<T> {
  const delays = options.delaysMs ?? DEFAULT_DELAYS_MS;
  const sleep = options.sleep ?? defaultSleep;
  const onRetry = options.onRetry ?? ((error, attempt) => warnRetry(error, attempt, delays.length));

  for (let attempt = 0; ; attempt++) {
    try {
      return await connect();
    } catch (error) {
      if (attempt >= delays.length || !isTransientConnectError(error)) throw error;
      onRetry(error, attempt + 1);
      await sleep(delays[attempt]);
    }
  }
}
