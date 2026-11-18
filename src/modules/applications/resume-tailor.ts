import { z } from "zod";
import type { Db } from "@/db/types";
import { type AiClient, type AiFailure, runAi } from "@/modules/ai/client";
import { numbersIn } from "@/modules/experiences/grounding";
import { listResumeSources, type ResumeSource } from "@/modules/experiences/writing";
import { getPosting } from "@/modules/postings/repo";
import { RESUME_LIMITS } from "./options";
import { RESUME_EMPHASIS_SYSTEM } from "./prompts";
import { buildEntry, emphasize } from "./resume-entries";
import { getCommonResume, getTailoredResume, saveTailoredContent, saveTailoredSelection } from "./resume-repo";
import { writeLines } from "./resume-write";
import { describeSource, grounded, postingTextOf, requirementsOf } from "./select";
import { aliasKey, cut } from "./text";
import type { EmphasisPick, ResumeContent, ResumeSelection } from "./types";

// 공고에 맞춰 강조할 경험을 고르고(AI는 고르기만), 고른 경험을 공통본에서 맨 위로 올려 다시 쓴 맞춤본을 만든다.
// AI에게는 경험의 실제 id 대신 E1, E2 같은 별명만 보내고, 수치·증빙 메모는 보내지 않는다.

const emphasisSchema = z.object({ picks: z.array(z.object({ exp: z.string(), why: z.string() })) });

export type EmphasisInput = { postingText: string; requirements: string[]; sources: ResumeSource[] };

function buildMessage(input: EmphasisInput): string {
  const sections: [string, string][] = [
    ["공고", input.postingText],
    ["공고 요구 사항", input.requirements.length > 0 ? input.requirements.join("\n") : "없음"],
    ["경험 기록", input.sources.map((s, i) => describeSource(`E${i + 1}`, s, false)).join("\n\n")],
  ];
  return sections.map(([label, value]) => `[${label}]\n${value}`).join("\n\n");
}

// 저장하지 않는다. 프롬프트 점검도 이것을 쓴다
export async function emphasisText(
  db: Db,
  ai: AiClient,
  userId: string,
  input: EmphasisInput,
  now: Date = new Date(),
): Promise<{ ok: true; value: ResumeSelection } | { ok: false; reason: "over_limit" | AiFailure }> {
  const selectedAt = now.toISOString();
  // 후보가 없으면 AI를 부르지 않는다
  if (input.sources.length === 0) return { ok: true, value: { picks: [], noMatch: true, selectedAt } };

  const result = await runAi(
    db,
    ai,
    userId,
    {
      purpose: "resume_emphasis",
      system: RESUME_EMPHASIS_SYSTEM,
      messages: [{ role: "user", text: buildMessage(input) }],
      schema: emphasisSchema,
      effort: "medium",
      maxTokens: 8000,
    },
    now,
  );
  if (!result.ok) return { ok: false, reason: result.reason };

  // 없는 별명과 중복은 버리고, 지어낸 숫자가 든 이유는 비운다
  const byAlias = new Map(input.sources.map((s, i) => [`E${i + 1}`, s]));
  const known = new Set(numbersIn(input.postingText));
  const picks: EmphasisPick[] = [];
  const picked = new Set<string>();
  for (const item of result.value.picks) {
    const s = byAlias.get(aliasKey(item.exp) ?? "");
    if (!s || picked.has(s.id) || picks.length >= RESUME_LIMITS.emphasis) continue;
    picked.add(s.id);
    const why = cut(item.why.trim(), RESUME_LIMITS.reason);
    picks.push({ experienceId: s.id, contentVersion: s.contentVersion, why: grounded(why, s, known) ? why : "" });
  }
  return { ok: true, value: { picks, noMatch: picks.length === 0, selectedAt } };
}

type Failure = "not_found" | "not_apply" | "no_common";

// 공고가 내 것이고 지원인지, 공통본이 있는지 본다. 맞춤본 저장은 늘 공고의 트랙으로 한다
async function loadBase(db: Db, userId: string, postingId: string) {
  const posting = await getPosting(db, userId, postingId);
  if (!posting) return { ok: false as const, reason: "not_found" as Failure };
  if (posting.status !== "apply") return { ok: false as const, reason: "not_apply" as Failure };
  const common = await getCommonResume(db, userId, posting.trackId);
  if (!common?.content) return { ok: false as const, reason: "no_common" as Failure };
  return { ok: true as const, posting, common, commonContent: common.content };
}

