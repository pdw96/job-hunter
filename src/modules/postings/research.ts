import { randomUUID } from "node:crypto";
import type { WebSource } from "@/modules/ai/client";
import { numbersIn } from "@/modules/experiences/grounding";
import { RESEARCH_LIMITS } from "./options";
import type { Research } from "./research-repo";

// 회사 조사: AI가 웹 검색으로 찾은 결과를 검사하고, 사용자가 고른 것만 사실로 내놓는 순수 함수들

export type Talent = { id: string; text: string; url: string; title: string; verdict: "yes" | "no" | null };
export type NewsItem = { id: string; summary: string; date: string | null; url: string; title: string; checked: boolean };
export type ResearchFailure = "not_found" | "over_limit" | "unavailable";
export type CompanyFact = { id: string; kind: "talent" | "news"; text: string; url: string; title: string; date: string | null };
export type RawResearch = {
  talent: { text: string; url: string } | null;
  news: { summary: string; date: string | null; url: string }[];
};

// www.를 뗀 소문자 호스트. 잘못된 주소면 받은 그대로
export const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return url;
  }
};

// 화면이 링크로 이어도 되는 주소(http·https)인가. 그 밖의 주소(javascript: 등)는 조사 결과에 남기지 않는다
export const isWebUrl = (url: string): boolean => /^https?:\/\//i.test(url);

// 채용 공고에 흔히 나오지만 회사 홈페이지는 아닌 사이트(채용 사이트, 줄인 주소, SNS 등). 도메인과 그 하위 도메인
const JOB_SITES = [
  "saramin.co.kr",
  "jobkorea.co.kr",
  "wanted.co.kr",
  "incruit.com",
  "jobplanet.co.kr",
  "catch.co.kr",
  "linkedin.com",
  "rocketpunch.com",
  "jasoseol.com",
  "work.go.kr",
  "albamon.com",
  "alba.co.kr",
  "programmers.co.kr",
  "remember.co.kr",
  "greetinghr.com",
  "ninehire.com",
  "notion.site",
  "forms.gle",
  "google.com",
  "naver.com",
  "kakao.com",
  // 줄인 주소, 영상, SNS, 포털
  "bit.ly",
  "youtu.be",
  "youtube.com",
  "instagram.com",
  "facebook.com",
  "x.com",
  "twitter.com",
  "daum.net",
];
const onDomain = (host: string, domain: string) => host === domain || host.endsWith(`.${domain}`);

// 원문에 적힌 주소 중 채용 사이트도 공고 주소도 아닌 첫 호스트. 없으면 null
export function homepageDomain(rawText: string, postingUrl: string | null): string | null {
  const postingHost = postingUrl ? hostOf(postingUrl) : null;
  const found = rawText.match(/https?:\/\/[a-z0-9.-]+|\bwww\.[a-z0-9.-]+/gi) ?? [];
  for (const match of found) {
    // 호스트는 영문·숫자·점·하이픈까지만 읽는다(뒤에 붙은 조사와 문장부호를 떼기 위해). 끝의 점도 뗀다
    const clean = match.replace(/\.+$/, "");
    const full = /^https?:\/\//i.test(clean) ? clean : `https://${clean}`;
    let host: string;
    try {
      host = new URL(full).hostname.toLowerCase().replace(/^www\./, "");
    } catch {
      continue;
    }
    if (!host.includes(".")) continue;
    if (JOB_SITES.some((d) => onDomain(host, d)) || host === postingHost) continue;
    return host;
  }
  return null;
}

// 사용자가 인재상을 이미 붙여 넣었거나 원문에 인재상이 있으면 따로 찾지 않는다
export function wantsTalent(posting: { rawText: string; companyNote: string | null }): boolean {
  if (posting.companyNote?.trim()) return false;
  return !posting.rawText.includes("인재상");
}

