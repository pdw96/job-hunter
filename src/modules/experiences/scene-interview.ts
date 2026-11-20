import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db/types";
import { type AiClient, type AiFailure, runAi } from "@/modules/ai/client";
import { listTracks } from "@/modules/tracks/repo";
import { ungroundedSceneNumbers } from "./grounding";
import { isMonth } from "./input";
import { type AnswerResult, appendAnswer, firstQuestion, getInterview, type Interview, isSceneInterview } from "./interview";
import { LIMITS, RUBRIC_ITEM_LABELS, RUBRIC_ITEMS } from "./options";
import { describeScene, SCENE_EXTRACT_SYSTEM, SCENE_INTERVIEW_CONTEXT } from "./prompts";
import { listRecordClaims } from "./record-claims-repo";
import { type SceneInput, validateScene } from "./record-input";
import type { HeadRef } from "./record-options";
import { loadHead, lockHead, type SceneHead } from "./scene-head";
import { getScene, type Scene } from "./scenes-repo";
import { type InterviewMessage, interviews, scenes } from "./schema";

// 장면 인터뷰. 머리(경력·프로젝트·활동)가 정해진 뒤에 그 안의 장면 하나를 묻는다.
// 질문은 옛 인터뷰와 같은 시스템 프롬프트를 쓰고, 머리 정보는 대화 맨 앞의 배경 글로 준다.
// 정리한 초안은 저장하지 않고 돌려준다. 사용자가 장면 폼에서 확인하고 저장하며, 저장된 장면은 미확인이다.

// 빈 칸은 빈 문자열로 받는다. 머리와 금지 표현은 AI가 정하지 않는다
export const sceneDraftSchema = z.object({
  title: z.string(),
  startMonth: z.string(),
  endMonth: z.string(),
  isOngoing: z.boolean(),
  situation: z.string(),
  judgment: z.string(),
  actions: z.string(),
  result: z.string(),
  lessons: z.string(),
  metrics: z.array(z.object({ text: z.string(), basis: z.string() })),
  notDone: z.string(),
  evidenceNote: z.string(),
  tags: z.array(z.string()),
});
export type SceneDraft = z.infer<typeof sceneDraftSchema>;

export type SceneDraftWarnings = Partial<Record<keyof SceneInput, string>>;

const LONG_FIELDS = ["situation", "judgment", "actions", "result", "lessons", "notDone", "evidenceNote"] as const;

// AI가 한도를 넘겨 적은 초안을 버리지 않고 한도에 맞춘다. 잘못된 월은 비운다(사용자가 폼에서 채운다)
export function fitScene(draft: SceneDraft): { draft: SceneDraft; trimmed: boolean } {
  const fitted = { ...draft };
  let trimmed = false;
  fitted.title = fitted.title.trim().slice(0, LIMITS.shortText);
  for (const field of LONG_FIELDS) {
    if (fitted[field].length > LIMITS.longText) {
      fitted[field] = fitted[field].slice(0, LIMITS.longText);
      trimmed = true;
    }
  }
  if (fitted.metrics.length > LIMITS.metrics) trimmed = true;
  fitted.metrics = fitted.metrics.slice(0, LIMITS.metrics).map((metric) => ({
    text: metric.text.slice(0, LIMITS.longText),
    basis: metric.basis.slice(0, LIMITS.longText),
  }));
  fitted.tags = [...new Set(fitted.tags.map((tag) => tag.trim()))]
    .filter((tag) => tag !== "" && tag.length <= LIMITS.tagLength)
    .slice(0, LIMITS.tags);
  if (!isMonth(fitted.startMonth.trim())) fitted.startMonth = "";
  if (fitted.isOngoing || !isMonth(fitted.endMonth.trim()) || (fitted.startMonth !== "" && fitted.endMonth < fitted.startMonth)) {
    fitted.endMonth = "";
  }
  return { draft: fitted, trimmed };
}

// 머리를 AI에게 보여 줄 글. 연락처는 머리에 없다
export function describeHead(head: SceneHead): string {
  const lines = head.labels.filter(([, value]) => value).map(([label, value]) => `${label}: ${value}`);
  const { startMonth, endMonth, isOngoing } = head.period;
  if (startMonth) lines.push(`기간: ${startMonth} ~ ${isOngoing ? "진행 중" : (endMonth ?? "없음")}`);
  return lines.join("\n");
}

