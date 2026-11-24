import { expect, test } from "vitest";
import {
  cleanResearch,
  companyFacts,
  factNumbers,
  homepageDomain,
  hostOf,
  isWebUrl,
  researchState,
  wantsTalent,
  type NewsItem,
  type Talent,
} from "./research";

const src = (url: string, title = "제목") => ({ url, title, pageAge: null });
const today = "2026-11-24";

test("homepageDomain: 원문의 회사 주소를 www. 떼고 돌려준다", () => {
  expect(homepageDomain("홈페이지: https://www.gana.co.kr/careers", null)).toBe("gana.co.kr");
});

test("homepageDomain: www.로만 적힌 주소도 읽는다", () => {
  expect(homepageDomain("문의 www.Gana.com 으로", null)).toBe("gana.com");
});

test("homepageDomain: 채용 사이트와 그 하위 도메인은 건너뛴다", () => {
  const text = "https://www.saramin.co.kr/zf/1 https://m.jobkorea.co.kr/x 회사 www.gana.com";
  expect(homepageDomain(text, null)).toBe("gana.com");
});

test("homepageDomain: 공고 주소의 호스트는 건너뛴다", () => {
  const text = "https://jobs.other.com/1 https://www.gana.com";
  expect(homepageDomain(text, "https://jobs.other.com/posting/9")).toBe("gana.com");
});

test("homepageDomain: 주소가 없으면 null", () => {
  expect(homepageDomain("주소 없음", null)).toBeNull();
  expect(homepageDomain("https://www.saramin.co.kr/1", null)).toBeNull();
});

test("homepageDomain: 뒤에 붙은 조사와 문장부호는 호스트에 넣지 않는다", () => {
  expect(homepageDomain("www.gana.com에서 확인", null)).toBe("gana.com");
  expect(homepageDomain("https://www.gana.com.", null)).toBe("gana.com");
  expect(homepageDomain("https://gana.com, 문의", null)).toBe("gana.com");
  expect(homepageDomain("https://www.gana.co.kr/careers 참고", null)).toBe("gana.co.kr");
});

test("homepageDomain: 조사가 붙은 채용 사이트도 건너뛴다", () => {
  expect(homepageDomain("지원은 www.saramin.co.kr에서 하세요", null)).toBeNull();
  expect(homepageDomain("https://www.saramin.co.kr. www.gana.com", null)).toBe("gana.com");
});

test("wantsTalent: 인재상 글이 있으면 false", () => {
  expect(wantsTalent({ rawText: "채용", companyNote: "우리는 이런 사람" })).toBe(false);
});
test("wantsTalent: 원문에 '인재상'이 있으면 false", () => {
  expect(wantsTalent({ rawText: "우리의 인재상은", companyNote: null })).toBe(false);
});
test("wantsTalent: 둘 다 없으면 true", () => {
  expect(wantsTalent({ rawText: "채용", companyNote: "  " })).toBe(true);
});

const opts = { wantTalent: true, domain: "gana.com", today };

test("cleanResearch: 검색 결과에 없는 주소는 버린다", () => {
  const r = cleanResearch(
    { talent: null, news: [{ summary: "투자 유치", date: null, url: "https://x.com/a" }] },
    [src("https://y.com/a")],
    opts,
  );
  expect(r.news).toEqual([]);
});

test("cleanResearch: http(s)가 아닌 주소는 검색 결과에 있어도 버린다", () => {
  const bad = "javascript:alert(1)";
  const sources = [src(bad), src("data:text/html,x"), src("https://gana.com/news")];
  const raw = {
    talent: { text: "도전", url: bad },
    news: [
      { summary: "가", date: null, url: "data:text/html,x" },
      { summary: "나", date: null, url: "https://gana.com/news" },
    ],
  };
  const result = cleanResearch(raw, sources, { wantTalent: true, domain: null, today });
  expect(result.talent).toBeNull();
  expect(result.news.map((n) => n.url)).toEqual(["https://gana.com/news"]);
});

