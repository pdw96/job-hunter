import type { AiClient, AiFailure, AiRequest, AiResult, WebSource } from "./client";
import type { TokenUsage } from "./pricing";

// 정해진 답을 순서대로 돌려주는 가짜 AI. 테스트와 로컬 미리보기에서 쓴다.

export const FAKE_MODEL = "claude-sonnet-5-5";
export const FAKE_USAGE: TokenUsage = { inputTokens: 1000, outputTokens: 200, cacheReadTokens: 0, cacheWriteTokens: 0 };

// 웹 검색을 쓴 답: answer는 스키마로 검사하고, sources와 검색 횟수(searches)를 결과에 담는다
export type FakeWebAnswer = { web: { answer: unknown; sources: WebSource[]; searches: number } };

type Scripted = unknown | { fail: AiFailure } | FakeWebAnswer | ((request: AiRequest<unknown>) => unknown | Promise<unknown>);

const isFail = (value: unknown): value is { fail: AiFailure } =>
  typeof value === "object" && value !== null && "fail" in value;
const isWeb = (value: unknown): value is FakeWebAnswer =>
  typeof value === "object" && value !== null && "web" in value;

export function createFakeAi(responses: Scripted[]): AiClient & { requests: AiRequest<unknown>[] } {
  const queue = [...responses];
  const requests: AiRequest<unknown>[] = [];
  return {
    requests,
    async complete<T>(request: AiRequest<T>): Promise<AiResult<T>> {
      requests.push(request as AiRequest<unknown>);
      if (queue.length === 0) throw new Error("가짜 AI에 준비된 답이 없습니다");
      const next = queue.shift();
      let answer = typeof next === "function" ? await next(request as AiRequest<unknown>) : next;
      // 실제 구현처럼 웹 검색 요청이면 실패해도 sources가 온다
      const meta: Pick<AiResult<T>, "usage" | "model" | "sources"> = {
        usage: FAKE_USAGE,
        model: FAKE_MODEL,
        ...(request.webSearch ? { sources: [] } : {}),
      };
      if (isWeb(answer)) {
        meta.usage = { ...FAKE_USAGE, webSearchRequests: answer.web.searches };
        meta.sources = answer.web.sources;
        answer = answer.web.answer;
      }
      if (isFail(answer)) return { ok: false, reason: answer.fail, ...meta };
      // 실제 구현처럼 스키마로 검사한다
      const parsed = request.schema.safeParse(answer);
      return parsed.success ? { ok: true, value: parsed.data, ...meta } : { ok: false, reason: "invalid", ...meta };
    },
  };
}
