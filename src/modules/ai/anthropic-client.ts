import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { BetaMessageParam, BetaWebSearchTool20260209 } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import type { AiClient, AiRequest, AiResult, WebSource } from "./client";
import { looseSystem, parseLoose } from "./loose-json";
import { currentModel, type TokenUsage } from "./pricing";
import { collectSources, MAX_CONTINUATIONS, mergeSources, mergeUsage } from "./web-search";

// 실제 Claude API 구현. ANTHROPIC_API_KEY는 SDK가 환경 변수에서 읽는다.

let client: Anthropic | undefined;

function toUsage(usage: {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  server_tool_use?: { web_search_requests: number } | null;
}): TokenUsage {
  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cacheReadTokens: usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
    webSearchRequests: usage.server_tool_use?.web_search_requests ?? 0,
  };
}

function webSearchTool(options: NonNullable<AiRequest<unknown>["webSearch"]>): BetaWebSearchTool20260209 {
  return {
    type: "web_search_20260209",
    name: "web_search",
    max_uses: options.maxUses,
    ...(options.allowedDomains ? { allowed_domains: options.allowedDomains } : {}),
    // 모델이 직접 부르게 한다(코드 실행 도구를 거치지 않는다)
    allowed_callers: ["direct"],
  };
}

export const anthropicAi: AiClient = {
  async complete<T>(request: AiRequest<T>): Promise<AiResult<T>> {
    client ??= new Anthropic();
    // 이어 부르는 도중 오류가 나도 앞에서 쓴 토큰과 검색은 기록되게 밖에 둔다
    let spent: { usage: TokenUsage; model: string; sources?: WebSource[] } | undefined;
    try {
      // claude-sonnet-5-5는 thinking을 끌 수 없다. 생략하면 적응형으로 돌고 깊이는 effort로 조절한다
      const common = {
        model: currentModel(),
        max_tokens: request.maxTokens,
        // 모델이 거절하면 서버가 대체 모델로 한 번 더 시도한다
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default" as const,
        cache_control: { type: "ephemeral" as const },
        messages: request.messages.map((message) => ({
          role: message.role,
          // 그림이 있으면 그림을 먼저, 글을 뒤에 둔다
          content:
            message.images && message.images.length > 0
              ? [
                  ...message.images.map((image) => ({
                    type: "image" as const,
                    source: { type: "base64" as const, media_type: image.mediaType, data: image.data },
                  })),
                  { type: "text" as const, text: message.text },
                ]
              : message.text,
        })),
      };

      // 웹 검색 결과에는 인용이 붙어 와서 API의 답 모양 강제(output_config.format)와 함께 쓰지 않는다
      if (request.loose || request.webSearch) {
        // 모양은 지시에 적고 글로 받아 코드가 검사한다(loose-json.ts)
        const webSearch = request.webSearch;
        const messages: BetaMessageParam[] = [...common.messages];
        const api = client;
        const send = () =>
          api.beta.messages.create({
            ...common,
            messages,
            system: looseSystem(request.system, request.schema),
            output_config: { effort: request.effort },
            ...(webSearch ? { tools: [webSearchTool(webSearch)] } : {}),
          });
        let response = await send();
        spent = {
          usage: toUsage(response.usage),
          model: response.model,
          ...(webSearch ? { sources: collectSources(response.content) } : {}),
        };
        // 서버가 검색 도중 멈추면 받은 내용을 그대로 붙여 이어 부른다
        for (let i = 0; i < MAX_CONTINUATIONS && response.stop_reason === "pause_turn"; i++) {
          messages.push({ role: "assistant", content: response.content });
          response = await send();
          spent = {
            usage: mergeUsage(spent.usage, toUsage(response.usage)),
            model: response.model,
            ...(spent.sources ? { sources: mergeSources(spent.sources, collectSources(response.content)) } : {}),
          };
        }
        const meta = spent;
        if (response.stop_reason === "refusal") return { ok: false, reason: "refused", ...meta };
        if (response.stop_reason !== "end_turn") return { ok: false, reason: "truncated", ...meta };
        // 인용이 붙으면 답이 여러 text 블록으로 나뉘어 온다. 순서대로 잇는다
        const text = response.content.map((block) => (block.type === "text" ? block.text : "")).join("");
        const parsed = parseLoose(text, request.schema);
        return parsed.ok ? { ok: true, value: parsed.value, ...meta } : { ok: false, reason: "invalid", ...meta };
      }

      const response = await client.beta.messages.parse({
        ...common,
        system: request.system,
        output_config: { effort: request.effort, format: zodOutputFormat(request.schema) },
      });

      const meta = { usage: toUsage(response.usage), model: response.model };
      // 내용을 읽기 전에 왜 멈췄는지 본다
      if (response.stop_reason === "refusal") return { ok: false, reason: "refused", ...meta };
      if (response.stop_reason !== "end_turn") return { ok: false, reason: "truncated", ...meta };
      if (response.parsed_output === null || response.parsed_output === undefined) {
        return { ok: false, reason: "invalid", ...meta };
      }
      return { ok: true, value: response.parsed_output as T, ...meta };
    } catch (error) {
      if (error instanceof Anthropic.APIError || error instanceof Anthropic.APIConnectionError) {
        console.error("AI 호출 실패", error instanceof Anthropic.APIError ? error.status : "connection", error.message);
        return { ok: false, reason: "unavailable", ...(request.webSearch ? { sources: [] } : {}), ...spent };
      }
      throw error;
    }
  },
};