test("isWebUrl: http·https로 시작하는 주소만 true", () => {
  expect(isWebUrl("https://gana.com")).toBe(true);
  expect(isWebUrl("HTTP://gana.com")).toBe(true);
  expect(isWebUrl("javascript:alert(1)")).toBe(false);
  expect(isWebUrl(" https://gana.com")).toBe(false);
  expect(isWebUrl("gana.com")).toBe(false);
});

test("cleanResearch: 끝의 /와 해시가 달라도 같은 주소로 본다", () => {
  const r = cleanResearch(
    { talent: null, news: [{ summary: "투자 유치", date: null, url: "https://x.com/a/#top" }] },
    [src("https://x.com/a", "기사")],
    opts,
  );
  expect(r.news).toHaveLength(1);
  expect(r.news[0].url).toBe("https://x.com/a/#top");
});

test("cleanResearch: 인재상은 홈페이지 도메인 밖이면 버린다", () => {
  const sources = [src("https://other.com/talent"), src("https://careers.gana.com/talent")];
  const bad = cleanResearch({ talent: { text: "도전", url: "https://other.com/talent" }, news: [] }, sources, opts);
  expect(bad.talent).toBeNull();
  const ok = cleanResearch({ talent: { text: "도전", url: "https://careers.gana.com/talent" }, news: [] }, sources, opts);
  expect(ok.talent).toMatchObject({ text: "도전", url: "https://careers.gana.com/talent" });
});

test("cleanResearch: 도메인이 없으면 인재상 주소는 검색 결과이기만 하면 된다", () => {
  const r = cleanResearch(
    { talent: { text: "도전", url: "https://other.com/t" }, news: [] },
    [src("https://other.com/t")],
    { ...opts, domain: null },
  );
  expect(r.talent).not.toBeNull();
});

test("cleanResearch: wantTalent가 false면 인재상은 null", () => {
  const r = cleanResearch(
    { talent: { text: "도전", url: "https://gana.com/t" }, news: [] },
    [src("https://gana.com/t")],
    { ...opts, wantTalent: false },
  );
  expect(r.talent).toBeNull();
});

test("cleanResearch: 날짜가 형식에 안 맞거나 오늘 뒤면 null", () => {
  const dates = ["2026-13-01", "11월 5일", "2026-11-25", "2026-02-30", "2026-11-24"];
  const r = cleanResearch(
    { talent: null, news: dates.map((date, i) => ({ summary: `소식${i}`, date, url: `https://x.com/${i}` })) },
    dates.map((_, i) => src(`https://x.com/${i}`)),
    opts,
  );
  expect(r.news.map((n) => n.date)).toEqual([null, null, null, null, "2026-11-24"]);
});

test("cleanResearch: 소식은 8개까지", () => {
  const news = Array.from({ length: 12 }, (_, i) => ({ summary: `소식${i}`, date: null, url: `https://x.com/${i}` }));
  const r = cleanResearch({ talent: null, news }, news.map((n) => src(n.url)), opts);
  expect(r.news).toHaveLength(8);
});

test("cleanResearch: 같은 주소·같은 요약은 한 번", () => {
  const r = cleanResearch(
    {
      talent: null,
      news: [
        { summary: "가", date: null, url: "https://x.com/a" },
        { summary: "나", date: null, url: "https://x.com/a/" },
        { summary: "가", date: null, url: "https://x.com/b" },
        { summary: "다", date: null, url: "https://x.com/c" },
      ],
    },
    [src("https://x.com/a"), src("https://x.com/b"), src("https://x.com/c")],
    opts,
  );
  expect(r.news.map((n) => n.summary)).toEqual(["가", "다"]);
});

test("cleanResearch: 요약 300자·인재상 500자로 자르고 빈 것은 버린다", () => {
  const r = cleanResearch(
    {
      talent: { text: ` ${"가".repeat(600)} `, url: "https://gana.com/t" },
      news: [
        { summary: "나".repeat(400), date: null, url: "https://x.com/a" },
        { summary: "   ", date: null, url: "https://x.com/b" },
      ],
    },
    [src("https://gana.com/t"), src("https://x.com/a"), src("https://x.com/b")],
    opts,
  );
  expect(r.talent?.text).toHaveLength(500);
  expect(r.news).toHaveLength(1);
  expect(r.news[0].summary).toHaveLength(300);
  const empty = cleanResearch({ talent: { text: " ", url: "https://gana.com/t" }, news: [] }, [src("https://gana.com/t")], opts);
  expect(empty.talent).toBeNull();
});

