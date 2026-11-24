import { beforeEach, expect, test } from "vitest";
import { createTestDb } from "@/db/test-db";
import type { Db } from "@/db/types";
import type { AiRequest, WebSource } from "@/modules/ai/client";
import { createFakeAi } from "@/modules/ai/fake-client";
import { user } from "@/modules/auth/schema";
import { createTrack } from "@/modules/tracks/repo";
import type { SurveyInput } from "@/modules/tracks/survey";
import { validatePosting } from "./input";
import { createPosting } from "./repo";
import { claimResearch, getResearch } from "./research-repo";
import { researchText, runResearch } from "./research-run";

let db: Db;
let trackId: string;
const now = new Date("2026-11-24T03:00:00Z");
const today = "2026-11-24";
const key = "가나다";

const survey: SurveyInput = {
  name: "백엔드 개발",
  majorCode: "20",
  jobs: [{ ncsCode: null, customName: "백엔드 개발자" }],
  applicantType: "new",
  experienceMonths: 0,
  regions: ["seoul"],
  salaryMin: null,
  employmentTypes: ["regular"],
  importanceOrder: ["jobMatch", "location", "experience", "field", "preferred"],
  extraAnswers: {},
};

const RAW = `가나다 주식회사 백엔드 개발자 채용
담당 업무
- 사내 비밀 코드명 블루버드 결제 서버 개발
문의 hr@gana.example`;
const WITH_DOMAIN = `${RAW}\n회사 소개: https://www.gana.co.kr/about`;

async function addPosting(over: Record<string, unknown> = {}, userId = "u1") {
  const checked = validatePosting({
    company: "가나다 주식회사",
    title: "백엔드 개발자",
    deadline: "2026-12-10",
    isRolling: false,
    locationText: "",
    regions: [],
    careerType: "new",
    minYears: "",
    employmentType: "regular",
    url: "https://www.saramin.co.kr/zf/1",
    rawText: RAW,
    companyNote: "",
    ...over,
  });
  if (!checked.ok) throw new Error(JSON.stringify(checked.errors));
  const result = await createPosting(db, userId, trackId, checked.value);
  if (!result.ok) throw new Error(result.reason);
  return result.id;
}

const src = (url: string, title = "제목"): WebSource => ({ url, title, pageAge: null });
const web = (answer: unknown, sources: WebSource[], searches = 1) => ({ web: { answer, sources, searches } });

const TALENT_URL = "https://www.gana.co.kr/talent";
const NEWS_URL = "https://news.example.com/a1";
const talentAnswer = web({ talent: { text: "끝까지 파고드는 사람", url: TALENT_URL }, news: [] }, [src(TALENT_URL, "인재상")], 2);
const newsAnswer = web(
  { talent: null, news: [{ summary: "가나다가 새 결제 서비스를 내놓았다", date: "2026-10-01", url: NEWS_URL }] },
  [src(NEWS_URL, "가나다 새 서비스")],
  3,
);
const bothAnswer = web(
  {
    talent: { text: "끝까지 파고드는 사람", url: TALENT_URL },
    news: [{ summary: "가나다가 새 결제 서비스를 내놓았다", date: "2026-10-01", url: NEWS_URL }],
  },
  [src(TALENT_URL, "인재상"), src(NEWS_URL, "가나다 새 서비스")],
  4,
);

// 두 번 부를 때는 어느 호출인지(도메인으로 좁혔는지) 보고 답한다
const isTalentCall = (request: AiRequest<unknown>) => (request.webSearch?.allowedDomains?.length ?? 0) > 0;
const split = (talent: unknown, news: unknown) =>
  createFakeAi([0, 1].map(() => (request: AiRequest<unknown>) => (isTalentCall(request) ? talent : news)));

beforeEach(async () => {
  delete process.env.AI_MONTHLY_LIMIT_USD;
  db = await createTestDb();
  await db.insert(user).values([
    { id: "u1", name: "홍길동", email: "u1@example.com" },
    { id: "u2", name: "김철수", email: "u2@example.com" },
  ]);
  const track = await createTrack(db, "u1", survey);
  if (!track.ok) throw new Error(track.reason);
  trackId = track.id;
});

