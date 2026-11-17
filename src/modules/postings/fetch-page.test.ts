import { expect, test } from "vitest";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { brotliCompressSync, gzipSync } from "node:zlib";
import { fetchPosting, isPrivateAddress, type PageDeps, parsePublicUrl, pinnedFetch } from "./fetch-page";

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

function deps(
  routes: Record<string, () => Response | Promise<Response>>,
  addresses: Record<string, string[]> = {},
): PageDeps & { opened: string[]; connected: string[] } {
  const opened: string[] = [];
  const connected: string[] = [];
  return {
    opened,
    connected,
    resolve: async (host) => addresses[host] ?? ["203.0.113.10"],
    fetch: async (url, init) => {
      opened.push(url);
      connected.push(init.address);
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

test("연결은 검사한 주소로 한다", async () => {
  const pinned = deps({ "https://jobs.example.com/1": () => response(html(long)) }, { "jobs.example.com": ["203.0.113.77", "203.0.113.78"] });
  await fetchPosting("https://jobs.example.com/1", pinned);
  expect(pinned.connected).toEqual(["203.0.113.77"]);
});

test("따옴표가 붙은 charset도 읽는다", async () => {
  const body = Buffer.concat([Buffer.from("<html><body><p>"), Buffer.from([0xc3, 0xa4, 0xbf, 0xeb]), Buffer.from(` ${"a".repeat(220)}</p></body></html>`)]);
  const result = await fetchPosting(
    "https://a.example.com/",
    deps({ "https://a.example.com/": () => response(new Uint8Array(body), { headers: { "content-type": 'text/html; charset="euc-kr"' } }) }),
  );
  expect(result.ok && result.text.startsWith("채용")).toBe(true);
});

test("그림은 큰 것을 고르되 페이지에 나온 순서로 돌려준다", async () => {
  const small = new Uint8Array(50 * 1024).fill(1);
  const large = new Uint8Array(90 * 1024).fill(2);
  const tiny = new Uint8Array(45 * 1024).fill(3);
  const image = (bytes: Uint8Array) => () => response(bytes, { headers: { "content-type": "image/png" } });
  const result = await fetchPosting(
    "https://a.example.com/job",
    deps({
      "https://a.example.com/job": () => response(html(`<img src="/up/1.png"><img src="/up/2.png"><img src="/up/3.png">`)),
      "https://a.example.com/up/1.png": image(small),
      "https://a.example.com/up/2.png": image(large),
      "https://a.example.com/up/3.png": image(tiny),
    }),
  );
  const size = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64").length;
  expect(result.ok && result.images.map((item) => item.data.length)).toEqual([size(small), size(large)]);
});

test("전체 시간 한도를 넘기면 그만둔다", async () => {
  const never = new Promise<Response>(() => undefined);
  const started = Date.now();
  expect(await fetchPosting("https://slow.example.com/", deps({ "https://slow.example.com/": () => never }), { totalMs: 150 })).toEqual({ ok: false, reason: "blocked" });
  expect(Date.now() - started).toBeLessThan(2000);
});

test("실제 연결은 이름을 다시 풀지 않고 넘겨받은 주소로 붙으며, Host에는 원래 이름을 쓴다", async () => {
  const seen: string[] = [];
  const server = createServer((request, reply) => {
    seen.push(request.headers.host ?? "");
    if (request.url === "/moved") {
      reply.writeHead(302, { location: "/next" });
      reply.end();
      return;
    }
    reply.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    reply.end("붙었다");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  try {
    // 이 이름은 실제로는 풀리지 않는다. 넘겨받은 주소로 붙어야만 응답을 받는다
    const init = { address: "127.0.0.1", signal: AbortSignal.timeout(3000), headers: { accept: "text/plain" } };
    const ok = await pinnedFetch(`http://no-such-host.invalid:${port}/page`, init);
    expect([ok.status, await ok.text()]).toEqual([200, "붙었다"]);
    const moved = await pinnedFetch(`http://no-such-host.invalid:${port}/moved`, init);
    expect([moved.status, moved.headers.get("location")]).toEqual([302, "/next"]);
    expect(seen).toEqual([`no-such-host.invalid:${port}`, `no-such-host.invalid:${port}`]);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("압축된 응답을 풀어 읽고, 본문을 둘 수 없는 상태 코드에도 죽지 않는다", async () => {
  const server = createServer((request, reply) => {
    if (request.url === "/gzip") {
      reply.writeHead(200, { "content-type": "text/plain; charset=utf-8", "content-encoding": "gzip" });
      reply.end(gzipSync("지퍼로 묶은 공고"));
    } else if (request.url === "/br") {
      reply.writeHead(200, { "content-type": "text/plain; charset=utf-8", "content-encoding": "br" });
      reply.end(brotliCompressSync("브로틀리 공고"));
    } else if (request.url === "/broken") {
      reply.writeHead(200, { "content-encoding": "gzip" });
      reply.end("압축이 아닌 글");
    } else {
      reply.writeHead(205);
      reply.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  const get = (path: string) =>
    pinnedFetch(`http://no-such-host.invalid:${port}${path}`, { address: "127.0.0.1", signal: AbortSignal.timeout(3000), headers: {} });
  try {
    expect(await (await get("/gzip")).text()).toBe("지퍼로 묶은 공고");
    expect(await (await get("/br")).text()).toBe("브로틀리 공고");
    await expect((await get("/broken")).text()).rejects.toThrow();
    expect((await get("/reset")).status).toBe(205);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

const chrome = `<p>${"로그인 회원가입 채용정보 기업 연봉 커뮤니티 고객센터 이용약관 ".repeat(12)}</p>`;

test("공고 본문을 끼워 넣은 페이지에 둔 사이트는 그 페이지의 글을 읽는다. 바깥 페이지는 제목만 남긴다", async () => {
  const pages = deps({
    "https://jobs.example.com/view?id=1": () =>
      response(`<html><head><title>[가나다(주)] 조립 신입 채용 - 채용사이트</title></head><body>${chrome}
        <iframe src="/view-detail?id=1"></iframe><iframe src="https://ads.other.com/x"></iframe><iframe src="/login-frame"></iframe></body></html>`),
    "https://jobs.example.com/view-detail?id=1": () => response(html(long)),
  });
  const result = await fetchPosting("https://jobs.example.com/view?id=1", pages);
  expect(result.ok && result.text.split("\n")[0]).toBe("[가나다(주)] 조립 신입 채용 - 채용사이트");
  expect(result.ok && result.text).toContain("백엔드 개발자를 찾습니다");
  expect(result.ok && result.text).not.toContain("고객센터");
  expect(pages.opened).toEqual(["https://jobs.example.com/view?id=1", "https://jobs.example.com/view-detail?id=1"]);
});

test("끼워 넣은 페이지의 본문이 그림이면, 다시 불렀을 때 그 그림을 가져온다", async () => {
  const big = new Uint8Array(60 * 1024).fill(7);
  const routes = {
    "https://jobs.example.com/view?id=2": () => response(html(`${chrome}<iframe src="/view-detail?id=2"></iframe>`)),
    "https://jobs.example.com/view-detail?id=2": () => response(html(`<img src="/up/posting.jpg">`)),
    "https://jobs.example.com/up/posting.jpg": () => response(big, { headers: { "content-type": "image/jpeg" } }),
  };
  // 바깥 페이지에 글이 있으면 먼저 그 글을 돌려준다. 그 글에 공고 내용이 없으면 화면이 그림을 달라고 다시 부른다
  const first = await fetchPosting("https://jobs.example.com/view?id=2", deps(routes));
  expect(first.ok && first.images).toEqual([]);
  const again = await fetchPosting("https://jobs.example.com/view?id=2", deps(routes), { forceImages: true });
  expect(again.ok && again.images).toHaveLength(1);

  // 바깥 페이지에 글이 거의 없으면 처음부터 그림을 돌려준다
  const bare = { ...routes, "https://jobs.example.com/view?id=2": () => response(html(`<iframe src="/view-detail?id=2"></iframe>`)) };
  const direct = await fetchPosting("https://jobs.example.com/view?id=2", deps(bare));
  expect(direct.ok && direct.images).toHaveLength(1);
});

test("글이 충분해 보여도 요청하면 본문의 그림을 가져온다", async () => {
  const big = new Uint8Array(60 * 1024).fill(7);
  const routes = {
    "https://a.example.com/job": () => response(html(`${chrome}<img src="/up/posting.jpg">`)),
    "https://a.example.com/up/posting.jpg": () => response(big, { headers: { "content-type": "image/jpeg" } }),
  };
  const plain = await fetchPosting("https://a.example.com/job", deps(routes));
  expect(plain.ok && plain.images).toEqual([]);
  const forced = await fetchPosting("https://a.example.com/job", deps(routes), { forceImages: true });
  expect(forced.ok && forced.images).toHaveLength(1);
});

test("글이 몇 마디뿐인 끼워 넣은 페이지는 본문으로 보지 않고 바깥 페이지의 글을 쓴다", async () => {
  const result = await fetchPosting(
    "https://jobs.example.com/view?id=3",
    deps({
      "https://jobs.example.com/view?id=3": () => response(html(`${long}<iframe src="/widget"></iframe>`)),
      "https://jobs.example.com/widget": () => response(html("<p>상담 창</p>")),
    }),
  );
  expect(result.ok && result.text).toContain("백엔드 개발자를 찾습니다");
  expect(result.ok && result.text).not.toContain("상담 창");
});

test("바깥 페이지에 글이 충분하면, 끼워 넣은 페이지에 그림이 있어도 글을 버리지 않는다", async () => {
  const big = new Uint8Array(60 * 1024).fill(7);
  const routes = {
    "https://jobs.example.com/view?id=4": () => response(html(`${long}<iframe src="/frame"></iframe>`)),
    "https://jobs.example.com/frame": () => response(html(`<img src="/up/photo.jpg">`)),
    "https://jobs.example.com/up/photo.jpg": () => response(big, { headers: { "content-type": "image/jpeg" } }),
  };
  const first = deps(routes);
  const plain = await fetchPosting("https://jobs.example.com/view?id=4", first);
  expect(plain.ok && [plain.text.includes("백엔드 개발자를 찾습니다"), plain.images.length]).toEqual([true, 0]);
  // 글이 충분하면 그림은 내려받지 않는다
  expect(first.opened).not.toContain("https://jobs.example.com/up/photo.jpg");
  const forced = await fetchPosting("https://jobs.example.com/view?id=4", deps(routes), { forceImages: true });
  expect(forced.ok && [forced.text.includes("백엔드 개발자를 찾습니다"), forced.images.length]).toEqual([true, 1]);
});

test("끼워 넣은 페이지를 본문으로 쓸 때도 바깥 페이지의 정해진 형식 공고 정보는 남긴다", async () => {
  const ld = JSON.stringify({
    "@type": "JobPosting",
    title: "조립 신입",
    hiringOrganization: { name: "가나다(주)" },
    validThrough: "2026-12-05",
  });
  const result = await fetchPosting(
    "https://jobs.example.com/view?id=5",
    deps({
      "https://jobs.example.com/view?id=5": () =>
        response(`<html><head><title>채용</title><script type="application/ld+json">${ld}</script></head><body>${chrome}<iframe src="/detail"></iframe></body></html>`),
      "https://jobs.example.com/detail": () => response(html(long)),
    }),
  );
  expect(result.ok && result.text.split("\n").slice(0, 3)).toEqual(["회사: 가나다(주)", "직무: 조립 신입", "마감: 2026-12-05"]);
  expect(result.ok && result.text).toContain("백엔드 개발자를 찾습니다");
  expect(result.ok && result.text).not.toContain("고객센터");
});

test("끼워 넣은 페이지의 그림과 함께 적힌 짧은 글도 남기고, 양쪽에 있는 같은 그림은 한 번만 센다", async () => {
  const first = new Uint8Array(80 * 1024).fill(1);
  const second = new Uint8Array(60 * 1024).fill(2);
  const image = (bytes: Uint8Array) => () => response(bytes, { headers: { "content-type": "image/png" } });
  const result = await fetchPosting(
    "https://jobs.example.com/view?id=6",
    deps({
      "https://jobs.example.com/view?id=6": () => response(html(`<img src="/up/1.png"><iframe src="/detail"></iframe>`)),
      "https://jobs.example.com/detail": () => response(html(`<p>가나다(주) · 마감 12월 5일</p><img src="/up/1.png"><img src="/up/2.png">`)),
      "https://jobs.example.com/up/1.png": image(first),
      "https://jobs.example.com/up/2.png": image(second),
    }),
  );
  const size = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64").length;
  expect(result.ok && result.text).toContain("가나다(주) · 마감 12월 5일");
  expect(result.ok && result.images.map((item) => item.data.length)).toEqual([size(first), size(second)]);
});

test("사람인 공고는 상세요강 페이지를 따로 열어 본문으로 쓰고, 페이지 설명을 머리에 남긴다", async () => {
  const outer = "https://www.saramin.co.kr/zf_user/jobs/relay/view?rec_idx=55530921&view_type=list";
  const detail = "https://www.saramin.co.kr/zf_user/jobs/relay/view-detail?rec_idx=55530921&rec_seq=0";
  const pages = deps({
    [outer]: () =>
      response(`<html><head><title>[가나다(주)] 조립 신입 채용 - 사람인</title>
        <meta name="description" content="가나다(주), 조립 신입 채용, 경력:신입, 마감일:2026-11-19"></head><body>${chrome}</body></html>`),
    [detail]: () => response(html(long)),
  });
  const result = await fetchPosting(outer, pages);
  expect(result.ok && result.text.split("\n").slice(0, 2)).toEqual(["[가나다(주)] 조립 신입 채용 - 사람인", "가나다(주), 조립 신입 채용, 경력:신입, 마감일:2026-11-19"]);
  expect(result.ok && result.text).toContain("백엔드 개발자를 찾습니다");
  expect(result.ok && result.text).not.toContain("고객센터");
  expect(pages.opened).toEqual([outer, detail]);
});

test("사람인의 상세요강 페이지를 열지 못하면 바깥 페이지의 글을 그대로 쓴다", async () => {
  const outer = "https://www.saramin.co.kr/zf_user/jobs/relay/view?rec_idx=7";
  const pages = deps({
    [outer]: () => response(html(long)),
    "https://www.saramin.co.kr/zf_user/jobs/relay/view-detail?rec_idx=7&rec_seq=0": () => response("없음", { status: 404 }),
  });
  const result = await fetchPosting(outer, pages);
  expect(result.ok && result.text).toContain("백엔드 개발자를 찾습니다");
});