test("cleanResearch: 제목은 검색 결과의 title", () => {
  const r = cleanResearch(
    { talent: { text: "도전", url: "https://gana.com/t" }, news: [{ summary: "소식", date: null, url: "https://x.com/a" }] },
    [src("https://gana.com/t", "인재상 페이지"), src("https://x.com/a", "기사 제목")],
    opts,
  );
  expect(r.talent?.title).toBe("인재상 페이지");
  expect(r.news[0].title).toBe("기사 제목");
});

test("cleanResearch: 고르기 기본값은 verdict null·checked false, id는 서로 다르다", () => {
  const r = cleanResearch(
    { talent: { text: "도전", url: "https://gana.com/t" }, news: [{ summary: "소식", date: null, url: "https://x.com/a" }] },
    [src("https://gana.com/t"), src("https://x.com/a")],
    opts,
  );
  expect(r.talent?.verdict).toBeNull();
  expect(r.news[0].checked).toBe(false);
  expect(r.talent?.id).toBeTruthy();
  expect(r.talent?.id).not.toBe(r.news[0].id);
});

const talent = (verdict: Talent["verdict"]): Talent => ({ id: "t", text: "도전 31명", url: "https://g.com/t", title: "T", verdict });
const news = (id: string, checked: boolean): NewsItem => ({ id, summary: `소식 ${id}`, date: null, url: `https://x.com/${id}`, title: id, checked });

test("companyFacts: 맞음 인재상과 체크한 소식만, 인재상이 먼저", () => {
  const facts = companyFacts({ talent: talent("yes"), news: [news("a", false), news("b", true), news("c", true)] });
  expect(facts.map((f) => f.id)).toEqual(["t", "b", "c"]);
  expect(facts.map((f) => f.kind)).toEqual(["talent", "news", "news"]);
  expect(facts[1]).toMatchObject({ text: "소식 b", url: "https://x.com/b", title: "b", date: null });
});

test("companyFacts: 아님·미정 인재상은 빠진다", () => {
  expect(companyFacts({ talent: talent("no"), news: [] })).toEqual([]);
  expect(companyFacts({ talent: talent(null), news: [] })).toEqual([]);
});

test("factNumbers: 사실 글의 숫자를 돌려준다", () => {
  const [fact] = companyFacts({ talent: talent("yes"), news: [] });
  expect(factNumbers(fact)).toContain("31");
});

test("hostOf: www.를 떼고, 잘못된 주소면 그대로", () => {
  expect(hostOf("https://www.Gana.com/a")).toBe("gana.com");
  expect(hostOf("not a url")).toBe("not a url");
});

const now = new Date("2026-11-24T12:00:00Z");
const ago = (ms: number) => new Date(now.getTime() - ms);
const MIN = 60_000;
const DAY = 86_400_000;

test("researchState: 없으면 none", () => {
  expect(researchState(null, now)).toBe("none");
});
test("researchState: running 4분은 running, 6분은 stuck", () => {
  expect(researchState({ status: "running", startedAt: ago(4 * MIN), researchedAt: null }, now)).toBe("running");
  expect(researchState({ status: "running", startedAt: ago(6 * MIN), researchedAt: null }, now)).toBe("stuck");
});
test("researchState: 끝난 지 91일이면 stale, 89일이면 done", () => {
  expect(researchState({ status: "done", startedAt: ago(91 * DAY), researchedAt: ago(91 * DAY) }, now)).toBe("stale");
  expect(researchState({ status: "done", startedAt: ago(89 * DAY), researchedAt: ago(89 * DAY) }, now)).toBe("done");
});
test("researchState: 실패면 failed", () => {
  expect(researchState({ status: "failed", startedAt: ago(MIN), researchedAt: null }, now)).toBe("failed");
});
