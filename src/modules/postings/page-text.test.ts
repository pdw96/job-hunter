import { expect, test } from "vitest";
import { contentFromHtml, decodeEntities, htmlToText, jobPostingText } from "./page-text";

const page = (body: string, head = "") => `<!doctype html><html><head><title>가나다테크 채용</title>${head}</head><body>${body}</body></html>`;

test("태그를 지우고 줄을 나눈다. 스크립트와 메뉴, 머리말, 꼬리말은 뺀다", () => {
  const html = page(`
    <header><a href="/">홈</a></header><nav><ul><li>채용</li></ul></nav>
    <script>var secret = "스크립트";</script><style>.a{color:red}</style>
    <main><h1>백엔드 개발자</h1><p>주문 API를 개발합니다.<br>경력 3년 이상</p><ul><li>Java</li><li>Kotlin</li></ul></main>
    <footer>회사 주소</footer>`);
  expect(contentFromHtml(html, "https://example.com/jobs/1").text).toBe(
    "가나다테크 채용\n\n백엔드 개발자\n주문 API를 개발합니다.\n경력 3년 이상\n- Java\n- Kotlin",
  );
});

test("HTML 문자 표기를 푼다", () => {
  expect(decodeEntities("A&amp;B &lt;3&gt; &quot;q&quot; &#44032; &#xAC00; &nbsp;끝 &unknown;")).toBe('A&B <3> "q" 가 가  끝 &unknown;');
  expect(htmlToText("<p>연봉&nbsp;&nbsp;5,000만원 &middot; 협의</p>")).toBe("연봉 5,000만원 · 협의");
});

test("정해진 형식(JSON-LD)의 공고 정보가 있으면 그것을 글로 바꾼다", () => {
  const ld = JSON.stringify({
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "Organization", name: "다른 것" },
      {
        "@type": "JobPosting",
        title: "백엔드 개발자",
        hiringOrganization: { "@type": "Organization", name: "(주)가나다테크" },
        validThrough: "2026-12-05",
        employmentType: ["FULL_TIME"],
        jobLocation: { "@type": "Place", address: { addressRegion: "경기", addressLocality: "성남시", streetAddress: "판교역로 1" } },
        description: "<p>주문 API 개발</p><ul><li>경력 3년 이상</li></ul>",
      },
    ],
  });
  const html = page("<main><p>짧은 본문</p></main>", `<script type="application/ld+json">${ld}</script>`);
  expect(jobPostingText(html)).toBe(
    "회사: (주)가나다테크\n직무: 백엔드 개발자\n마감: 2026-12-05\n근무지: 경기 성남시 판교역로 1\n고용 형태: FULL_TIME\n\n주문 API 개발\n- 경력 3년 이상",
  );
  // 본문 글이 훨씬 길지 않으면 정해진 형식의 것만 쓴다
  expect(contentFromHtml(html, "https://example.com/").text.startsWith("회사: (주)가나다테크")).toBe(true);
  expect(contentFromHtml(html, "https://example.com/").text).not.toContain("짧은 본문");
});

test("깨진 JSON-LD나 공고가 아닌 JSON-LD는 무시한다", () => {
  const html = page("<p>본문</p>", `<script type="application/ld+json">{깨짐</script><script type="application/ld+json">{"@type":"WebSite"}</script>`);
  expect(jobPostingText(html)).toBeNull();
  expect(contentFromHtml(html, "https://example.com/").text).toBe("가나다테크 채용\n\n본문");
});

test("본문 그림의 주소를 절대 주소로 모은다. 로고·아이콘과 페이지 틀의 그림은 뺀다", () => {
  const html = page(`
    <header><img src="/img/top.jpg"></header>
    <div><img src="/upload/posting_1.jpg"><img src="/img/blank.gif" data-src="//cdn.example.com/p2.png">
    <img src="/img/logo.png"><img src="data:image/png;base64,AAAA"><img src="/upload/posting_1.jpg"></div>`);
  expect(contentFromHtml(html, "https://example.com/jobs/1").images).toEqual([
    "https://example.com/upload/posting_1.jpg",
    "https://cdn.example.com/p2.png",
  ]);
});

test("글자가 거의 없는 페이지는 글이 짧게 나온다", () => {
  const html = page(`<div id="app"></div><script src="/app.js"></script>`);
  expect(contentFromHtml(html, "https://example.com/").text).toBe("가나다테크 채용");
});