test("도메인이 없으면 AI 한 번, 검색 5번까지", async () => {
  const id = await addPosting();
  const ai = createFakeAi([bothAnswer]);
  // 조사일은 시작한 때가 아니라 끝난 때다
  const finishedAt = new Date(now.getTime() + 70_000);
  expect(await runResearch(db, ai, "u1", id, { onlyIfMissing: true }, now, () => finishedAt)).toEqual({ started: true });

  expect(ai.requests).toHaveLength(1);
  expect(ai.requests[0].purpose).toBe("company_research");
  expect(ai.requests[0].webSearch).toEqual({ maxUses: 5 });
  expect(ai.requests[0].messages[0].text).toContain("[찾을 것]\n인재상, 최근 소식");
  expect(ai.requests[0].messages[0].text).toContain("[홈페이지]\n없음");

  const row = await getResearch(db, "u1", key);
  expect(row).toMatchObject({ status: "done", failure: null, talentSkipped: false, company: "가나다 주식회사" });
  expect(row?.researchedAt).toEqual(finishedAt);
  expect(row?.startedAt).toEqual(now);
  expect(row?.talent).toMatchObject({ text: "끝까지 파고드는 사람", url: TALENT_URL, title: "인재상", verdict: null });
  expect(row?.news).toEqual([
    expect.objectContaining({ summary: "가나다가 새 결제 서비스를 내놓았다", date: "2026-10-01", url: NEWS_URL, checked: false }),
  ]);
});

test("도메인이 있고 인재상을 찾으면 AI 두 번이고 인재상 호출만 도메인으로 좁힌다", async () => {
  const id = await addPosting({ rawText: WITH_DOMAIN });
  const ai = split(talentAnswer, newsAnswer);
  await runResearch(db, ai, "u1", id, { onlyIfMissing: true }, now);

  expect(ai.requests).toHaveLength(2);
  const talentCall = ai.requests.find(isTalentCall);
  const newsCall = ai.requests.find((r) => !isTalentCall(r));
  expect(talentCall?.webSearch).toEqual({ maxUses: 2, allowedDomains: ["gana.co.kr"] });
  expect(newsCall?.webSearch).toEqual({ maxUses: 3 });
  expect(talentCall?.messages[0].text).toContain("[찾을 것]\n인재상");
  expect(talentCall?.messages[0].text).not.toContain("최근 소식");
  expect(newsCall?.messages[0].text).toContain("[찾을 것]\n최근 소식");
  // 지시문은 같고 [찾을 것]만 다르다
  expect(talentCall?.system).toBe(newsCall?.system);

  const row = await getResearch(db, "u1", key);
  expect(row).toMatchObject({ status: "done", talentSkipped: false });
  expect(row?.talent?.url).toBe(TALENT_URL);
  expect(row?.news.map((n) => n.url)).toEqual([NEWS_URL]);
});

test("인재상 주소는 인재상 호출의 검색 결과에 있어야 한다", async () => {
  // 소식 호출이 인재상 주소를 검색했어도, 인재상 호출의 검색 결과에 없으면 버린다
  const talentWithoutSource = web({ talent: { text: "끝까지 파고드는 사람", url: TALENT_URL }, news: [] }, [src("https://www.gana.co.kr/other")]);
  const newsWithTalentSource = web(
    { talent: null, news: [{ summary: "가나다가 새 결제 서비스를 내놓았다", date: null, url: NEWS_URL }] },
    [src(NEWS_URL), src(TALENT_URL)],
  );
  const result = await researchText(
    db,
    split(talentWithoutSource, newsWithTalentSource),
    "u1",
    { company: "가나다", title: "백엔드", domain: "gana.co.kr", wantTalent: true, today },
    now,
  );
  expect(result).toMatchObject({ ok: true, value: { talent: null, dropped: 1 } });
});