async function buildSceneContext(db: Db, userId: string, head: SceneHead, scene: Scene | null, trackId: string | null): Promise<string> {
  const parts = ["[인터뷰 배경]"];
  if (trackId) {
    const track = (await listTracks(db, userId)).find((item) => item.id === trackId);
    if (track) parts.push(`지원 직무: ${track.jobNames.join(", ")}`);
  }
  parts.push(`[장면이 속한 곳]\n${describeHead(head)}`);
  if (scene) {
    const unmet = RUBRIC_ITEMS.filter((item) => scene.rubric[item].status === "unmet").map(
      (item) => `- ${RUBRIC_ITEM_LABELS[item]}: ${scene.rubric[item].note ?? "보완이 필요합니다"}`,
    );
    const toFix = (await listRecordClaims(db, userId, { kind: "scene", id: scene.id })).filter((claim) => claim.status === "needs_fix");
    if (toFix.length > 0) {
      parts.push(
        `[지원자가 사실과 다르다고 표시한 구절]\n${toFix.map((claim) => `- ${claim.quote}`).join("\n")}\n이 구절들은 실제보다 부풀려졌거나 틀린 내용입니다. 실제로는 어땠는지(직접 한 범위, 실제 수치나 기간) 하나씩 물어봅니다. 지원자가 모른다고 하면 그 내용은 빼는 것으로 정리합니다.`,
      );
    }
    parts.push(
      "이미 있는 장면을 보완하는 인터뷰입니다. 속한 곳의 정보는 묻지 않습니다.",
      `[기존 장면]\n${describeScene(scene, head)}`,
      unmet.length > 0 ? `[미달 항목과 보완 방안]\n${unmet.join("\n")}` : "[미달 항목 없음. 더 구체적으로 만들 부분을 물어봅니다]",
    );
  } else {
    parts.push(SCENE_INTERVIEW_CONTEXT);
  }
  parts.push("첫 질문을 해 주세요.");
  return parts.join("\n\n");
}

// 인터뷰가 가리키는 머리와(보완이면) 장면. 머리가 지워졌으면 head가 null
async function targetOf(db: Db, userId: string, interview: Interview): Promise<{ head: SceneHead | null; scene: Scene | null } | null> {
  if (interview.sceneId) {
    const scene = await getScene(db, userId, interview.sceneId);
    if (!scene) return null;
    return { head: await loadHead(db, userId, scene.head), scene };
  }
  if (interview.head) return { head: await loadHead(db, userId, interview.head), scene: null };
  return null;
}

export async function startSceneInterview(
  db: Db,
  ai: AiClient,
  userId: string,
  options: { head?: HeadRef; sceneId?: string; trackId?: string },
  now: Date = new Date(),
): Promise<{ ok: true; id: string; message: string } | { ok: false; reason: "not_found" | "over_limit" | AiFailure }> {
  const sceneId = typeof options.sceneId === "string" && options.sceneId !== "" ? options.sceneId : null;
  const trackId = typeof options.trackId === "string" && options.trackId !== "" ? options.trackId : null;
  // 머리가 정해져야 시작한다. 머리·장면·트랙은 본인 것이어야 한다
  const scene = sceneId ? await getScene(db, userId, sceneId) : null;
  if (sceneId && !scene) return { ok: false, reason: "not_found" };
  const ref = scene ? scene.head : (options.head ?? null);
  const head = ref ? await loadHead(db, userId, ref) : null;
  if (!head) return { ok: false, reason: "not_found" };
  if (trackId && !(await listTracks(db, userId)).some((track) => track.id === trackId)) return { ok: false, reason: "not_found" };

  const result = await firstQuestion(db, ai, userId, await buildSceneContext(db, userId, head, scene, trackId), now);
  if (!result.ok) return result;

  // AI를 기다리는 사이 머리·사례가 지워졌을 수 있다(다시 옮기기). 잠그고 다시 본 뒤 넣는다(headId는 외래 키가 없다)
  const id = randomUUID();
  const saved = await db.transaction(async (tx) => {
    if (!(await lockHead(tx, userId, head.ref))) return false;
    if (scene) {
      const rows = await tx.select({ id: scenes.id }).from(scenes).where(and(eq(scenes.id, scene.id), eq(scenes.userId, userId))).for("update");
      if (rows.length === 0) return false;
    }
    await tx.insert(interviews).values({
      id,
      userId,
      sceneId: scene?.id ?? null,
      headKind: scene ? null : head.ref.kind,
      headId: scene ? null : head.ref.id,
      trackId,
      messages: [{ role: "assistant", text: result.message }],
    });
    return true;
  });
  if (!saved) return { ok: false, reason: "not_found" };
  return { ok: true, id, message: result.message };
}

