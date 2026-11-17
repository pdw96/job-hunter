import { z } from "zod";
import type { Db } from "@/db/types";
import { type AiClient, type AiFailure, runAi } from "@/modules/ai/client";
import { REGION_IDS } from "@/modules/tracks/options";
import { isDate } from "./input";
import { CAREER_TYPES, type CareerType, POSTING_EMPLOYMENT_TYPES, type PostingEmploymentType, POSTING_LIMITS } from "./options";
import { POSTING_SYSTEM } from "./prompts";

// 공고 원문에서 값을 뽑는다. 저장하지 않는다. 뽑은 값은 사용자가 화면에서 확인하고 고친 뒤에 저장한다.

const extractSchema = z.object({
  company: z.string(),
  title: z.string(),
  deadline: z.string(),
  isRolling: z.boolean(),
  locationText: z.string(),
  regions: z.array(z.string()),
  careerType: z.enum(CAREER_TYPES),
  minYears: z.number(),
  employmentType: z.enum(POSTING_EMPLOYMENT_TYPES),
});

export type ExtractedPosting = {
  company: string;
  title: string;
  deadline: string | null;
  isRolling: boolean;
  locationText: string | null;
  regions: string[];
  careerType: CareerType;
  minYears: number | null;
  employmentType: PostingEmploymentType;
  // 원문에서 글자 그대로 찾지 못한 값. 화면에서 다시 보라고 알린다
  unverified: ("company" | "title")[];
};

const squash = (text: string) => text.replace(/\s+/g, "").toLowerCase();

export async function extractPosting(
  db: Db,
  ai: AiClient,
  userId: string,
  rawText: string,
  today: string, // YYYY-MM-DD
  now: Date = new Date(),
): Promise<{ ok: true; value: ExtractedPosting } | { ok: false; reason: "over_limit" | AiFailure }> {
  const result = await runAi(
    db,
    ai,
    userId,
    {
      purpose: "posting",
      system: POSTING_SYSTEM,
      messages: [{ role: "user", text: `오늘 날짜: ${today}\n\n[공고 원문]\n${rawText}` }],
      schema: extractSchema,
      effort: "low",
      maxTokens: 2000,
    },
    now,
  );
  if (!result.ok) return { ok: false, reason: result.reason };

  // AI가 준 값도 코드가 검사한다. 목록에 없는 값과 형식이 틀린 값은 버린다
  const raw = result.value;
  const company = raw.company.trim().slice(0, POSTING_LIMITS.shortText);
  const title = raw.title.trim().slice(0, POSTING_LIMITS.shortText);
  const deadline = raw.deadline.trim();
  const years = Number.isInteger(raw.minYears) && raw.minYears >= 0 && raw.minYears <= POSTING_LIMITS.maxYears ? raw.minYears : null;
  const source = squash(rawText);

  return {
    ok: true,
    value: {
      company,
      title,
      deadline: !raw.isRolling && isDate(deadline) ? deadline : null,
      isRolling: raw.isRolling,
      locationText: raw.locationText.trim().slice(0, POSTING_LIMITS.shortText) || null,
      regions: [...new Set(raw.regions)].filter((region) => REGION_IDS.includes(region) && region !== "anywhere"),
      careerType: raw.careerType,
      minYears: years,
      employmentType: raw.employmentType,
      unverified: (["company", "title"] as const).filter(
        (field) => raw[field].trim() !== "" && !source.includes(squash(raw[field])),
      ),
    },
  };
}
