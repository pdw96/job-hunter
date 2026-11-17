import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { AiClient, AiRequest, AiResult } from "./client";
import { currentModel, type TokenUsage } from "./pricing";

// 실제 Claude API 구현. ANTHROPIC_API_KEY는 SDK가 환경 변수에서 읽는다.

let client: Anthropic | undefined;

function toUsage(usage: {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}): TokenUsage {
  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cacheReadTokens: usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
  };
}

export const anthropicAi: AiClient = {
  async complete<T>(request: AiRequest<T>): Promise<AiResult<T>> {
    client ??= new Anthropic();
    try {
      // claude-sonnet-5-5는 thinking을 끌 수 없다. 생략하면 적응형으로 돌고 깊이는 effort로 조절한다
      const response = await client.beta.messages.parse({
        model: currentModel(),
        max_tokens: request.maxTokens,
        // 모델이 거절하면 서버가 대체 모델로 한 번 더 시도한다
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        cache_control: { type: "ephemeral" },
        system: request.system,
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
        return { ok: false, reason: "unavailable" };
      }
      throw error;
    }
  },
};
