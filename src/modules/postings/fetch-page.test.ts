import { expect, test } from "vitest";
import { fetchPosting, isPrivateAddress, type PageDeps, parsePublicUrl } from "./fetch-page";

test("내부망과 자기 자신을 가리키는 주소를 알아본다", () => {
  for (const address of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.0.10", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:10.0.0.1", "이상한값"]) {
    expect([address, isPrivateAddress(address)]).toEqual([address, true]);
  }
  for (const address of ["8.8.8.8", "172.15.0.1", "172.32.0.1", "203.0.113.5", "2606:4700::1111", "::ffff:8.8.8.8"]) {
    expect([address, isPrivateAddress(address)]).toEqual([address, false]);
  }
});

test("열어도 되는 모양의 주소만 받는다", () => {
  expect(parsePublicUrl(" https://www.example.com/jobs/1?x=1 ")?.href).toBe("https://www.example.com/jobs/1?x=1");
  for (const raw of [
    "ftp://example.com/a",
    "file:///etc/passwd",
    "javascript:alert(1)",
    "https://user:pw@example.com/",
    "https://example.com:8443/",
    "http://localhost/",
    "http://intranet/",
    "http://db.internal/",
    "http://127.0.0.1/",
    "http://[::1]/",
    "http://169.254.169.254/latest/meta-data/",
    "주소 아님",
  ]) {
    expect([raw, parsePublicUrl(raw)]).toEqual([raw, null]);
  }
});

const html = (body: string) => `<html><head><title>채용</title></head><body>${body}</body></html>`;
const long = `<p>${"주문과 결제 서비스를 개발할 백엔드 개발자를 찾습니다. ".repeat(12)}</p>`;
const response = (body: string | Uint8Array, init: { status?: number; headers?: Record<string, string> } = {}) =>
  new Response(body as BodyInit, { status: init.status ?? 200, headers: { "content-type": "text/html; charset=utf-8", ...init.headers } });

function deps(routes: Record<string, () => Response>, addresses: Record<string, string[]> = {}): PageDeps & { opened: string[] } {
  const opened: string[] = [];
  return {
    opened,
    resolve: async (host) => addresses[host] ?? ["203.0.113.10"],
    fetch: async (url) => {
      opened.push(url);
      const route = routes[url];
      if (!route) throw new Error(`준비되지 않은 주소: ${url}`);
      return route();
    },
  };
}

test("페이지의 글을 뽑아 돌려준다", async () => {
  const result = await fetchPosting("https://jobs.example.com/1", deps({ "https://jobs.example.com/1": () => response(html(long)) }));
  expect(result.ok && result.text).toContain("백엔드 개발자를 찾습니다");
  expect(result.ok && result.images).toEqual([]);
});

test("넘겨 주는 주소를 따라가되, 내부 주소로 넘기면 열지 않는다", async () => {
  const followed = deps({
    "https://short.example.com/a": () => response("", { status: 302, headers: { location: "https://jobs.example.com/1" } }),
    "https://jobs.example.com/1": () => response(html(long)),
  });
  expect((await fetchPosting("https://short.example.com/a", followed)).ok).toBe(true);

  const toInternal = deps({
    "https://short.example.com/a": () => response("", { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data/" } }),
  });
  expect(await fetchPosting("https://short.example.com/a", toInternal)).toEqual({ ok: false, reason: "bad_url" });
  expect(toInternal.opened).toEqual(["https://short.example.com/a"]);
});

test("이름이 내부 주소로 풀리면 열지 않는다", async () => {
  const sneaky = deps({}, { "evil.example.com": ["10.0.0.5"] });
  expect(await fetchPosting("https://evil.example.com/", sneaky)).toEqual({ ok: false, reason: "bad_url" });
  expect(sneaky.opened).toEqual([]);
});

test("넘겨 주기가 너무 많거나, 막혔거나, 너무 크면 읽지 못한 것으로 본다", async () => {
  const loop = deps({ "https://a.example.com/": () => response("", { status: 301, headers: { location: "https://a.example.com/" } }) });
  expect(await fetchPosting("https://a.example.com/", loop)).toEqual({ ok: false, reason: "blocked" });
  expect(loop.opened).toHaveLength(4);

  const forbidden = deps({ "https://a.example.com/": () => response("막힘", { status: 403 }) });
  expect(await fetchPosting("https://a.example.com/", forbidden)).toEqual({ ok: false, reason: "blocked" });

  const huge = deps({ "https://a.example.com/": () => response(new Uint8Array(2 * 1024 * 1024 + 1)) });
  expect(await fetchPosting("https://a.example.com/", huge)).toEqual({ ok: false, reason: "blocked" });
});

test("글이 거의 없고 그림도 없으면 읽지 못한 것으로 본다", async () => {
  const empty = deps({ "https://a.example.com/": () => response(html(`<div id="app"></div>`)) });
  expect(await fetchPosting("https://a.example.com/", empty)).toEqual({ ok: false, reason: "empty" });
});

test("글이 거의 없으면 본문의 큰 그림을 가져온다. 작은 그림과 그림이 아닌 것은 뺀다", async () => {
  const big = new Uint8Array(60 * 1024).fill(7);
  const routes = {
    "https://a.example.com/job": () => response(html(`<img src="/up/posting.jpg"><img src="/up/small.png"><img src="/up/page.jpg">`)),
    "https://a.example.com/up/posting.jpg": () => response(big, { headers: { "content-type": "image/jpeg" } }),
    "https://a.example.com/up/small.png": () => response(new Uint8Array(1000), { headers: { "content-type": "image/png" } }),
    "https://a.example.com/up/page.jpg": () => response(html("그림이 아님")),
  };
  const result = await fetchPosting("https://a.example.com/job", deps(routes));
  expect(result.ok && result.images.map((image) => [image.mediaType, image.data.length])).toEqual([["image/jpeg", Buffer.from(big).toString("base64").length]]);
});

test("EUC-KR로 된 페이지도 읽는다", async () => {
  // "채용" 을 EUC-KR로 적은 것
  const body = Buffer.concat([Buffer.from("<html><body><p>"), Buffer.from([0xc3, 0xa4, 0xbf, 0xeb]), Buffer.from(` ${"a".repeat(220)}</p></body></html>`)]);
  const result = await fetchPosting(
    "https://a.example.com/",
    deps({ "https://a.example.com/": () => response(new Uint8Array(body), { headers: { "content-type": "text/html; charset=euc-kr" } }) }),
  );
  expect(result.ok && result.text.startsWith("채용")).toBe(true);
});
