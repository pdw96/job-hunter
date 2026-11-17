import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db/types";
import { type AiClient, type AiFailure, runAi } from "@/modules/ai/client";
import { LIMITS, type RubricItem } from "./options";
import { describeExperience, JUDGE_SYSTEM } from "./prompts";
import { getExperience } from "./repo";
import { experiences } from "./schema";

// AI 루브릭 판정과 금지 표현 후보.
// AI는 기록이 구체적인지만 판정한다. 사실인지는 사용자가 "내용이 맞습니다"로 확인하므로 confirmedAt은 건드리지 않는다.

const MAX_CANDIDATES = 20;
// 기간은 코드가 판정하므로 AI에게 묻지 않는다
const JUDGED_ITEMS = ["role", "level", "metrics", "evidence"] as const satisfies readonly RubricItem[];

const itemSchema = z.object({ status: z.enum(["met", "unmet"]), note: z.string() });
const judgementSchema = z.object({
  role: itemSchema,
  level: itemSchema,
  metrics: itemSchema,
  evidence: itemSchema,
  phraseCandidates: z.array(z.string()),
});
type Judgement = z.infer<typeof judgementSchema>;

type Failure = "not_found" | "changed" | "over_limit" | AiFailure;

const mine = (userId: string, id: string) => and(eq(experiences.id, id), eq(experiences.userId, userId));

function cleanCandidates(raw: string[], banned: string[], dismissed: string[]): string[] {
  const excluded = new Set([...banned, ...dismissed]);
  const cleaned = raw
    .map((phrase) => phrase.trim())
    .filter((phrase) => phrase !== "" && phrase.length <= LIMITS.shortText && !excluded.has(phrase));
  return [...new Set(cleaned)].slice(0, MAX_CANDIDATES);
}

export async function judgeExperience(
  db: Db,
  ai: AiClient,
  userId: string,
  experienceId: string,
  now: Date = new Date(),
): Promise<{ ok: true } | { ok: false; reason: Failure }> {
  const experience = await getExperience(db, userId, experienceId);
  if (!experience) return { ok: false, reason: "not_found" };

  const result = await runAi(
    db,
    ai,
    userId,
    {
      purpose: "judge",
      system: JUDGE_SYSTEM,
      messages: [{ role: "user", text: describeExperience(experience) }],
      schema: judgementSchema,
      effort: "medium",
      maxTokens: 8000,
    },
    now,
  );
  if (!result.ok) return { ok: false, reason: result.reason };
  const judgement: Judgement = result.value;

  // 항목마다 DB 안에서 바꾼다. 닫았거나 적용하지 않는 항목은 그대로 둔다(그사이 닫았을 수도 있다)
  let rubric = sql`${experiences.rubric}`;
  for (const item of JUDGED_ITEMS) {
    const { status, note } = judgement[item];
    const entry = JSON.stringify({ status, note: status === "unmet" && note.trim() !== "" ? note.trim() : null });
    rubric = sql`jsonb_set(${rubric}, ${`{${item}}`}::text[],
      case when ${experiences.rubric} -> ${item} ->> 'status' in ('closed', 'na')
        then ${experiences.rubric} -> ${item}
        else ${entry}::jsonb end)`;
  }

  // 읽었을 때의 내용 그대로일 때만 반영한다. 그사이 내용이 바뀌었으면 이 판정은 예전 내용에 대한 것이다
  const updated = await db
    .update(experiences)
    .set({
      rubric,
      judgedAt: now,
      phraseCandidates: cleanCandidates(
        judgement.phraseCandidates,
        experience.bannedPhrases,
        experience.dismissedPhrases,
      ),
    })
    .where(and(mine(userId, experienceId), eq(experiences.contentVersion, experience.contentVersion)))
    .returning({ id: experiences.id });
  return updated.length > 0 ? { ok: true } : { ok: false, reason: "changed" };
}

type PhraseResult = { ok: true } | { ok: false; reason: "not_found" };

// 후보를 금지 목록으로 옮긴다. AI가 제안한 것 중 사용자가 승인한 것만 금지 표현이 된다
export async function approvePhrase(db: Db, userId: string, id: string, phrase: string): Promise<PhraseResult> {
  const experience = await getExperience(db, userId, id);
  if (!experience || !experience.phraseCandidates.includes(phrase)) return { ok: false, reason: "not_found" };
  await db
    .update(experiences)
    .set({
      phraseCandidates: experience.phraseCandidates.filter((candidate) => candidate !== phrase),
      bannedPhrases: [...new Set([...experience.bannedPhrases, phrase])],
    })
    .where(mine(userId, id));
  return { ok: true };
}

// 후보를 거절한다. 기억해 두고 다시 제안받지 않는다
export async function dismissPhrase(db: Db, userId: string, id: string, phrase: string): Promise<PhraseResult> {
  const experience = await getExperience(db, userId, id);
  if (!experience || !experience.phraseCandidates.includes(phrase)) return { ok: false, reason: "not_found" };
  await db
    .update(experiences)
    .set({
      phraseCandidates: experience.phraseCandidates.filter((candidate) => candidate !== phrase),
      dismissedPhrases: [...new Set([...experience.dismissedPhrases, phrase])].slice(-100),
    })
    .where(mine(userId, id));
  return { ok: true };
}

// 증빙이 미달인 기록. 당장 채울 수 없는 증빙은 여기에 할 일로 쌓인다
export async function listEvidenceTodos(
  db: Db,
  userId: string,
): Promise<{ id: string; name: string; note: string | null }[]> {
  const rows = await db
    .select({ id: experiences.id, name: experiences.name, rubric: experiences.rubric })
    .from(experiences)
    .where(and(eq(experiences.userId, userId), sql`${experiences.rubric} -> 'evidence' ->> 'status' = 'unmet'`))
    .orderBy(experiences.createdAt);
  return rows.map((row) => ({ id: row.id, name: row.name, note: row.rubric.evidence.note }));
}