test("인재상 글이 있는 공고는 인재상을 찾지 않고 talentSkipped", async () => {
  const id = await addPosting({ rawText: WITH_DOMAIN, companyNote: "도전하는 사람" });
  const ai = createFakeAi([bothAnswer]);
  await runResearch(db, ai, "u1", id, { onlyIfMissing: true }, now);

  expect(ai.requests).toHaveLength(1);
  expect(ai.requests[0].webSearch).toEqual({ maxUses: 5 });
  expect(ai.requests[0].messages[0].text).toContain("[찾을 것]\n최근 소식");
  expect(ai.requests[0].messages[0].text).not.toContain("인재상");

  const row = await getResearch(db, "u1", key);
  expect(row).toMatchObject({ status: "done", talentSkipped: true, talent: null });
  expect(row?.news).toHaveLength(1);
});

test("AI에 회사 이름·제목·도메인·날짜만 보낸다", async () => {
  const id = await addPosting({ rawText: WITH_DOMAIN });
  const ai = split(talentAnswer, newsAnswer);
  await runResearch(db, ai, "u1", id, { onlyIfMissing: true }, now);

  for (const request of ai.requests) {
    expect(request.messages).toHaveLength(1);
    const text = request.messages[0].text;
    expect(text).toContain("[회사]\n가나다 주식회사");
    expect(text).toContain("[지원 직무]\n백엔드 개발자");
    expect(text).toContain("[홈페이지]\ngana.co.kr");
    expect(text).toContain(`[오늘]\n${today}`);
    for (const secret of ["블루버드", "담당 업무", "홍길동", "u1@example.com", "hr@gana", "u1", id]) {
      expect(text).not.toContain(secret);
      expect(request.system).not.toContain(secret);
    }
    // 지시문에는 바뀌는 값(날짜·이름)을 넣지 않는다
    expect(request.system).not.toContain(today);
    expect(request.system).not.toContain("가나다");
  }
});

test("검사로 버린 수를 dropped로 돌려준다", async () => {
  const ai = createFakeAi([
    web(
      {
        talent: { text: "도전", url: "https://made-up.example.com/talent" }, // 검색 결과에 없음
        news: [
          { summary: "소식 하나", date: "2026-09-01", url: NEWS_URL },
          { summary: "소식 둘", date: null, url: NEWS_URL }, // 같은 주소
          { summary: "지어낸 소식", date: null, url: "https://made-up.example.com/n" }, // 검색 결과에 없음
        ],
      },
      [src(NEWS_URL)],
    ),
  ]);
  const result = await researchText(db, ai, "u1", { company: "가나다", title: "백엔드", domain: null, wantTalent: true, today }, now);
  expect(result).toMatchObject({ ok: true, value: { talent: null, dropped: 3 } });
  if (result.ok) expect(result.value.news.map((n) => n.summary)).toEqual(["소식 하나"]);
});

test("인재상을 찾지 않으면 AI가 준 인재상은 버린 수에 넣지 않는다", async () => {
  const result = await researchText(db, createFakeAi([bothAnswer]), "u1", { company: "가나다", title: "백엔드", domain: null, wantTalent: false, today }, now);
  expect(result).toMatchObject({ ok: true, value: { talent: null, dropped: 0 } });
});

test("한도에 닿으면 over_limit로 남긴다", async () => {
  process.env.AI_MONTHLY_LIMIT_USD = "0";
  const id = await addPosting({ rawText: WITH_DOMAIN });
  const ai = split(talentAnswer, newsAnswer);
  expect(await runResearch(db, ai, "u1", id, { onlyIfMissing: true }, now)).toEqual({ started: true });
  expect(ai.requests).toHaveLength(0);
  expect(await getResearch(db, "u1", key)).toMatchObject({ status: "failed", failure: "over_limit", researchedAt: null });
});

test("AI가 unavailable이면 실패로 남긴다", async () => {
  const id = await addPosting();
  await runResearch(db, createFakeAi([{ fail: "unavailable" }]), "u1", id, { onlyIfMissing: true }, now);
  expect(await getResearch(db, "u1", key)).toMatchObject({ status: "failed", failure: "unavailable" });
});

