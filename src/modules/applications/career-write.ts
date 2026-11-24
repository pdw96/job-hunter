import { z } from "zod";
import type { Db } from "@/db/types";
import { type AiClient, type AiFailure, runAi } from "@/modules/ai/client";
import { type CareerItemSource, listCareerSources } from "@/modules/experiences/sources";
import { getPosting } from "@/modules/postings/repo";
import { ownsTrack } from "@/modules/tracks/repo";
import { buildCompany, buildItem, itemCount, lineCaps, refreshCompany, upsertItems } from "./career-entries";
import { getCareer, getCommonCareer, insertCommonCareer, saveCareerContent } from "./career-repo";
import { CAREER_LIMITS } from "./options";
import { CAREER_WRITE_SYSTEM } from "./prompts";
import { cleanLines, detailFor } from "./resume-entries";
import type { ResumePostingContext } from "./resume-write";
import { describeSource, postingTextOf, requirementsOf } from "./select";
import { editBlock, withEditLock } from "./submission-repo";
import { resolveAlias } from "./text";
import type { CareerContent, CareerItem, ResumeDetail } from "./types";

// 확인된 경력 기록으로 경력기술서 항목의 한 일·성과 줄을 쓴다. 회사 머리와 항목 머리는 코드가 기록에서 만들고, AI는 줄만 쓴다.
// AI에게는 항목의 실제 id 대신 E1, E2 같은 별명만 보내고, 답의 별명은 코드가 실제 id로 바꾼다.
// 숫자·금지 표현은 저장 뒤 checkCareer가 표시한다(저장은 막지 않는다).

const careerSchema = z.object({
  items: z.array(z.object({ exp: z.string(), done: z.array(z.string()), results: z.array(z.string()) })),
});

export type CareerRequest = { companyId: string; item: CareerItemSource; detail: ResumeDetail; emphasize: boolean };
export type CareerLines = { done: string[]; results: string[] };
type RewriteFailure = "not_found" | "not_apply" | "submitted" | "changed" | "none_selected" | "full" | "over_limit" | AiFailure;

const DETAIL_TEXT: Record<ResumeDetail, string> = {
  full: "자세히(한 일 2~4줄, 성과 0~3줄)",
  summary: "요약(한 일 1~2줄, 성과 0~1줄)",
};

function buildMessage(requests: CareerRequest[], posting: ResumePostingContext | null): string {
  const sections: [string, string][] = [];
  if (posting) {
    sections.push(["공고", posting.text], ["공고 요구 사항", posting.requirements.length > 0 ? posting.requirements.join("\n") : "없음"]);
  }
  const records = requests.map(({ item, detail, emphasize }, i) => {
    const extra = [`- 분량: ${DETAIL_TEXT[detail]}`, ...(emphasize ? ["- 공고에 맞춰 강조: 예"] : [])];
    return [describeSource(`E${i + 1}`, item, true), ...extra].join("\n");
  });
  sections.push(["경력기술서 항목", records.join("\n\n")]);
  return sections.map(([label, value]) => `[${label}]\n${value}`).join("\n\n");
}

