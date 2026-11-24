import type { BetaContentBlock } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import type { WebSource } from "./client";
import type { TokenUsage } from "./pricing";

// 웹 검색 서버 도구의 응답을 다루는 순수 함수. anthropic-client.ts가 쓴다.

// 서버가 검색 도중 멈추면(pause_turn) 받은 내용을 붙여 이어 부른다. 그 최대 횟수
export const MAX_CONTINUATIONS = 2;

// content의 web_search_tool_result 블록에서 결과 주소를 모은다. content가 오류 객체인 블록은 건너뛴다
export function collectSources(content: BetaContentBlock[]): WebSource[] {
  const sources: WebSource[] = [];
  for (const block of content) {
    if (block.type !== "web_search_tool_result" || !Array.isArray(block.content)) continue;
    for (const result of block.content) {
      sources.push({ url: result.url, title: result.title, pageAge: result.page_age ?? null });
    }
  }
  return mergeSources([], sources);
}

// 이어 부른 응답들의 사용량을 합친다
export function mergeUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
    webSearchRequests: (a.webSearchRequests ?? 0) + (b.webSearchRequests ?? 0),
  };
}

// 같은 주소는 먼저 나온 것 하나만 둔다
export function mergeSources(a: WebSource[], b: WebSource[]): WebSource[] {
  const seen = new Set<string>();
  return [...a, ...b].filter((source) => {
    if (seen.has(source.url)) return false;
    seen.add(source.url);
    return true;
  });
}
