import { and, eq, sql } from "drizzle-orm";
import type { Db } from "@/db/types";
import { type AiClient, type AiFailure, runAi } from "@/modules/ai/client";
import { cleanCandidates, type Judgement, judgementSchema } from "./judge";
import type { RubricItem } from "./options";
import { describeScene, JUDGE_SYSTEM } from "./prompts";
import { loadHead } from "./scene-head";
import { getScene } from "./scenes-repo";
import { scenes } from "./schema";

// 장면의 AI 루브릭 판정과 금지 표현 후보. judge.ts와 같은 규칙이다:
// AI는 구체적인지만 판정하고 confirmedAt은 건드리지 않으며, 읽었을 때의 contentVersion 그대로일 때만 반영한다.

// 기간은 코드가 판정하므로 AI에게 묻지 않는다
const JUDGED_ITEMS = ["role", "level", "metrics", "evidence"] as const satisfies readonly RubricItem[];

const mine = (userId: string, id: string) => and(eq(scenes.id, id), eq(scenes.userId, userId));

export async function judgeScene(
  db: Db,
  ai: AiClient,
  userId: string,
  sceneId: string,
  now: Date = new Date(),
): Promise<{ ok: true } | { ok: false; reason: "not_found" | "changed" | "over_limit" | AiFailure }> {
  const scene = await getScene(db, userId, sceneId);
  if (!scene) return { ok: false, reason: "not_found" };
  const head = await loadHead(db, userId, scene.head);
  if (!head) return { ok: false, reason: "not_found" };

  const result = await runAi(
    db,
    ai,
    userId,
    {
      purpose: "judge",
      system: JUDGE_SYSTEM,
      messages: [{ role: "user", text: describeScene(scene, head) }],
      schema: judgementSchema,
      effort: "medium",
      maxTokens: 8000,
    },
    now,
  );
  if (!result.ok) return { ok: false, reason: result.reason };
  const judgement: Judgement = result.value;

  // 항목마다 DB 안에서 바꾼다. 닫았거나 적용하지 않는 항목은 그대로 둔다(그사이 닫았을 수도 있다)
  let rubric = sql`${scenes.rubric}`;
  for (const item of JUDGED_ITEMS) {
    const { status, note } = judgement[item];
    const entry = JSON.stringify({ status, note: status === "unmet" && note.trim() !== "" ? note.trim() : null });
    rubric = sql`jsonb_set(${rubric}, ${`{${item}}`}::text[],
      case when ${scenes.rubric} -> ${item} ->> 'status' in ('closed', 'na')
        then ${scenes.rubric} -> ${item}
        else ${entry}::jsonb end)`;
  }

  const updated = await db
    .update(scenes)
    .set({
      rubric,
      judgedAt: now,
      phraseCandidates: cleanCandidates(judgement.phraseCandidates, scene.bannedPhrases, scene.dismissedPhrases),
    })
    .where(and(mine(userId, sceneId), eq(scenes.contentVersion, scene.contentVersion)))
    .returning({ id: scenes.id });
  return updated.length > 0 ? { ok: true } : { ok: false, reason: "changed" };
}

type PhraseResult = { ok: true } | { ok: false; reason: "not_found" };

// 후보를 금지 목록으로 옮긴다. 사용자가 승인한 것만 금지 표현이 된다
export async function approveScenePhrase(db: Db, userId: string, id: string, phrase: string): Promise<PhraseResult> {
  const scene = await getScene(db, userId, id);
  if (!scene || !scene.phraseCandidates.includes(phrase)) return { ok: false, reason: "not_found" };
  await db
    .update(scenes)
    .set({
      phraseCandidates: scene.phraseCandidates.filter((candidate) => candidate !== phrase),
      bannedPhrases: [...new Set([...scene.bannedPhrases, phrase])],
    })
    .where(mine(userId, id));
  return { ok: true };
}

// 후보를 거절한다. 기억해 두고 다시 제안받지 않는다
export async function dismissScenePhrase(db: Db, userId: string, id: string, phrase: string): Promise<PhraseResult> {
  const scene = await getScene(db, userId, id);
  if (!scene || !scene.phraseCandidates.includes(phrase)) return { ok: false, reason: "not_found" };
  await db
    .update(scenes)
    .set({
      phraseCandidates: scene.phraseCandidates.filter((candidate) => candidate !== phrase),
      dismissedPhrases: [...new Set([...scene.dismissedPhrases, phrase])].slice(-100),
    })
    .where(mine(userId, id));
  return { ok: true };
}

// 증빙이 미달인 장면. 당장 채울 수 없는 증빙은 여기에 할 일로 쌓인다
export async function listSceneEvidenceTodos(
  db: Db,
  userId: string,
): Promise<{ id: string; name: string; note: string | null }[]> {
  const rows = await db
    .select({ id: scenes.id, title: scenes.title, rubric: scenes.rubric })
    .from(scenes)
    .where(and(eq(scenes.userId, userId), sql`${scenes.rubric} -> 'evidence' ->> 'status' = 'unmet'`))
    .orderBy(scenes.createdAt);
  return rows.map((row) => ({ id: row.id, name: row.title, note: row.rubric.evidence.note }));
}
