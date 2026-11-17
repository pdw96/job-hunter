import { z } from "zod";
import type { Db } from "@/db/types";
import { type AiClient, type AiFailure, type AiImage, IMAGE_TYPES, runAi } from "@/modules/ai/client";
import { POSTING_LIMITS } from "./options";
import { IMAGE_SYSTEM } from "./prompts";

// 그림으로 된 공고를 글로 옮긴다. 옮긴 글은 붙여 넣은 공고 원문과 똑같이 다룬다.

export const MAX_TILES = 10;
export const MAX_TILE_BASE64 = 1_400_000; // 조각 하나(약 1MB)
export const MAX_TOTAL_BASE64 = 4_000_000; // 한 번에 보내는 전체(요청 크기 한도 안쪽)

const imageSchema = z.object({ text: z.string() });

export function validateTiles(raw: unknown): { ok: true; value: AiImage[] } | { ok: false; reason: "invalid" | "too_many" | "too_large" } {
  if (!Array.isArray(raw) || raw.length === 0) return { ok: false, reason: "invalid" };
  if (raw.length > MAX_TILES) return { ok: false, reason: "too_many" };
  const tiles: AiImage[] = [];
  let total = 0;
  for (const item of raw as { mediaType?: unknown; data?: unknown }[]) {
    const mediaType = IMAGE_TYPES.find((type) => type === item?.mediaType);
    if (!mediaType || typeof item.data !== "string" || !/^[A-Za-z0-9+/]+=*$/.test(item.data)) return { ok: false, reason: "invalid" };
    if (item.data.length > MAX_TILE_BASE64) return { ok: false, reason: "too_large" };
    total += item.data.length;
    tiles.push({ mediaType, data: item.data });
  }
  if (total > MAX_TOTAL_BASE64) return { ok: false, reason: "too_large" };
  return { ok: true, value: tiles };
}

export async function transcribePosting(
  db: Db,
  ai: AiClient,
  userId: string,
  tiles: AiImage[],
  now: Date = new Date(),
): Promise<{ ok: true; text: string } | { ok: false; reason: "over_limit" | "no_text" | AiFailure }> {
  const result = await runAi(
    db,
    ai,
    userId,
    {
      purpose: "posting_image",
      system: IMAGE_SYSTEM,
      messages: [
        {
          role: "user",
          text: `그림 ${tiles.length}장입니다. 긴 공고 한 장을 위에서 아래로 잘라 순서대로 보낸 것일 수 있습니다.`,
          images: tiles,
        },
      ],
      schema: imageSchema,
      effort: "low",
      maxTokens: 12000,
    },
    now,
  );
  if (!result.ok) return { ok: false, reason: result.reason };
  const text = result.value.text.trim().slice(0, POSTING_LIMITS.rawText);
  // 글자가 거의 없으면 공고가 아닌 그림이다
  if (text.length < 30) return { ok: false, reason: "no_text" };
  return { ok: true, text };
}
