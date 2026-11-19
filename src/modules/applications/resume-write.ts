import { z } from "zod";
import type { Db } from "@/db/types";
import { type AiClient, type AiFailure, runAi } from "@/modules/ai/client";
import { listResumeSources, type ResumeSource } from "@/modules/experiences/writing";
import { getPosting } from "@/modules/postings/repo";
import { editBlock, withEditLock } from "./submission-repo";
import { ownsTrack } from "@/modules/tracks/repo";
import { RESUME_LIMITS } from "./options";
import { RESUME_WRITE_SYSTEM } from "./prompts";
import { cleanLines, buildEntry, detailFor, upsertEntries } from "./resume-entries";
import { getCommonResume, getResume, insertCommonResume, saveResumeContent } from "./resume-repo";
import { describeSource, postingTextOf, requirementsOf } from "./select";
import { resolveAlias } from "./text";
import type { ResumeContent, ResumeDetail } from "./types";

// 확인된 경험으로 이력서 줄을 쓴다. 머리(이름·소속·역할·기간)는 코드가 기록에서 만들고, AI는 줄만 쓴다.
// AI에게는 경험의 실제 id 대신 E1, E2 같은 별명만 보내고, 답의 별명은 코드가 실제 id로 바꾼다.
// 숫자·금지 표현은 저장 뒤 checkResume이 표시한다(저장은 막지 않는다).

const resumeSchema = z.object({ entries: z.array(z.object({ exp: z.string(), lines: z.array(z.string()) })) });

export type LineRequest = { source: ResumeSource; detail: ResumeDetail; emphasize: boolean };
export type ResumePostingContext = { text: string; requirements: string[] };
type RewriteFailure = "not_found" | "not_apply" | "submitted" | "changed" | "none_selected" | "full" | "over_limit" | AiFailure;

const DETAIL_TEXT: Record<ResumeDetail, string> = { full: "자세히(2~4줄)", summary: "요약(1~2줄)" };
const maxLines = (detail: ResumeDetail) => (detail === "full" ? RESUME_LIMITS.fullLines : RESUME_LIMITS.summaryLines);

function buildMessage(requests: LineRequest[], posting: ResumePostingContext | null): string {
  const sections: [string, string][] = [];
  if (posting) {
    sections.push(["공고", posting.text], ["공고 요구 사항", posting.requirements.length > 0 ? posting.requirements.join("\n") : "없음"]);
  }
  const records = requests.map(({ source, detail, emphasize }, i) => {
    const extra = [`- 분량: ${DETAIL_TEXT[detail]}`, ...(emphasize ? ["- 공고에 맞춰 강조: 예"] : [])];
    return [describeSource(`E${i + 1}`, source, true), ...extra].join("\n");
  });
  sections.push(["경험 기록", records.join("\n\n")]);
  return sections.map(([label, value]) => `[${label}]\n${value}`).join("\n\n");
}

// 저장하지 않는다. 프롬프트 점검도 이것을 쓴다. 돌려주는 값은 경험 id → 다듬은 줄
export async function writeResumeLines(
  db: Db,
  ai: AiClient,
  userId: string,
  input: { requests: LineRequest[]; posting: ResumePostingContext | null },
  now: Date = new Date(),
): Promise<{ ok: true; value: Record<string, string[]> } | { ok: false; reason: "over_limit" | AiFailure }> {
  const result = await writeLines(db, ai, userId, input, now);
  return result.ok ? { ok: true, value: result.value } : result;
}

// answered: AI가 답에 적은 경험 id (빠뜨린 경험과 가르려고 쓴다)
export async function writeLines(
  db: Db,
  ai: AiClient,
  userId: string,
  input: { requests: LineRequest[]; posting: ResumePostingContext | null },
  now: Date = new Date(),
): Promise<{ ok: true; value: Record<string, string[]>; answered: Set<string> } | { ok: false; reason: "over_limit" | AiFailure }> {
  if (input.requests.length === 0) return { ok: true, value: {}, answered: new Set() };

  const result = await runAi(
    db,
    ai,
    userId,
    {
      purpose: "resume_write",
      system: RESUME_WRITE_SYSTEM,
      messages: [{ role: "user", text: buildMessage(input.requests, input.posting) }],
      schema: resumeSchema,
      effort: "medium",
      maxTokens: 16000,
    },
    now,
  );
  if (!result.ok) return { ok: false, reason: result.reason };

  // 요청에 없는 별명은 버리고, 같은 별명은 처음 것만 쓴다. 빠뜨린 경험은 빈 줄이다
  const named = input.requests.map((r) => ({ name: r.source.name, request: r }));
  const value: Record<string, string[]> = {};
  let matched = 0;
  const seen = new Set<string>();
  for (const item of result.value.entries) {
    const request = resolveAlias(item.exp, named)?.request;
    if (!request || seen.has(request.source.id)) continue;
    seen.add(request.source.id);
    matched += 1;
    value[request.source.id] = cleanLines(item.lines, maxLines(request.detail));
  }
  if (matched === 0) return { ok: false, reason: "invalid" };
  const answered = new Set(Object.keys(value));
  for (const { source } of input.requests) value[source.id] ??= [];
  return { ok: true, value, answered };
}