export async function selectEmphasis(
  db: Db,
  ai: AiClient,
  userId: string,
  postingId: string,
  now: Date = new Date(),
): Promise<{ ok: true; value: ResumeSelection } | { ok: false; reason: Failure | "over_limit" | AiFailure }> {
  const base = await loadBase(db, userId, postingId);
  if (!base.ok) return base;
  const { posting, commonContent } = base;

  // 후보: 공통본에 있고 지금 "사용"인 경험(공통본 순서). 학력·자격은 요건 충족만 보여 줄 뿐 자세히 쓸 내용이 없어 뺀다(직접 체크는 buildTailored가 받는다)
  const listed = new Map((await listResumeSources(db, userId, posting.trackId)).map((s) => [s.id, s]));
  const sources = commonContent.entries.flatMap((entry) => {
    const s = listed.get(entry.experienceId);
    return s && s.scope === "use" && s.kind !== "school" && s.kind !== "certificate" ? [s] : [];
  });

  const selected = await emphasisText(
    db,
    ai,
    userId,
    { postingText: postingTextOf(posting), requirements: requirementsOf(posting), sources },
    now,
  );
  if (!selected.ok) return selected;
  const saved = await saveTailoredSelection(db, userId, postingId, posting.trackId, selected.value);
  return saved.ok ? selected : saved;
}

export async function buildTailored(
  db: Db,
  ai: AiClient,
  userId: string,
  postingId: string,
  experienceIds: string[],
  expectedVersion: number | null,
  now: Date = new Date(),
): Promise<
  { ok: true; value: ResumeContent } | { ok: false; reason: Failure | "changed" | "too_many_selected" | "over_limit" | AiFailure }
> {
  const base = await loadBase(db, userId, postingId);
  if (!base.ok) return base;
  const { posting, common, commonContent } = base;
  const trackId = posting.trackId;

  // 보낸 id 중 지금 쓸 수 있는 경험만, 중복 없이 보낸 순서대로(요약만 경험도 받는다)
  const byId = new Map((await listResumeSources(db, userId, trackId)).map((s) => [s.id, s]));
  const chosen = [...new Set(experienceIds)].flatMap((id) => byId.get(id) ?? []);
  if (chosen.length > RESUME_LIMITS.emphasis) return { ok: false, reason: "too_many_selected" };

  // 읽었을 때의 맞춤본 그대로일 때만 만든다(AI 호출 전에도 본다)
  const current = await getTailoredResume(db, userId, postingId);
  if (current ? current.version !== expectedVersion : expectedVersion !== null) return { ok: false, reason: "changed" };

  if (chosen.length === 0) {
    const content = emphasize(commonContent, [], common.version);
    const saved = await saveTailoredContent(db, userId, postingId, trackId, content, expectedVersion);
    return saved.ok ? { ok: true, value: content } : saved;
  }

  const written = await writeLines(
    db,
    ai,
    userId,
    {
      requests: chosen.map((source) => ({ source, detail: "full" as const, emphasize: true })),
      posting: { text: postingTextOf(posting), requirements: requirementsOf(posting) },
    },
    now,
  );
  if (!written.ok) return written;

  // AI가 답에서 뺀 경험은 공통본 항목을 그대로 두고 강조만 켠다(줄을 비우지 않는다)
  const inCommon = new Map(commonContent.entries.map((e) => [e.experienceId, e]));
  const entries = chosen.map((s) => {
    const kept = inCommon.get(s.id);
    if (kept && !written.answered.has(s.id)) return { ...kept, emphasized: true };
    return buildEntry(s, "full", true, written.value[s.id] ?? [], now);
  });
  const content = emphasize(commonContent, entries, common.version);
  const saved = await saveTailoredContent(db, userId, postingId, trackId, content, expectedVersion);
  return saved.ok ? { ok: true, value: content } : saved;
}
