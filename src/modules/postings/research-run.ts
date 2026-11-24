import { z } from "zod";
import type { Db } from "@/db/types";
import { type AiClient, type AiRequest, runAi } from "@/modules/ai/client";
import { companyKey } from "./company";
import { RESEARCH_SYSTEM } from "./prompts";
import { getPosting } from "./repo";
import { cleanResearch, homepageDomain, type NewsItem, type RawResearch, type ResearchFailure, type Talent, wantsTalent } from "./research";
import { claimResearch, failResearch, finishResearch } from "./research-repo";
import { todayInKorea } from "./today";

// 공고의 회사를 Claude 웹 검색으로 조사한다. AI에게는 회사 이름, 공고 제목, 홈페이지 도메인, 인재상을 찾을지, 오늘 날짜만 보낸다.
// 지원자 정보와 공고 원문은 보내지 않는다. AI가 준 주소는 그 호출의 검색 결과에 있는 것만 남긴다(cleanResearch)

const researchSchema = z.object({
  talent: z.object({ text: z.string(), url: z.string() }).nullable(),
  news: z.array(z.object({ summary: z.string(), date: z.string().nullable(), url: z.string() })),
});

export type ResearchInput = { company: string; title: string; domain: string | null; wantTalent: boolean; today: string };
export type ResearchValue = { talent: Talent | null; news: NewsItem[]; dropped: number };

type Part = { talent: boolean; news: boolean; webSearch: NonNullable<AiRequest<unknown>["webSearch"]> };
type PartResult = { ok: true; talent: Talent | null; news: NewsItem[]; dropped: number } | { ok: false; reason: ResearchFailure };

// 도메인이 있고 인재상을 찾으면 인재상만 도메인으로 좁혀야 하므로 두 번 부른다. 아니면 한 번
function partsOf(input: ResearchInput): Part[] {
  if (input.domain && input.wantTalent) {
    return [
      { talent: true, news: false, webSearch: { maxUses: 2, allowedDomains: [input.domain] } },
      { talent: false, news: true, webSearch: { maxUses: 3 } },
    ];
  }
  return [{ talent: input.wantTalent, news: true, webSearch: { maxUses: 5 } }];
}

function buildMessage(input: ResearchInput, part: Part): string {
  const wanted = [part.talent ? "인재상" : "", part.news ? "최근 소식" : ""].filter(Boolean).join(", ");
  const sections: [string, string][] = [
    ["회사", input.company],
    ["지원 직무", input.title],
    ["홈페이지", input.domain ?? "없음"],
    ["찾을 것", wanted],
    ["오늘", input.today],
  ];
  return sections.map(([label, value]) => `[${label}]\n${value}`).join("\n\n");
}

async function runPart(db: Db, ai: AiClient, userId: string, input: ResearchInput, part: Part, now: Date): Promise<PartResult> {
  const result = await runAi(
    db,
    ai,
    userId,
    {
      purpose: "company_research",
      system: RESEARCH_SYSTEM,
      messages: [{ role: "user", text: buildMessage(input, part) }],
      schema: researchSchema,
      effort: "medium",
      // 검색 결과는 입력 토큰으로 든다. 생각하는 데 쓰는 토큰과 소식 8개의 답이 들어갈 만큼 둔다
      maxTokens: 16000,
      webSearch: part.webSearch,
    },
    now,
  );
  if (!result.ok) {
    if (result.reason === "over_limit") return { ok: false, reason: "over_limit" };
    return { ok: false, reason: result.reason === "invalid" ? "not_found" : "unavailable" };
  }
  const sources = result.sources ?? [];
  if (sources.length === 0) return { ok: false, reason: "not_found" };
  // 이 호출에서 찾을 것만 본다. 다른 항목을 보냈어도 버린 수에 넣지 않는다
  const raw: RawResearch = { talent: part.talent ? result.value.talent : null, news: part.news ? result.value.news : [] };
  const cleaned = cleanResearch(raw, sources, { wantTalent: part.talent, domain: input.domain, today: input.today });
  const dropped = (raw.talent ? 1 : 0) + raw.news.length - (cleaned.talent ? 1 : 0) - cleaned.news.length;
  return { ok: true, ...cleaned, dropped };
}

// 둘 다 실패했을 때 남길 이유: 한도 > 서비스 오류 > 찾지 못함
const WEIGHT: Record<ResearchFailure, number> = { over_limit: 2, unavailable: 1, not_found: 0 };

// 저장하지 않는다. 프롬프트 점검도 이것을 쓴다.
// 두 번 부르면 함께 돌리고, 하나만 성공하면 성공한 것만 돌려준다. 검사 뒤 인재상·소식이 모두 비면 not_found
export async function researchText(
  db: Db,
  ai: AiClient,
  userId: string,
  input: ResearchInput,
  now: Date = new Date(),
): Promise<{ ok: true; value: ResearchValue } | { ok: false; reason: ResearchFailure }> {
  const results = await Promise.all(partsOf(input).map((part) => runPart(db, ai, userId, input, part, now)));
  const value: ResearchValue = { talent: null, news: [], dropped: 0 };
  const failures: ResearchFailure[] = [];
  for (const result of results) {
    if (!result.ok) {
      failures.push(result.reason);
      continue;
    }
    value.talent ??= result.talent;
    value.news.push(...result.news);
    value.dropped += result.dropped;
  }
  if (value.talent || value.news.length > 0) return { ok: true, value };
  const reason = failures.reduce<ResearchFailure>((worst, r) => (WEIGHT[r] > WEIGHT[worst] ? r : worst), "not_found");
  return { ok: false, reason };
}

// 잡기 → 조사 → 저장(또는 실패로 남기기). 공고가 없거나, 회사 이름 정리 값이 비거나, 잡지 못했으면 시작하지 않는다
export async function runResearch(
  db: Db,
  ai: AiClient,
  userId: string,
  postingId: string,
  opts: { onlyIfMissing: boolean },
  now: Date = new Date(),
): Promise<{ started: boolean }> {
  const posting = await getPosting(db, userId, postingId);
  if (!posting) return { started: false };
  const key = companyKey(posting.company);
  if (!key) return { started: false };
  const company = posting.company.trim();
  const startedAt = await claimResearch(db, userId, key, company, now, opts);
  if (!startedAt) return { started: false };

  const wantTalent = wantsTalent(posting);
  const input: ResearchInput = {
    company,
    title: posting.title,
    domain: homepageDomain(posting.rawText, posting.url),
    wantTalent,
    today: todayInKorea(now),
  };
  try {
    const result = await researchText(db, ai, userId, input, now);
    if (result.ok) {
      await finishResearch(db, userId, key, startedAt, { talent: result.value.talent, talentSkipped: !wantTalent, news: result.value.news }, now);
    } else {
      await failResearch(db, userId, key, startedAt, result.reason, now);
    }
  } catch (error) {
    // 예상하지 못한 오류여도 5분 동안 조사 중으로 남지 않게 실패로 남기고, 부른 쪽이 기록하도록 다시 던진다
    await failResearch(db, userId, key, startedAt, "unavailable", now);
    throw error;
  }
  return { started: true };
}
