import { lookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";
import { Readable } from "node:stream";
import type { AiImage } from "@/modules/ai/client";
import { IMAGE_TYPES } from "@/modules/ai/client";
import { contentFromHtml } from "./page-text";

// 사용자가 넣은 공고 주소 하나를 서버가 대신 연다.
// 서버가 아무 주소나 열면 내부망을 들여다보는 데 쓰일 수 있으므로, 여는 주소를 엄격히 제한한다.

const TOTAL_MS = 15_000; // 페이지와 그림을 모두 가져오는 데 쓰는 전체 시간
const MAX_REDIRECTS = 3;
const MAX_PAGE_BYTES = 2 * 1024 * 1024;
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const MIN_IMAGE_BYTES = 40 * 1024; // 이보다 작으면 공고 본문이 아니라 장식 그림으로 본다
const MAX_IMAGES = 2;
const MAX_IMAGE_TOTAL = 3 * 1024 * 1024; // 브라우저로 돌려보내는 양을 줄인다
const MIN_TEXT = 200; // 뽑은 글이 이보다 짧으면 읽지 못한 것으로 본다

export type PageDeps = {
  // address는 검사를 마친 주소다. 연결은 반드시 이 주소로 한다
  fetch: (url: string, init: { address: string; signal: AbortSignal; headers: Record<string, string> }) => Promise<Response>;
  resolve: (host: string) => Promise<string[]>;
};

// 검사한 주소로만 연결한다. 이름을 다시 풀면 그 사이에 내부 주소로 바뀔 수 있기 때문이다(DNS 리바인딩).
// 호스트 이름은 그대로 두므로 Host 머리말과 TLS 인증서 확인은 원래 이름으로 한다
export function pinnedFetch(raw: string, init: { address: string; signal: AbortSignal; headers: Record<string, string> }): Promise<Response> {
  const url = new URL(raw);
  const family = isIP(init.address);
  const client = url.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const request = client.request(
      url,
      {
        method: "GET",
        headers: init.headers,
        signal: init.signal,
        lookup: (_host, options, callback) => {
          const done = callback as (error: Error | null, address: unknown, family?: number) => void;
          if (typeof options === "object" && options.all) done(null, [{ address: init.address, family }]);
          else done(null, init.address, family);
        },
      },
      (message) => {
        const headers = new Headers();
        for (const [name, value] of Object.entries(message.headers)) {
          if (typeof value === "string") headers.set(name, value);
        }
        const status = message.statusCode ?? 502;
        const empty = status === 204 || status === 304 || (status >= 300 && status < 400);
        if (empty) message.resume();
        resolve(new Response(empty ? null : (Readable.toWeb(message) as ReadableStream<Uint8Array>), { status, headers }));
      },
    );
    request.on("error", reject);
    request.end();
  });
}

const defaultDeps: PageDeps = {
  fetch: pinnedFetch,
  resolve: async (host) => (await lookup(host, { all: true })).map((entry) => entry.address),
};

// 전체 시간 한도가 지나면 기다리던 일을 그만둔다
function withDeadline<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const stop = () => reject(new Error("timeout"));
    if (signal.aborted) return stop();
    signal.addEventListener("abort", stop, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener("abort", stop));
  });
}

// 내부망, 자기 자신, 특수 용도 주소인가
export function isPrivateAddress(address: string): boolean {
  const mapped = address.toLowerCase().match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  const ip = mapped ?? address.toLowerCase();
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 168 || b === 0)) ||
      (a === 198 && (b === 18 || b === 19))
    );
  }
  if (isIP(ip) === 6) {
    return ip === "::" || ip === "::1" || /^f[cd]/.test(ip) || /^fe[89ab]/.test(ip) || ip.startsWith("ff") || ip.startsWith("::ffff:") || ip.startsWith("64:ff9b:");
  }
  return true; // 주소로 읽을 수 없으면 열지 않는다
}

// 열어도 되는 모양의 주소인가: http(s), 기본 포트, 아이디·비밀번호 없음
export function parsePublicUrl(raw: string): URL | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username !== "" || url.password !== "" || url.port !== "") return null;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host === "" || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return null;
  if (isIP(host) !== 0 && isPrivateAddress(host)) return null;
  if (isIP(host) === 0 && !host.includes(".")) return null;
  return url;
}

type Fetched = { ok: true; url: string; bytes: Uint8Array; contentType: string } | { ok: false; reason: "bad_url" | "blocked" };

