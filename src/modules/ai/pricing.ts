// 모델별 가격과 비용 계산. 금액은 100만분의 1달러(마이크로달러) 정수로 다룬다.

export const DEFAULT_MODEL = "claude-sonnet-5-5";

export type TokenUsage = {
  inputTokens: number; // 캐시를 쓰지 않은 입력
  outputTokens: number; // 생각(thinking) 토큰 포함
  cacheReadTokens: number;
  cacheWriteTokens: number;
};

// USD / 100만 토큰 (2026-11-03 기준)
const PRICES: Record<string, { input: number; output: number; cacheRead: number }> = {
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.1 },
  "claude-sonnet-5": { input: 2, output: 10, cacheRead: 0.2 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01 },
};
// 표에 없는 모델은 가장 비싼 값으로 계산한다(적게 잡는 것보다 안전하다)
const FALLBACK_PRICE = PRICES["claude-opus-5-5"];
const CACHE_WRITE_MULTIPLIER = 1.25;

export function costMicroUsd(model: string, usage: TokenUsage): number {
  const price = PRICES[model] ?? FALLBACK_PRICE;
  // (토큰 수) × (달러 / 100만 토큰) = 마이크로달러
  return Math.ceil(
    usage.inputTokens * price.input +
      usage.outputTokens * price.output +
      usage.cacheReadTokens * price.cacheRead +
      usage.cacheWriteTokens * price.input * CACHE_WRITE_MULTIPLIER,
  );
}

export function currentModel(): string {
  return process.env.AI_MODEL?.trim() || DEFAULT_MODEL;
}