// 저장하지 않는다. 프롬프트 점검도 이것을 쓴다. 돌려주는 값은 항목 id → 다듬은 줄(빠뜨린 항목은 빈 줄).
// answered: AI가 답에 적은 항목 id (빠뜨린 항목과 가르려고 쓴다). 요청이 없으면 AI를 부르지 않는다
export async function writeCareerItems(
  db: Db,
  ai: AiClient,
  userId: string,
  input: { requests: CareerRequest[]; posting: ResumePostingContext | null },
  now: Date = new Date(),
  onRaw?: (raw: unknown) => void,
): Promise<{ ok: true; value: Record<string, CareerLines>; answered: Set<string> } | { ok: false; reason: "over_limit" | AiFailure }> {
  const { requests } = input;
  if (requests.length === 0) return { ok: true, value: {}, answered: new Set() };

  const result = await runAi(
    db,
    ai,
    userId,
    {
      purpose: "career_write",
      system: CAREER_WRITE_SYSTEM,
      messages: [{ role: "user", text: buildMessage(requests, input.posting) }],
      schema: careerSchema,
      effort: "medium",
      maxTokens: 16000,
    },
    now,
  );
  if (!result.ok) return { ok: false, reason: result.reason };
  onRaw?.(result.value); // 프롬프트 점검이 AI가 보낸 원래 답을 보이려고 쓴다

  // 요청에 없는 별명은 버리고, 같은 별명은 처음 것만 쓴다. 빠뜨린 항목은 빈 줄이다
  const named = requests.map((request) => ({ name: request.item.name, request }));
  const value: Record<string, CareerLines> = {};
  for (const answer of result.value.items) {
    const request = resolveAlias(answer.exp, named)?.request;
    if (!request || value[request.item.id]) continue;
    const caps = lineCaps(request.detail);
    value[request.item.id] = { done: cleanLines(answer.done, caps.done), results: cleanLines(answer.results, caps.results) };
  }
  const answered = new Set(Object.keys(value));
  if (answered.size === 0) return { ok: false, reason: "invalid" };
  for (const { item } of requests) value[item.id] ??= { done: [], results: [] };
  return { ok: true, value, answered };
}

// 트랙의 확인된 경력(제외 아님)으로 공통본을 처음 만든다. 회사는 모두 넣고, 항목은 회사 순서대로 30개까지.
// 확인된 경력이 없으면 no_jobs, 항목이 없으면 AI 없이 회사 머리만 만든다. 이미 있으면 exists
export async function startCommonCareer(
  db: Db,
  ai: AiClient,
  userId: string,
  trackId: string,
  now: Date = new Date(),
): Promise<{ ok: true; id: string } | { ok: false; reason: "not_found" | "exists" | "no_jobs" | "over_limit" | AiFailure }> {
  if (!(await ownsTrack(db, userId, trackId))) return { ok: false, reason: "not_found" };
  if (await getCommonCareer(db, userId, trackId)) return { ok: false, reason: "exists" };

  const sources = await listCareerSources(db, userId, trackId);
  if (sources.length === 0) return { ok: false, reason: "no_jobs" };

  const requests: CareerRequest[] = [];
  for (const source of sources) {
    for (const item of source.items) {
      if (requests.length >= CAREER_LIMITS.items) break;
      requests.push({ companyId: source.id, item, detail: detailFor(item.scope), emphasize: false });
    }
  }

  const written = await writeCareerItems(db, ai, userId, { requests, posting: null }, now);
  if (!written.ok) return written;

  const content: CareerContent = {
    companies: sources.map((source) => ({
      ...buildCompany(source),
      items: requests
        .filter((request) => request.companyId === source.id)
        .map((request) => buildItem(request.item, request.detail, false, written.value[request.item.id] ?? { done: [], results: [] }, now)),
    })),
    commonVersion: null,
  };
  // AI가 쓰는 사이 다른 곳에서 만들었으면 exists
  return insertCommonCareer(db, userId, trackId, content);
}