// 주소를 연다. 다른 주소로 넘겨 주면 그 주소도 같은 검사를 거친다
async function open(raw: string, maxBytes: number, accept: string, deps: PageDeps, signal: AbortSignal): Promise<Fetched> {
  let current = raw;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const url = parsePublicUrl(current);
    if (!url) return { ok: false, reason: "bad_url" };
    const host = url.hostname.replace(/^\[|\]$/g, "");
    let response: Response;
    try {
      const addresses = isIP(host) !== 0 ? [host] : await withDeadline(deps.resolve(host), signal);
      if (addresses.length === 0 || addresses.some(isPrivateAddress)) return { ok: false, reason: "bad_url" };
      response = await withDeadline(
        deps.fetch(url.href, {
          address: addresses[0],
          signal,
          // 사용자 정보는 넣지 않는다
          headers: { "user-agent": "Mozilla/5.0 (compatible; JobHunter/1.0)", accept, "accept-language": "ko-KR,ko;q=0.9,en;q=0.5" },
        }),
        signal,
      );
    } catch {
      return { ok: false, reason: "blocked" };
    }

    if (response.status >= 300 && response.status < 400) {
      const next = response.headers.get("location");
      await response.body?.cancel().catch(() => undefined);
      if (!next) return { ok: false, reason: "blocked" };
      try {
        current = new URL(next, url).href;
      } catch {
        return { ok: false, reason: "blocked" };
      }
      continue;
    }
    if (!response.ok || !response.body) return { ok: false, reason: "blocked" };
    if (Number(response.headers.get("content-length") ?? 0) > maxBytes) {
      await response.body.cancel().catch(() => undefined);
      return { ok: false, reason: "blocked" };
    }

    // 크기 한도를 넘으면 읽다가 그만둔다
    const chunks: Uint8Array[] = [];
    let size = 0;
    const reader = response.body.getReader();
    try {
      for (;;) {
        const { done, value } = await withDeadline(reader.read(), signal);
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) {
          await reader.cancel().catch(() => undefined);
          return { ok: false, reason: "blocked" };
        }
        chunks.push(value);
      }
    } catch {
      await reader.cancel().catch(() => undefined);
      return { ok: false, reason: "blocked" };
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return { ok: true, url: url.href, bytes, contentType: (response.headers.get("content-type") ?? "").toLowerCase() };
  }
  return { ok: false, reason: "blocked" };
}

// 글자 형식을 맞춰 푼다. 국내 사이트에는 EUC-KR이 아직 있다
function decodeHtml(bytes: Uint8Array, contentType: string): string {
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, 2048));
  const charset = (contentType.match(/charset=["']?([\w-]+)/)?.[1] ?? head.match(/<meta[^>]+charset=["']?([\w-]+)/i)?.[1] ?? "utf-8").toLowerCase();
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

export type FetchedPosting =
  | { ok: true; text: string; images: AiImage[] } // images가 있으면 본문이 그림이라는 뜻이다. 그림을 읽어 글로 바꿔야 한다
  | { ok: false; reason: "bad_url" | "blocked" | "empty" };

export async function fetchPosting(raw: string, deps: PageDeps = defaultDeps, totalMs = TOTAL_MS): Promise<FetchedPosting> {
  // 넘겨 주기와 그림까지 모두 이 한도 안에서 끝낸다
  const signal = AbortSignal.timeout(totalMs);
  const page = await open(raw, MAX_PAGE_BYTES, "text/html,application/xhtml+xml", deps, signal);
  if (!page.ok) return page;
  if (page.contentType !== "" && !/html|text\/plain/.test(page.contentType)) return { ok: false, reason: "empty" };

  const content = contentFromHtml(decodeHtml(page.bytes, page.contentType), page.url);
  if (content.text.length >= MIN_TEXT) return { ok: true, text: content.text, images: [] };

  // 글이 거의 없으면 본문이 그림일 수 있다. 본문의 그림 가운데 큰 것을 가져온다
  const candidates: { image: AiImage; size: number; order: number }[] = [];
  for (const [order, url] of content.images.entries()) {
    if (signal.aborted) break;
    const fetched = await open(url, MAX_IMAGE_BYTES, "image/*", deps, signal);
    if (!fetched.ok || fetched.bytes.byteLength < MIN_IMAGE_BYTES) continue;
    const mediaType = IMAGE_TYPES.find((type) => fetched.contentType.startsWith(type));
    if (!mediaType) continue;
    candidates.push({ image: { mediaType, data: Buffer.from(fetched.bytes).toString("base64") }, size: fetched.bytes.byteLength, order });
  }
  // 큰 것부터 고르되, 돌려줄 때는 페이지에 나온 순서로 둔다(공고가 그림 여러 장으로 이어지기도 한다)
  const chosen: typeof candidates = [];
  let total = 0;
  for (const candidate of [...candidates].sort((x, y) => y.size - x.size)) {
    if (chosen.length >= MAX_IMAGES || total + candidate.size > MAX_IMAGE_TOTAL) continue;
    chosen.push(candidate);
    total += candidate.size;
  }
  const images = chosen.sort((x, y) => x.order - y.order).map((candidate) => candidate.image);
  if (images.length === 0) return { ok: false, reason: "empty" };
  return { ok: true, text: content.text, images };
}
