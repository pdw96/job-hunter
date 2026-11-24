import type { BetaContentBlock } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { expect, test } from "vitest";
import { collectSources, mergeSources, mergeUsage } from "./web-search";

const result = (url: string, title: string, pageAge: string | null) => ({
  type: "web_search_result" as const,
  url,
  title,
  page_age: pageAge,
  encrypted_content: "암호",
});

const searchBlock = (content: unknown): BetaContentBlock =>
  ({ type: "web_search_tool_result", tool_use_id: "srvtoolu_1", content }) as BetaContentBlock;

test("결과 블록의 주소·제목·page_age를 모은다", () => {
  const content = [
    searchBlock([result("https://a.example/1", "가", "2026-11-01"), result("https://b.example/2", "나", null)]),
    searchBlock([result("https://c.example/3", "다", "3 days ago")]),
  ];
  expect(collectSources(content)).toEqual([
    { url: "https://a.example/1", title: "가", pageAge: "2026-11-01" },
    { url: "https://b.example/2", title: "나", pageAge: null },
    { url: "https://c.example/3", title: "다", pageAge: "3 days ago" },
  ]);
});

test("오류 결과 블록(web_search_tool_result_error)은 건너뛴다", () => {
  const content = [
    searchBlock({ type: "web_search_tool_result_error", error_code: "max_uses_exceeded" }),
    searchBlock([result("https://a.example/1", "가", null)]),
  ];
  expect(collectSources(content)).toEqual([{ url: "https://a.example/1", title: "가", pageAge: null }]);
});

test("다른 블록(text, server_tool_use)은 무시한다", () => {
  const content: BetaContentBlock[] = [
    { type: "server_tool_use", id: "srvtoolu_1", name: "web_search", input: { query: "회사" } } as BetaContentBlock,
    { type: "text", text: "회사는", citations: null },
  ];
  expect(collectSources(content)).toEqual([]);
});

test("mergeUsage는 토큰과 검색 횟수를 더한다", () => {
  const a = { inputTokens: 100, outputTokens: 20, cacheReadTokens: 5, cacheWriteTokens: 1, webSearchRequests: 2 };
  const b = { inputTokens: 300, outputTokens: 40, cacheReadTokens: 0, cacheWriteTokens: 3 };
  expect(mergeUsage(a, b)).toEqual({
    inputTokens: 400,
    outputTokens: 60,
    cacheReadTokens: 5,
    cacheWriteTokens: 4,
    webSearchRequests: 2,
  });
  expect(mergeUsage(a, { ...b, webSearchRequests: 3 }).webSearchRequests).toBe(5);
});

test("mergeSources는 같은 주소를 한 번만 둔다", () => {
  const a = [
    { url: "https://a.example/1", title: "가", pageAge: null },
    { url: "https://a.example/1", title: "가 다시", pageAge: null },
  ];
  const b = [
    { url: "https://a.example/1", title: "가 또", pageAge: "어제" },
    { url: "https://b.example/2", title: "나", pageAge: null },
  ];
  expect(mergeSources(a, b)).toEqual([
    { url: "https://a.example/1", title: "가", pageAge: null },
    { url: "https://b.example/2", title: "나", pageAge: null },
  ]);
});
