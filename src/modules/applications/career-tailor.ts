import type { Db } from "@/db/types";
import type { AiClient, AiFailure } from "@/modules/ai/client";
import { type CareerItemSource, listCareerSources } from "@/modules/experiences/sources";
import { getPosting } from "@/modules/postings/repo";
import { buildItem, emphasizeItems } from "./career-entries";
import { getCommonCareer, getTailoredCareer, saveTailoredCareerContent, saveTailoredCareerSelection } from "./career-repo";
import { writeCareerItems } from "./career-write";
import { RESUME_LIMITS } from "./options";
import { emphasisText } from "./resume-tailor";
import { postingTextOf, requirementsOf } from "./select";
import { editBlock, withEditLock } from "./submission-repo";
import type { CareerContent, CareerItem, CareerSelection } from "./types";

// 공고에 맞춰 강조할 경력기술서 항목을 고르고(AI는 고르기만, 이력서의 emphasisText를 목적만 바꿔 쓴다),
// 고른 항목을 그 회사 안에서 맨 위로 올려 다시 쓴 맞춤본을 만든다. 회사 순서는 바꾸지 않는다(시간 순)

type Failure = "not_found" | "not_apply" | "submitted" | "no_common";

// 공고가 내 것이고 지원인지, 공통본이 있는지 본다. 맞춤본 저장은 늘 공고의 트랙으로 한다
async function loadBase(db: Db, userId: string, postingId: string) {
  const posting = await getPosting(db, userId, postingId);
  if (!posting) return { ok: false as const, reason: "not_found" as Failure };
  const block = await editBlock(db, userId, posting);
  if (block) return { ok: false as const, reason: block as Failure };
  const common = await getCommonCareer(db, userId, posting.trackId);
  if (!common?.content) return { ok: false as const, reason: "no_common" as Failure };
  return { ok: true as const, posting, common, commonContent: common.content };
}

// 항목 id → 지금 그 항목이 딸린 경력 id와 원천
async function listedItems(db: Db, userId: string, trackId: string) {
  const sources = await listCareerSources(db, userId, trackId);
  const items = new Map<string, { companyId: string; item: CareerItemSource }>();
  for (const source of sources) for (const item of source.items) items.set(item.id, { companyId: source.id, item });
  return { sources, items };
}

export async function selectCareerEmphasis(
  db: Db,
  ai: AiClient,
  userId: string,
  postingId: string,
  now: Date = new Date(),
): Promise<{ ok: true; value: CareerSelection } | { ok: false; reason: Failure | "over_limit" | AiFailure }> {
  const base = await loadBase(db, userId, postingId);
  if (!base.ok) return base;
  const { posting, commonContent } = base;

  // 후보: 공통본에 있고 지금 "사용"인 항목(공통본 순서). 요약만 항목은 직접 체크하면 buildTailoredCareer가 받는다
  const { items } = await listedItems(db, userId, posting.trackId);
  const sources = commonContent.companies.flatMap((company) =>
    company.items.flatMap((entry) => {
      const listed = items.get(entry.experienceId);
      return listed && listed.item.scope === "use" ? [listed.item] : [];
    }),
  );

  const selected = await emphasisText(
    db,
    ai,
    userId,
    { postingText: postingTextOf(posting), requirements: requirementsOf(posting), sources },
    now,
    undefined,
    "career_emphasis",
  );
  if (!selected.ok) return selected;
  const saved = await withEditLock(db, userId, posting.id, (tx) =>
    saveTailoredCareerSelection(tx, userId, postingId, posting.trackId, selected.value),
  );
  return saved.ok ? selected : saved;
}

export async function buildTailoredCareer(
  db: Db,
  ai: AiClient,
  userId: string,
  postingId: string,
  itemIds: string[],
  expectedVersion: number | null,
  now: Date = new Date(),
): Promise<
  { ok: true; value: CareerContent } | { ok: false; reason: Failure | "changed" | "too_many_selected" | "over_limit" | AiFailure }
> {
  const base = await loadBase(db, userId, postingId);
  if (!base.ok) return base;
  const { posting, common, commonContent } = base;
  const trackId = posting.trackId;

  // 보낸 id 중 지금 쓸 수 있는 항목만, 중복 없이 보낸 순서대로(요약만 항목도 받는다. 경력 id는 버린다)
  const { sources, items } = await listedItems(db, userId, trackId);
  const chosen = [...new Set(itemIds)].flatMap((id) => items.get(id) ?? []);
  if (chosen.length > RESUME_LIMITS.emphasis) return { ok: false, reason: "too_many_selected" };

  // 읽었을 때의 맞춤본 그대로일 때만 만든다(AI 호출 전에도 본다)
  const current = await getTailoredCareer(db, userId, postingId);
  if (current ? current.version !== expectedVersion : expectedVersion !== null) return { ok: false, reason: "changed" };

  const save = async (content: CareerContent) => {
    const saved = await withEditLock(db, userId, posting.id, (tx) =>
      saveTailoredCareerContent(tx, userId, postingId, trackId, content, expectedVersion),
    );
    return saved.ok ? { ok: true as const, value: content } : saved;
  };

  // 아무것도 고르지 않으면 AI 없이 공통본을 그대로 복사한다
  if (chosen.length === 0) return save(emphasizeItems(commonContent, [], sources, common.version));

  const written = await writeCareerItems(
    db,
    ai,
    userId,
    {
      requests: chosen.map(({ companyId, item }) => ({ companyId, item, detail: "full" as const, emphasize: true })),
      posting: { text: postingTextOf(posting), requirements: requirementsOf(posting) },
    },
    now,
  );
  if (!written.ok) return written;

  // AI가 답에서 뺀 항목은 공통본 항목을 그대로 두고 강조만 켠다(줄을 비우지 않는다, 맨 위로만 옮긴다).
  // 공통본에 없는 항목은 새로 만들어 그 회사 맨 위에 넣는다(회사가 없으면 emphasizeItems가 회사 머리를 만든다)
  const inCommon = new Map<string, CareerItem>(
    commonContent.companies.flatMap((company) => company.items.map((item) => [item.experienceId, item])),
  );
  const picked = chosen.map(({ companyId, item }) => {
    const kept = inCommon.get(item.id);
    if (kept && !written.answered.has(item.id)) return { companyId, item: { ...kept, emphasized: true } };
    return { companyId, item: buildItem(item, "full", true, written.value[item.id] ?? { done: [], results: [] }, now) };
  });
  return save(emphasizeItems(commonContent, picked, sources, common.version));
}