const normUrl = (url: string) => url.replace(/#.*$/, "").replace(/\/+$/, "");

// 실제 달력에 있는 날이고 오늘(한국)보다 뒤가 아닐 때만 남긴다
function cleanDate(date: string | null, today: string): string | null {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const [y, m, d] = date.split("-").map(Number);
  const at = new Date(Date.UTC(y, m - 1, d));
  if (at.getUTCFullYear() !== y || at.getUTCMonth() !== m - 1 || at.getUTCDate() !== d) return null;
  return date > today ? null : date;
}

const cut = (text: string, max: number) => text.trim().slice(0, max).trim();

// AI가 돌려준 조사 결과를 검사한다. 이번 검색 결과에 있는 주소만 남기고, 제목은 검색 결과의 것을 쓴다
export function cleanResearch(
  raw: RawResearch,
  sources: WebSource[],
  opts: { wantTalent: boolean; domain: string | null; today: string },
): { talent: Talent | null; news: NewsItem[] } {
  const titles = new Map<string, string>();
  for (const s of sources) if (!titles.has(normUrl(s.url))) titles.set(normUrl(s.url), s.title);

  let talent: Talent | null = null;
  if (opts.wantTalent && raw.talent) {
    const text = cut(raw.talent.text, RESEARCH_LIMITS.talent);
    const title = titles.get(normUrl(raw.talent.url));
    const host = hostOf(raw.talent.url);
    if (text && title !== undefined && isWebUrl(raw.talent.url) && (!opts.domain || onDomain(host, opts.domain))) {
      talent = { id: randomUUID(), text, url: raw.talent.url, title, verdict: null };
    }
  }

  const news: NewsItem[] = [];
  const seenUrl = new Set<string>();
  const seenSummary = new Set<string>();
  for (const item of raw.news) {
    const summary = cut(item.summary, RESEARCH_LIMITS.summary);
    const key = normUrl(item.url);
    const title = titles.get(key);
    if (!summary || title === undefined || !isWebUrl(item.url) || seenUrl.has(key) || seenSummary.has(summary)) continue;
    seenUrl.add(key);
    seenSummary.add(summary);
    news.push({
      id: randomUUID(),
      summary,
      date: cleanDate(item.date, opts.today),
      url: item.url,
      title,
      checked: false,
    });
    if (news.length >= RESEARCH_LIMITS.news) break;
  }
  return { talent, news };
}

// 사용자가 맞다고 한 인재상과 체크한 소식만 지원서에 쓸 수 있는 회사 사실이 된다
export function companyFacts(r: { talent: Talent | null; news: NewsItem[] }): CompanyFact[] {
  const facts: CompanyFact[] = [];
  if (r.talent?.verdict === "yes") {
    facts.push({ id: r.talent.id, kind: "talent", text: r.talent.text, url: r.talent.url, title: r.talent.title, date: null });
  }
  for (const n of r.news) {
    if (n.checked) facts.push({ id: n.id, kind: "news", text: n.summary, url: n.url, title: n.title, date: n.date });
  }
  return facts;
}

export const factNumbers = (fact: CompanyFact): string[] => numbersIn(fact.text);

// 화면이 보여 줄 조사 상태. running이 5분을 넘기면 멈춘 것(stuck)으로 본다
export function researchState(
  r: Pick<Research, "status" | "startedAt" | "researchedAt"> | null,
  now: Date,
): "none" | "running" | "stuck" | "done" | "stale" | "failed" {
  if (!r) return "none";
  if (r.status === "running") {
    const minutes = (now.getTime() - r.startedAt.getTime()) / 60_000;
    return minutes < RESEARCH_LIMITS.runningMinutes ? "running" : "stuck";
  }
  if (r.status === "failed") return "failed";
  const days = r.researchedAt ? (now.getTime() - r.researchedAt.getTime()) / 86_400_000 : Infinity;
  return days > RESEARCH_LIMITS.staleDays ? "stale" : "done";
}