// 트랙의 확인된 경험(사용·요약만)으로 공통본을 처음 만든다. 이미 있으면 exists
export async function startCommonResume(
  db: Db,
  ai: AiClient,
  userId: string,
  trackId: string,
  now: Date = new Date(),
): Promise<{ ok: true; id: string } | { ok: false; reason: "not_found" | "exists" | "no_sources" | "over_limit" | AiFailure }> {
  if (!(await ownsTrack(db, userId, trackId))) return { ok: false, reason: "not_found" };
  if (await getCommonResume(db, userId, trackId)) return { ok: false, reason: "exists" };

  const sources = (await listResumeSources(db, userId, trackId)).slice(0, RESUME_LIMITS.entries);
  // 쓸 수 있는 기록이 없으면 AI를 부르지 않는다
  if (sources.length === 0) return { ok: false, reason: "no_sources" };

  const written = await writeResumeLines(
    db,
    ai,
    userId,
    { requests: sources.map((source) => ({ source, detail: detailFor(source.scope), emphasize: false })), posting: null },
    now,
  );
  if (!written.ok) return written;

  const entries = sources.map((s) => buildEntry(s, detailFor(s.scope), false, written.value[s.id] ?? [], now));
  const content = upsertEntries({ entries: [], commonVersion: null }, entries);
  // AI가 쓰는 사이 다른 곳에서 만들었으면 exists
  return insertCommonResume(db, userId, trackId, content);
}

// 고른 항목을 다시 쓰거나, 아직 없는 경험을 새 항목으로 넣는다(공통본·맞춤본 모두).
// 읽었을 때의 version 그대로일 때만 저장한다(그사이 고쳤거나 옮겼으면 changed)
export async function rewriteEntries(
  db: Db,
  ai: AiClient,
  userId: string,
  resumeId: string,
  experienceIds: string[],
  expectedVersion: number,
  now: Date = new Date(),
): Promise<{ ok: true; value: ResumeContent } | { ok: false; reason: RewriteFailure }> {
  const resume = await getResume(db, userId, resumeId);
  if (!resume) return { ok: false, reason: "not_found" };
  const posting = resume.postingId ? await getPosting(db, userId, resume.postingId) : null;
  if (resume.postingId) {
    if (!posting) return { ok: false, reason: "not_found" };
    const block = await editBlock(db, userId, posting);
    if (block) return { ok: false, reason: block };
  }
  const content = resume.content;
  if (!content || resume.version !== expectedVersion) return { ok: false, reason: "changed" };

  // 화면이 보낸 id 중 지금 쓸 수 있는 경험만 받는다
  const listed = await listResumeSources(db, userId, resume.trackId);
  const byId = new Map(listed.map((s) => [s.id, s]));
  const existing = new Map(content.entries.map((e) => [e.experienceId, e]));
  // 있는 항목은 모두 다시 쓸 수 있고, 새 항목은 40개까지 남은 자리만큼만 받는다(목록 순서대로)
  const wanted = new Set(experienceIds.filter((id) => byId.has(id)));
  const room = Math.max(0, RESUME_LIMITS.entries - content.entries.length);
  const fresh = listed.filter((s) => wanted.has(s.id) && !existing.has(s.id));
  const sources = [...listed.filter((s) => wanted.has(s.id) && existing.has(s.id)), ...fresh.slice(0, room)];
  if (sources.length === 0) return { ok: false, reason: fresh.length > 0 ? "full" : "none_selected" };

  const requests: LineRequest[] = sources.map((source) => {
    const entry = existing.get(source.id);
    // 공통본은 지금의 범위로, 맞춤본의 있는 항목은 그 항목의 분량으로 쓴다
    const detail = entry && resume.postingId ? entry.detail : detailFor(source.scope);
    return { source, detail, emphasize: entry?.emphasized ?? false };
  });
  const context: ResumePostingContext | null =
    posting && requests.some((r) => r.emphasize)
      ? { text: postingTextOf(posting), requirements: requirementsOf(posting) }
      : null;

  const written = await writeLines(db, ai, userId, { requests, posting: context }, now);
  if (!written.ok) return { ok: false, reason: written.reason };

  // AI가 답에서 뺀 기존 항목은 그대로 둔다(줄을 비우지 않는다). 새 항목은 빈 줄로 넣는다
  const entries = requests
    .filter((r) => written.answered.has(r.source.id) || !existing.has(r.source.id))
    .map((r) => buildEntry(r.source, r.detail, r.emphasize, written.value[r.source.id] ?? [], now));
  const next = upsertEntries(content, entries);
  // 맞춤본은 제출 확인과 저장을 공고 잠금 안에서 한다. 공통본은 잠금 없이 저장한다
  const save = (tx: Db) => saveResumeContent(tx, userId, resumeId, next, expectedVersion);
  const saved = posting ? await withEditLock(db, userId, posting.id, save) : await save(db);
  return saved.ok ? { ok: true, value: next } : saved;
}
