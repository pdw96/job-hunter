import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db/types";
import { type AiClient, type AiFailure, runAi } from "@/modules/ai/client";
import { listTracks } from "@/modules/tracks/repo";
import { listClaims } from "./claims-repo";
import { ungroundedNumbers } from "./grounding";
import { type ExperienceInput, validateExperience } from "./input";
import { KINDS, LIMITS, RUBRIC_ITEM_LABELS, RUBRIC_ITEMS } from "./options";
import { describeExperience, EXTRACT_SYSTEM, INTERVIEW_SYSTEM } from "./prompts";
import { type Experience, getExperience } from "./repo";
import { type InterviewMessage, interviews } from "./schema";

// AI 인터뷰. AI가 질문하고, 사용자의 답을 기록 초안으로 정리한다.
// 초안은 저장하지 않고 돌려준다. 사용자가 입력 화면에서 확인하고 고친 뒤 저장하며, 저장된 기록은 미확인이다.

const MAX_USER_TURNS = 30;

const turnSchema = z.object({ message: z.string(), enough: z.boolean() });

// 빈 칸은 빈 문자열로 받는다
export const draftSchema = z.object({
  name: z.string(),
  kind: z.enum(KINDS),
  organization: z.string(),
  role: z.string(),
  startMonth: z.string(),
  endMonth: z.string(),
  isOngoing: z.boolean(),
  situation: z.string(),
  actions: z.string(),
  result: z.string(),
  metrics: z.array(z.object({ text: z.string(), basis: z.string() })),
  notDone: z.string(),
  evidenceNote: z.string(),
  tags: z.array(z.string()),
});

export type Interview = {
  id: string;
  experienceId: string | null;
  trackId: string | null;
  messages: InterviewMessage[];
  status: "active" | "done";
};

type Common = "not_found" | "over_limit" | AiFailure;

const mine = (userId: string, id: string) => and(eq(interviews.id, id), eq(interviews.userId, userId));

export async function getInterview(db: Db, userId: string, id: string): Promise<Interview | null> {
  const [row] = await db.select().from(interviews).where(mine(userId, id)).limit(1);
  if (!row) return null;
  return {
    id: row.id,
    experienceId: row.experienceId,
    trackId: row.trackId,
    messages: row.messages,
    status: row.status,
  };
}

// AI에게 주는 배경. 대화 맨 앞에 사용자 글로 붙인다(시스템 프롬프트는 캐시를 위해 고정해 둔다)
async function buildContext(
  db: Db,
  userId: string,
  experience: Experience | null,
  trackId: string | null,
): Promise<string> {
  const parts = ["[인터뷰 배경]"];
  if (trackId) {
    const track = (await listTracks(db, userId)).find((item) => item.id === trackId);
    if (track) parts.push(`지원 직무: ${track.jobNames.join(", ")}`);
  }
  if (experience) {
    const unmet = RUBRIC_ITEMS.filter((item) => experience.rubric[item].status === "unmet").map(
      (item) => `- ${RUBRIC_ITEM_LABELS[item]}: ${experience.rubric[item].note ?? "보완이 필요합니다"}`,
    );
    // 가져온 기록에서 지원자가 과장이거나 틀렸다고 표시한 구절. 실제가 어땠는지 물어야 한다
    const toFix = (await listClaims(db, userId, experience.id)).filter((claim) => claim.status === "needs_fix");
    if (toFix.length > 0) {
      parts.push(
        `[지원자가 사실과 다르다고 표시한 구절]\n${toFix.map((claim) => `- ${claim.quote}`).join("\n")}\n이 구절들은 실제보다 부풀려졌거나 틀린 내용입니다. 실제로는 어땠는지(직접 한 범위, 실제 수치나 기간) 하나씩 물어봅니다. 지원자가 모른다고 하면 그 내용은 빼는 것으로 정리합니다.`,
      );
    }
    parts.push(
      "이미 있는 기록을 보완하는 인터뷰입니다.",
      `[기존 기록]\n${describeExperience(experience)}`,
      unmet.length > 0 ? `[미달 항목과 보완 방안]\n${unmet.join("\n")}` : "[미달 항목 없음. 더 구체적으로 만들 부분을 물어봅니다]",
    );
  } else {
    parts.push("새 경험을 기록하는 인터뷰입니다.");
  }
  parts.push("첫 질문을 해 주세요.");
  return parts.join("\n\n");
}

async function loadExperience(db: Db, userId: string, experienceId: string | null) {
  return experienceId ? getExperience(db, userId, experienceId) : null;
}

export async function startInterview(
  db: Db,
  ai: AiClient,
  userId: string,
  options: { experienceId?: string; trackId?: string },
  now: Date = new Date(),
): Promise<{ ok: true; id: string; message: string } | { ok: false; reason: Common }> {
  const experienceId = options.experienceId ?? null;
  const trackId = options.trackId ?? null;
  // 기록과 트랙은 본인 것이어야 한다
  const experience = await loadExperience(db, userId, experienceId);
  if (experienceId && !experience) return { ok: false, reason: "not_found" };
  if (trackId && !(await listTracks(db, userId)).some((track) => track.id === trackId)) {
    return { ok: false, reason: "not_found" };
  }

  const result = await runAi(
    db,
    ai,
    userId,
    {
      purpose: "interview",
      system: INTERVIEW_SYSTEM,
      messages: [{ role: "user", text: await buildContext(db, userId, experience, trackId) }],
      schema: turnSchema,
      effort: "low",
      maxTokens: 4000,
    },
    now,
  );
  if (!result.ok) return { ok: false, reason: result.reason };

  const id = randomUUID();
  await db.insert(interviews).values({
    id,
    userId,
    experienceId,
    trackId,
    messages: [{ role: "assistant", text: result.value.message }],
  });
  return { ok: true, id, message: result.value.message };
}