export async function answerSceneInterview(
  db: Db,
  ai: AiClient,
  userId: string,
  interviewId: string,
  text: string,
  now: Date = new Date(),
): Promise<AnswerResult | { ok: false; reason: "no_head" }> {
  const interview = await getInterview(db, userId, interviewId);
  if (!interview || !isSceneInterview(interview)) return { ok: false, reason: "not_found" };
  const target = await targetOf(db, userId, interview);
  if (!target) return { ok: false, reason: "not_found" };
  const { head, scene } = target;
  if (!head) return { ok: false, reason: "no_head" };
  return appendAnswer(db, ai, userId, interview, text, () => buildSceneContext(db, userId, head, scene, interview.trackId), now);
}

type DraftResult =
  | { ok: true; draft: SceneInput; warnings: SceneDraftWarnings }
  | { ok: false; reason: "over_limit" | AiFailure };

// 대화(와 보완이면 기존 장면)를 장면 초안으로 바꾸고, 코드로 한 번 더 검사한다(프롬프트 점검에서도 쓴다)
export async function requestSceneDraft(
  db: Db,
  ai: AiClient,
  userId: string,
  messages: InterviewMessage[],
  head: SceneHead,
  scene: Scene | null,
  now: Date = new Date(),
): Promise<DraftResult> {
  const answers = messages.filter((message) => message.role === "user").map((message) => message.text);
  const transcript = messages.map((message) => `${message.role === "user" ? "지원자" : "질문"}: ${message.text}`).join("\n");
  const request = [
    `[장면이 속한 곳]\n${describeHead(head)}`,
    scene ? `[기존 장면]\n${describeScene(scene, head)}` : null,
    `[인터뷰 대화]\n${transcript}`,
    "위 대화를 장면 하나로 정리해 주세요.",
  ]
    .filter(Boolean)
    .join("\n\n");

  const result = await runAi(
    db,
    ai,
    userId,
    {
      purpose: "extract_scene",
      system: SCENE_EXTRACT_SYSTEM,
      messages: [{ role: "user", text: request }],
      schema: sceneDraftSchema,
      effort: "medium",
      maxTokens: 16000,
    },
    now,
  );
  if (!result.ok) return { ok: false, reason: result.reason };

  // AI가 준 초안도 사람이 입력한 것과 같은 검사를 거친다. 금지 표현은 AI가 정하지 않으므로 기존 것을 유지한다
  const { draft } = fitScene(result.value);
  const checked = validateScene({ ...draft, head: head.ref, bannedPhrases: scene?.bannedPhrases ?? [] });
  if (!checked.ok) return { ok: false, reason: "invalid" };

  // 사용자가 쓴 글(답, 머리, 보완이면 기존 장면)에 없던 숫자를 찾는다
  const sources = [...answers, describeHead(head), ...(scene ? [describeScene(scene, head)] : [])];
  const warnings: SceneDraftWarnings = {};
  for (const [field, numbers] of Object.entries(ungroundedSceneNumbers(checked.value, sources))) {
    warnings[field as keyof SceneInput] = `대화에 없던 숫자가 있습니다: ${numbers.join(", ")}`;
  }
  return { ok: true, draft: checked.value, warnings };
}

// 인터뷰의 대화를 장면 초안으로 정리한다. 저장하지 않는다
export async function draftSceneFromInterview(
  db: Db,
  ai: AiClient,
  userId: string,
  interviewId: string,
  now: Date = new Date(),
): Promise<
  | { ok: true; draft: SceneInput; warnings: SceneDraftWarnings; sceneId: string | null }
  | { ok: false; reason: "not_found" | "empty" | "no_head" | "over_limit" | AiFailure }
> {
  const interview = await getInterview(db, userId, interviewId);
  if (!interview || !isSceneInterview(interview)) return { ok: false, reason: "not_found" };
  if (!interview.messages.some((message) => message.role === "user")) return { ok: false, reason: "empty" };
  const target = await targetOf(db, userId, interview);
  if (!target) return { ok: false, reason: "not_found" };
  if (!target.head) return { ok: false, reason: "no_head" };
  const result = await requestSceneDraft(db, ai, userId, interview.messages, target.head, target.scene, now);
  return result.ok ? { ...result, sceneId: target.scene?.id ?? null } : result;
}
