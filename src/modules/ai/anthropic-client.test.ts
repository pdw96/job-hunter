import { beforeEach, expect, test, vi } from "vitest";
import { z } from "zod";
import type { AiRequest } from "./client";

// 실제 API를 부르지 않도록 SDK를 가짜로 바꾼다. create가 받은 인자는 부를 때마다 복사해 둔다(messages 배열이 이어 부르며 늘어나므로)
const sdk = vi.hoisted(() => ({ create: vi.fn(), calls: [] as Record<string, unknown>[] }));
vi.mock("@anthropic-ai/sdk", () => {
  class APIError extends Error {
    status = 500;
  }
  class APIConnectionError extends Error {}
  class Anthropic {
    static APIError = APIError;
    static APIConnectionError = APIConnectionError;
    beta = {
      messages: {
        create: (params: Record<string, unknown>) => {
          sdk.calls.push(structuredClone(params));
          return sdk.create(params);
        },
        parse: vi.fn(),
      },
    };
  }
  return { default: Anthropic };
});

const { anthropicAi } = await import("./anthropic-client");
const { default: Anthropic } = await import("@anthropic-ai/sdk");

const request: AiRequest<{ name: string }> = {
  purpose: "company_research",
  system: "시스템",
  messages: [{ role: "user", text: "회사를 조사해 주세요" }],
  schema: z.object({ name: z.string() }),
  effort: "low",
  maxTokens: 1000,
  webSearch: { maxUses: 5 },
};

const result = (url: string) => ({
  type: "web_search_result",
  url,
  title: url,
  page_age: null,
  encrypted_content: "암호",
});

// 응답 하나: 검색 결과 블록(주소들) + 글 블록, 검색 횟수와 토큰
function response(stop: string, options: { urls?: string[]; text?: string; searches?: number }) {
  return {
    model: "claude-sonnet-5-5",
    stop_reason: stop,
    content: [
      ...(options.urls ? [{ type: "web_search_tool_result", tool_use_id: "t", content: options.urls.map(result) }] : []),
      ...(options.text !== undefined ? [{ type: "text", text: options.text, citations: null }] : []),
    ],
    usage: {
      input_tokens: 100,
      output_tokens: 10,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
      server_tool_use: { web_search_requests: options.searches ?? 0, web_fetch_requests: 0 },
    },
  };
}

const toolOf = (call: Record<string, unknown>) => (call.tools as { max_uses: number }[])[0];

beforeEach(() => {
  sdk.create.mockReset();
  sdk.calls.length = 0;
});

test("멈추면 이어 부르며 남은 검색 횟수만 주고, 사용량·출처를 합치고 모든 응답의 글을 잇는다", async () => {
  sdk.create
    .mockResolvedValueOnce(response("pause_turn", { urls: ["https://a.example"], text: '{"na', searches: 2 }))
    .mockResolvedValueOnce(response("pause_turn", { urls: ["https://a.example", "https://b.example"], text: 'me":', searches: 1 }))
    .mockResolvedValueOnce(response("end_turn", { text: '"가나다"}', searches: 1 }));

  const out = await anthropicAi.complete(request);

  expect(sdk.calls.map((call) => toolOf(call).max_uses)).toEqual([5, 3, 2]);
  expect(toolOf(sdk.calls[0])).toEqual({
    type: "web_search_20260209",
    name: "web_search",
    max_uses: 5,
    allowed_callers: ["direct"],
  });
  expect(sdk.calls[0]).not.toHaveProperty("output_config.format");
  // 이어 부를 때는 멈춘 응답의 내용을 assistant로 붙인다
  expect((sdk.calls[1].messages as { role: string }[]).map((m) => m.role)).toEqual(["user", "assistant"]);
  expect((sdk.calls[2].messages as { role: string }[]).map((m) => m.role)).toEqual(["user", "assistant", "assistant"]);

  expect(out).toEqual({
    ok: true,
    value: { name: "가나다" },
    model: "claude-sonnet-5-5",
    usage: { inputTokens: 300, outputTokens: 30, cacheReadTokens: 0, cacheWriteTokens: 0, webSearchRequests: 4 },
    sources: [
      { url: "https://a.example", title: "https://a.example", pageAge: null },
      { url: "https://b.example", title: "https://b.example", pageAge: null },
    ],
  });
});

test("allowedDomains가 있으면 도구에 넣는다", async () => {
  sdk.create.mockResolvedValueOnce(response("end_turn", { text: '{"name":"가"}' }));
  await anthropicAi.complete({ ...request, webSearch: { maxUses: 3, allowedDomains: ["example.com"] } });
  expect(toolOf(sdk.calls[0])).toMatchObject({ max_uses: 3, allowed_domains: ["example.com"] });
});

test("검색 횟수를 다 썼으면 더 부르지 않고 truncated로 끝낸다", async () => {
  sdk.create.mockResolvedValueOnce(response("pause_turn", { urls: ["https://a.example"], searches: 5 }));
  const out = await anthropicAi.complete(request);
  expect(sdk.create).toHaveBeenCalledTimes(1);
  expect(out).toMatchObject({
    ok: false,
    reason: "truncated",
    usage: { inputTokens: 100, webSearchRequests: 5 },
    sources: [{ url: "https://a.example" }],
  });
});

test("세 번 다 멈추면 truncated이고 쓴 만큼 사용량이 온다", async () => {
  sdk.create.mockResolvedValue(response("pause_turn", { searches: 1 }));
  const out = await anthropicAi.complete(request);
  expect(sdk.create).toHaveBeenCalledTimes(3);
  expect(out).toMatchObject({ ok: false, reason: "truncated", usage: { inputTokens: 300, webSearchRequests: 3 } });
});

test("이어 부르다 API 오류가 나도 앞에서 쓴 사용량과 출처를 돌려준다", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  sdk.create
    .mockResolvedValueOnce(response("pause_turn", { urls: ["https://a.example"], searches: 2 }))
    .mockRejectedValueOnce(new Anthropic.APIError(500, undefined, "서버 오류", undefined));
  const out = await anthropicAi.complete(request);
  expect(out).toEqual({
    ok: false,
    reason: "unavailable",
    model: "claude-sonnet-5-5",
    usage: { inputTokens: 100, outputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0, webSearchRequests: 2 },
    sources: [{ url: "https://a.example", title: "https://a.example", pageAge: null }],
  });
});