export async function answerInterview(
  db: Db,
  ai: AiClient,
  userId: string,
  interviewId: string,
  text: string,
  now: Date = new Date(),
): Promise<
  | { ok: true; message: string; suggestFinish: boolean }
  | { ok: false; reason: Common | "finished" | "too_long" | "invalid_text" | "busy" }
> {
  const interview = await getInterview(db, userId, interviewId);
  if (!interview) return { ok: false, reason: "not_found" };
  if (interview.status === "done") return { ok: false, reason: "finished" };
  const answer = text.trim();
  if (answer === "" || answer.length > LIMITS.longText) return { ok: false, reason: "invalid_text" };
  if (interview.messages.filter((message) => message.role === "user").length >= MAX_USER_TURNS) {
    return { ok: false, reason: "too_long" };
  }

  const experience = await loadExperience(db, userId, interview.experienceId);
  const history: InterviewMessage[] = [...interview.messages, { role: "user", text: answer }];
  const result = await runAi(
    db,
    ai,
    userId,
    {
      purpose: "interview",
      system: INTERVIEW_SYSTEM,
      messages: [
        { role: "user", text: await buildContext(db, userId, experience, interview.trackId) },
        ...history,
      ],
      schema: turnSchema,
      effort: "low",
      maxTokens: 4000,
    },
    now,
  );
  if (!result.ok) return { ok: false, reason: result.reason };

  // 읽었을 때의 대화 길이 그대로일 때만 덧붙인다(같은 답이 두 번 들어가는 것을 막는다)
  const updated = await db
    .update(interviews)
    .set({ messages: [...history, { role: "assistant", text: result.value.message }], updatedAt: now })
    .where(
      and(
        mine(userId, interviewId),
        eq(interviews.status, "active"),
        sql`jsonb_array_length(${interviews.messages}) = ${interview.messages.length}`,
      ),
    )
    .returning({ id: interviews.id });
  if (updated.length === 0) return { ok: false, reason: "busy" };
  return { ok: true, message: result.value.message, suggestFinish: result.value.enough };
}

export type DraftWarnings = Partial<Record<keyof ExperienceInput, string>>;

type DraftResult =
  | { ok: true; draft: ExperienceInput; warnings: DraftWarnings }
  | { ok: false; reason: "over_limit" | AiFailure };

// 대화(와 보완이면 기존 기록)를 기록 초안으로 바꾸고, 코드로 한 번 더 검사한다
export async function requestDraft(
  db: Db,
  ai: AiClient,
  userId: string,
  messages: InterviewMessage[],
  experience: Experience | null,
  now: Date = new Date(),
): Promise<DraftResult> {
  const answers = messages.filter((message) => message.role === "user").map((message) => message.text);
  const transcript = messages
    .map((message) => `${message.role === "user" ? "지원자" : "질문"}: ${message.text}`)
    .join("\n");
  const request = [
    experience ? `[기존 기록]\n${describeExperience(experience)}` : null,
    `[인터뷰 대화]\n${transcript}`,
    "위 대화를 경험 기록 한 건으로 정리해 주세요.",
  ]
    .filter(Boolean)
    .join("\n\n");

  const result = await runAi(
    db,
    ai,
    userId,
    {
      purpose: "extract",
      system: EXTRACT_SYSTEM,
      messages: [{ role: "user", text: request }],
      schema: draftSchema,
      effort: "medium",
      maxTokens: 16000,
    },
    now,
  );
  if (!result.ok) return { ok: false, reason: result.reason };

  // AI가 준 초안도 사람이 입력한 것과 같은 검사를 거친다. 금지 표현은 AI가 정하지 않으므로 기존 것을 유지한다
  const checked = validateExperience({ ...result.value, bannedPhrases: experience?.bannedPhrases ?? [] });
  if (!checked.ok) return { ok: false, reason: "invalid" };

  // 사용자가 쓴 글(답, 보완이면 기존 기록)에 없던 숫자를 찾는다
  const sources = [...answers, ...(experience ? [describeExperience(experience)] : [])];
  const warnings: DraftWarnings = {};
  for (const [field, numbers] of Object.entries(ungroundedNumbers(checked.value, sources))) {
    warnings[field as keyof ExperienceInput] = `대화에 없던 숫자가 있습니다: ${numbers.join(", ")}`;
  }
  return { ok: true, draft: checked.value, warnings };
}

// 인터뷰의 대화를 기록 초안으로 정리한다. 저장하지 않는다
export async function draftFromInterview(
  db: Db,
  ai: AiClient,
  userId: string,
  interviewId: string,
  now: Date = new Date(),
): Promise<
  | { ok: true; draft: ExperienceInput; warnings: DraftWarnings; experienceId: string | null }
  | { ok: false; reason: Common | "empty" }
> {
  const interview = await getInterview(db, userId, interviewId);
  if (!interview) return { ok: false, reason: "not_found" };
  if (!interview.messages.some((message) => message.role === "user")) return { ok: false, reason: "empty" };

  const experience = await loadExperience(db, userId, interview.experienceId);
  const result = await requestDraft(db, ai, userId, interview.messages, experience, now);
  return result.ok ? { ...result, experienceId: interview.experienceId } : result;
}

export async function finishInterview(
  db: Db,
  userId: string,
  interviewId: string,
): Promise<{ ok: true } | { ok: false; reason: "not_found" }> {
  const updated = await db
    .update(interviews)
    .set({ status: "done", updatedAt: new Date() })
    .where(mine(userId, interviewId))
    .returning({ id: interviews.id });
  return updated.length > 0 ? { ok: true } : { ok: false, reason: "not_found" };
}
