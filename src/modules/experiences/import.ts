import { z } from "zod";
import type { Db } from "@/db/types";
import { type AiClient, type AiFailure, runAi } from "@/modules/ai/client";
import { findClaims, type FoundClaim, mergeClaims } from "./claims";
import { insertClaims } from "./claims-repo";
import { numbersIn, ungroundedNumbers } from "./grounding";
import { type ExperienceInput, validateExperience } from "./input";
import { draftSchema } from "./interview";
import { IMPORT_SYSTEM } from "./prompts";
import { createExperience } from "./repo";

// 가져오기. 글을 AI가 경험 단위로 쪼개고, 코드가 검사한 뒤 미확인 기록과 주장으로 저장한다.
// 가져온 글은 AI가 쓴 것일 수 있으므로 내용을 사실로 취급하지 않는다.

const MAX_RECORDS = 12;

const importSchema = z.object({
  records: z.array(draftSchema.extend({ roleClaims: z.array(z.string()) })),
  more: z.boolean(), // 경험이 더 있는데 다 담지 못했는가
});

type Prepared = { input: ExperienceInput; claims: (FoundClaim & { status: "pending" | "needs_fix" })[] };

// AI에게 글을 나누게 하고, 코드로 검사해 저장할 준비를 한다. 저장하지 않는다(프롬프트 점검에서도 쓴다)
export async function requestImport(
  db: Db,
  ai: AiClient,
  userId: string,
  sourceText: string,
  now: Date = new Date(),
): Promise<
  | { ok: true; records: Prepared[]; skipped: number; more: boolean }
  | { ok: false; reason: "over_limit" | "nothing_found" | AiFailure }
> {
  const result = await runAi(
    db,
    ai,
    userId,
    {
      purpose: "import",
      system: IMPORT_SYSTEM,
      messages: [{ role: "user", text: `[가져올 글]\n${sourceText}` }],
      schema: importSchema,
      effort: "medium",
      maxTokens: 16000,
    },
    now,
  );
  if (!result.ok) return { ok: false, reason: result.reason };
  if (result.value.records.length === 0) return { ok: false, reason: "nothing_found" };

  const records: Prepared[] = [];
  let skipped = 0;
  for (const { roleClaims, ...draft } of result.value.records.slice(0, MAX_RECORDS)) {
    // AI가 준 초안도 사람이 입력한 것과 같은 검사를 거친다. 금지 표현은 사용자가 정하므로 비워 둔다
    const checked = validateExperience({ ...draft, bannedPhrases: [] });
    if (!checked.ok) {
      skipped += 1;
      continue;
    }
    const input = checked.value;
    // 원본에 없던 숫자가 든 구절은 처음부터 고쳐야 할 것으로 둔다
    const invented = new Set(Object.values(ungroundedNumbers(input, [sourceText])).flat());
    const claims = mergeClaims(findClaims(input), roleClaims, input).map((claim) => ({
      ...claim,
      status: numbersIn(claim.quote).some((number) => invented.has(number))
        ? ("needs_fix" as const)
        : ("pending" as const),
    }));
    records.push({ input, claims });
  }
  return { ok: true, records, skipped, more: result.value.more || result.value.records.length > MAX_RECORDS };
}

export type ImportResult =
  | { ok: true; created: { id: string; name: string; claimCount: number }[]; skipped: number; more: boolean }
  | { ok: false; reason: "over_limit" | "nothing_found" | AiFailure };

// 글을 경험 기록으로 가져온다. 기록은 모두 미확인으로, 주장과 함께 저장한다
export async function importExperiences(
  db: Db,
  ai: AiClient,
  userId: string,
  sourceText: string,
  now: Date = new Date(),
): Promise<ImportResult> {
  const prepared = await requestImport(db, ai, userId, sourceText, now);
  if (!prepared.ok) return prepared;

  const created: { id: string; name: string; claimCount: number }[] = [];
  for (const { input, claims } of prepared.records) {
    const id = await db.transaction(async (tx) => {
      const experienceId = await createExperience(tx, userId, input, "import");
      await insertClaims(tx, experienceId, claims);
      return experienceId;
    });
    created.push({ id, name: input.name, claimCount: claims.length });
  }
  return { ok: true, created, skipped: prepared.skipped, more: prepared.more };
}