// ids의 항목 id는 다시 쓰거나 빠진 항목으로 넣고, 경력 id는 그 회사 머리를 코드로 새로 고친다(없으면 항목 없이 넣는다).
// 다시 쓴 항목이 든 회사의 머리도 함께 새로 고친다. 공통본·맞춤본 모두.
// 읽었을 때의 version 그대로일 때만 저장한다(그사이 고쳤거나 옮겼으면 changed)
export async function rewriteCareerItems(
  db: Db,
  ai: AiClient,
  userId: string,
  careerId: string,
  ids: string[],
  expectedVersion: number,
  now: Date = new Date(),
): Promise<{ ok: true; value: CareerContent } | { ok: false; reason: RewriteFailure }> {
  const career = await getCareer(db, userId, careerId);
  if (!career) return { ok: false, reason: "not_found" };
  const posting = career.postingId ? await getPosting(db, userId, career.postingId) : null;
  if (career.postingId) {
    if (!posting) return { ok: false, reason: "not_found" };
    const block = await editBlock(db, userId, posting);
    if (block) return { ok: false, reason: block };
  }
  if (!career.content || career.version !== expectedVersion) return { ok: false, reason: "changed" };

  // 화면이 보낸 id 중 지금 쓸 수 있는 경력·항목만 받는다
  const sources = await listCareerSources(db, userId, career.trackId);
  const asked = new Set(ids);
  const jobs = sources.filter((source) => asked.has(source.id));
  const listed: { companyId: string; item: CareerItemSource }[] = sources.flatMap((source) =>
    source.items.map((item) => ({ companyId: source.id, item })),
  );
  const companyOf = new Map(listed.map(({ companyId, item }) => [item.id, companyId]));
  const wanted = new Set(ids.filter((id) => companyOf.has(id)));

  // 다른 회사로 옮긴 항목은 옛 회사에서 빼고 새 회사의 새 항목으로 넣는다(한 항목이 두 회사에 있지 않게).
  // 새 항목으로 다시 만들므로 분량은 지금 범위로, 강조는 꺼진다
  const moved = new Set(
    career.content.companies.flatMap((company) =>
      company.items
        .filter((item) => wanted.has(item.experienceId) && companyOf.get(item.experienceId) !== company.experienceId)
        .map((item) => item.experienceId),
    ),
  );
  const content: CareerContent = {
    ...career.content,
    companies: career.content.companies.map((company) => ({
      ...company,
      items: company.items.filter((item) => !moved.has(item.experienceId)),
    })),
  };
  const existing = new Map<string, CareerItem>(content.companies.flatMap((company) => company.items.map((item) => [item.experienceId, item])));
  // 있는 항목과 옮긴 항목(빼 둔 제 자리를 쓴다)은 모두 받고, 새 항목은 30개까지 남은 자리만큼만 받는다(목록 순서대로)
  const room = Math.max(0, CAREER_LIMITS.items - itemCount(content) - moved.size);
  const fresh = listed.filter(({ item }) => wanted.has(item.id) && !existing.has(item.id) && !moved.has(item.id));
  const chosen = [
    ...listed.filter(({ item }) => existing.has(item.id) && wanted.has(item.id)),
    ...listed.filter(({ item }) => moved.has(item.id)),
    ...fresh.slice(0, room),
  ];
  if (chosen.length === 0 && jobs.length === 0) return { ok: false, reason: fresh.length > 0 ? "full" : "none_selected" };

  const requests: CareerRequest[] = chosen.map(({ companyId, item }) => {
    const entry = existing.get(item.id);
    // 공통본은 지금의 범위로, 맞춤본의 있는 항목은 그 항목의 분량으로 쓴다
    const detail = entry && career.postingId ? entry.detail : detailFor(item.scope);
    return { companyId, item, detail, emphasize: entry?.emphasized ?? false };
  });
  const context: ResumePostingContext | null =
    posting && requests.some((request) => request.emphasize)
      ? { text: postingTextOf(posting), requirements: requirementsOf(posting) }
      : null;

  // 경력 id만 받았으면 requests가 비어 AI를 부르지 않는다
  const written = await writeCareerItems(db, ai, userId, { requests, posting: context }, now);
  if (!written.ok) return { ok: false, reason: written.reason };

  let next = content;
  for (const job of jobs) next = refreshCompany(next, job, sources);
  // AI가 답에서 뺀 기존 항목은 그대로 둔다(줄을 비우지 않는다). 새 항목은 빈 줄로 넣는다
  const items = requests
    .filter((request) => written.answered.has(request.item.id) || !existing.has(request.item.id))
    .map((request) => ({
      companyId: request.companyId,
      item: buildItem(request.item, request.detail, request.emphasize, written.value[request.item.id] ?? { done: [], results: [] }, now),
    }));
  next = upsertItems(next, sources, items);
  // 맞춤본은 제출 확인과 저장을 공고 잠금 안에서 한다. 공통본은 잠금 없이 저장한다
  const save = (tx: Db) => saveCareerContent(tx, userId, careerId, next, expectedVersion);
  const saved = posting ? await withEditLock(db, userId, posting.id, save) : await save(db);
  return saved.ok ? { ok: true, value: next } : saved;
}
