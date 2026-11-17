import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { AiImage } from "@/modules/ai/client";
import { IMAGE_TYPES } from "@/modules/ai/client";
import { contentFromHtml } from "./page-text";

// 사용자가 넣은 공고 주소 하나를 서버가 대신 연다.
// 서버가 아무 주소나 열면 내부망을 들여다보는 데 쓰일 수 있으므로, 여는 주소를 엄격히 제한한다.

const TIMEOUT_MS = 8000;
const MAX_REDIRECTS = 3;
const MAX_PAGE_BYTES = 2 * 1024 * 1024;
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const MIN_IMAGE_BYTES = 40 * 1024; // 이보다 작으면 공고 본문이 아니라 장식 그림으로 본다
const MAX_IMAGES = 2;
const MAX_IMAGE_TOTAL = 3 * 1024 * 1024; // 브라우저로 돌려보내는 양을 줄인다
const MIN_TEXT = 200; // 뽑은 글이 이보다 짧으면 읽지 못한 것으로 본다

export type PageDeps = {
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  resolve: (host: string) => Promise<string[]>;
};

const defaultDeps: PageDeps = {
  fetch: (url, init) => fetch(url, init),
  resolve: async (host) => (await lookup(host, { all: true })).map((entry) => entry.address),
};

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
async function open(raw: string, maxBytes: number, accept: string, deps: PageDeps): Promise<Fetched> {
  let current = raw;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const url = parsePublicUrl(current);
    if (!url) return { ok: false, reason: "bad_url" };
    const host = url.hostname.replace(/^\[|\]$/g, "");
    let response: Response;
    try {
      const addresses = isIP(host) !== 0 ? [host] : await deps.resolve(host);
      if (addresses.length === 0 || addresses.some(isPrivateAddress)) return { ok: false, reason: "bad_url" };
      response = await deps.fetch(url.href, {
        redirect: "manual",
        signal: AbortSignal.timeout(TIMEOUT_MS),
        // 사용자 정보는 넣지 않는다
        headers: { "user-agent": "Mozilla/5.0 (compatible; JobHunter/1.0)", accept, "accept-language": "ko-KR,ko;q=0.9,en;q=0.5" },
      });
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
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) {
          await reader.cancel().catch(() => undefined);
          return { ok: false, reason: "blocked" };
        }
        chunks.push(value);
      }
    } catch {
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
  const charset = (contentType.match(/charset=([\w-]+)/)?.[1] ?? head.match(/<meta[^>]+charset=["']?([\w-]+)/i)?.[1] ?? "utf-8").toLowerCase();
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

export type FetchedPosting =
  | { ok: true; text: string; images: AiImage[] } // images가 있으면 본문이 그림이라는 뜻이다. 그림을 읽어 글로 바꿔야 한다
  | { ok: false; reason: "bad_url" | "blocked" | "empty" };

export async function fetchPosting(raw: string, deps: PageDeps = defaultDeps): Promise<FetchedPosting> {
  const page = await open(raw, MAX_PAGE_BYTES, "text/html,application/xhtml+xml", deps);
  if (!page.ok) return page;
  if (page.contentType !== "" && !/html|text\/plain/.test(page.contentType)) return { ok: false, reason: "empty" };

  const content = contentFromHtml(decodeHtml(page.bytes, page.contentType), page.url);
  if (content.text.length >= MIN_TEXT) return { ok: true, text: content.text, images: [] };

  // 글이 거의 없으면 본문이 그림일 수 있다. 본문의 그림 가운데 큰 것을 가져온다
  const candidates: { image: AiImage; size: number }[] = [];
  for (const url of content.images) {
    const fetched = await open(url, MAX_IMAGE_BYTES, "image/*", deps);
    if (!fetched.ok || fetched.bytes.byteLength < MIN_IMAGE_BYTES) continue;
    const mediaType = IMAGE_TYPES.find((type) => fetched.contentType.startsWith(type));
    if (!mediaType) continue;
    candidates.push({ image: { mediaType, data: Buffer.from(fetched.bytes).toString("base64") }, size: fetched.bytes.byteLength });
  }
  const images: AiImage[] = [];
  let total = 0;
  for (const candidate of candidates.sort((a, b) => b.size - a.size)) {
    if (images.length >= MAX_IMAGES || total + candidate.size > MAX_IMAGE_TOTAL) continue;
    images.push(candidate.image);
    total += candidate.size;
  }
  if (images.length === 0) return { ok: false, reason: "empty" };
  return { ok: true, text: content.text, images };
}