test("거절·잘림은 unavailable, 답 모양이 틀리면 not_found", async () => {
  const input = { company: "가나다", title: "백엔드", domain: null, wantTalent: true, today };
  for (const [fail, reason] of [
    ["refused", "unavailable"],
    ["truncated", "unavailable"],
    ["invalid", "not_found"],
  ] as const) {
    expect(await researchText(db, createFakeAi([{ fail }]), "u1", input, now)).toEqual({ ok: false, reason });
  }
});

test("출처가 하나도 없으면 not_found", async () => {
  const id = await addPosting();
  const noSources = web({ talent: { text: "도전", url: TALENT_URL }, news: [] }, [], 5);
  await runResearch(db, createFakeAi([noSources]), "u1", id, { onlyIfMissing: true }, now);
  expect(await getResearch(db, "u1", key)).toMatchObject({ status: "failed", failure: "not_found" });
});

test("검사 뒤 인재상과 소식이 모두 비면 not_found", async () => {
  const ai = createFakeAi([web({ talent: null, news: [{ summary: "지어냄", date: null, url: "https://made-up.example.com" }] }, [src(NEWS_URL)])]);
  const result = await researchText(db, ai, "u1", { company: "가나다", title: "백엔드", domain: null, wantTalent: true, today }, now);
  expect(result).toEqual({ ok: false, reason: "not_found" });
});

test("소식 호출만 실패하면 인재상만 저장한다", async () => {
  const id = await addPosting({ rawText: WITH_DOMAIN });
  await runResearch(db, split(talentAnswer, { fail: "unavailable" }), "u1", id, { onlyIfMissing: true }, now);
  const row = await getResearch(db, "u1", key);
  expect(row).toMatchObject({ status: "done", failure: null, news: [] });
  expect(row?.talent?.url).toBe(TALENT_URL);
});

test("두 호출이 모두 실패하면 더 무거운 이유로 남긴다", async () => {
  const input = { company: "가나다", title: "백엔드", domain: "gana.co.kr", wantTalent: true, today };
  const noSources = web({ talent: null, news: [] }, []);
  expect(await researchText(db, split(noSources, { fail: "unavailable" }), "u1", input, now)).toEqual({ ok: false, reason: "unavailable" });
  expect(await researchText(db, split(noSources, noSources), "u1", input, now)).toEqual({ ok: false, reason: "not_found" });
});

test("이미 조사 중이면 AI를 부르지 않는다", async () => {
  const id = await addPosting();
  await claimResearch(db, "u1", key, "가나다 주식회사", now, { onlyIfMissing: false });
  const ai = createFakeAi([bothAnswer]);
  expect(await runResearch(db, ai, "u1", id, { onlyIfMissing: false }, new Date(now.getTime() + 60_000))).toEqual({ started: false });
  expect(ai.requests).toHaveLength(0);
  expect(await getResearch(db, "u1", key)).toMatchObject({ status: "running", startedAt: now });
});

test("AI 호출이 예외를 던지면 실패로 남기고 예외를 다시 던진다", async () => {
  const id = await addPosting();
  const ai = createFakeAi([]); // 준비된 답이 없으면 예외를 던진다
  await expect(runResearch(db, ai, "u1", id, { onlyIfMissing: true }, now)).rejects.toThrow();
  expect(await getResearch(db, "u1", key)).toMatchObject({ status: "failed", failure: "unavailable" });
});

test("회사 이름 정리 값이 비면 시작하지 않는다", async () => {
  const id = await addPosting({ company: "(주)" });
  const ai = createFakeAi([bothAnswer]);
  expect(await runResearch(db, ai, "u1", id, { onlyIfMissing: true }, now)).toEqual({ started: false });
  expect(ai.requests).toHaveLength(0);
  expect(await getResearch(db, "u1", "")).toBeNull();
});

test("남의 공고는 시작하지 않는다", async () => {
  const id = await addPosting();
  const ai = createFakeAi([bothAnswer]);
  expect(await runResearch(db, ai, "u2", id, { onlyIfMissing: true }, now)).toEqual({ started: false });
  expect(ai.requests).toHaveLength(0);
  expect(await getResearch(db, "u2", key)).toBeNull();
  expect(await getResearch(db, "u1", key)).toBeNull();
});
