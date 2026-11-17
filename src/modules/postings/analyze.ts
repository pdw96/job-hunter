import { z } from "zod";
import type { Db } from "@/db/types";
import { type AiClient, type AiFailure, runAi } from "@/modules/ai/client";
import { type EvidenceCandidate, listEvidenceCandidates } from "@/modules/experiences/evidence";
import { numbersIn } from "@/modules/experiences/grounding";
import { KIND_LABELS } from "@/modules/experiences/options";
import { listMajors } from "@/modules/ncs/repo";
import { getTrack, listTracks } from "@/modules/tracks/repo";
import type { Evidence, PostingAnalysis, Requirement } from "./analysis";
import { ANALYZE_SYSTEM } from "./prompts";
import { getPosting, saveAnalysis } from "./repo";

// AI가 공고에서 요구 사항을 뽑고, 확인된 경험 가운데 근거가 되는 것을 짚는다.
// AI에게는 경험의 실제 id 대신 E1, E2 같은 별명만 보내고, 답의 별명은 코드가 실제 id로 바꾼다.
// 점수는 AI가 매기지 않는다(score.ts가 계산한다).

const LIMITS = { requirements: 30, text: 200, quote: 300, why: 300, reason: 200 } as const;

const analyzeSchema = z.object({
  field: z.object({ level: z.enum(["same_job", "same_field", "other"]), reason: z.string() }),
  requirements: z.array(
    z.object({
      kind: z.enum(["required", "preferred"]),
      text: z.string(),
      quote: z.string(),
      evidence: z.array(z.object({ exp: z.string(), level: z.enum(["full", "partial"]), why: z.string() })),
    }),
  ),
});

export type AnalyzeInput = {
  rawText: string;
  companyNote: string | null;
  jobNames: string[];
  majorName: string;
  candidates: EvidenceCandidate[];
};

const squash = (text: string) => text.replace(/\s+/g, "").toLowerCase();
const orNone = (value: string | null) => (value && value.trim() !== "" ? value : "없음");

// 수치와 증빙 메모는 EvidenceCandidate에 없으므로 보내지 않는다
function describeCandidate(alias: string, c: EvidenceCandidate): string {
  const period =
    c.kind === "certificate"
      ? orNone(c.startMonth)
      : `${c.startMonth ?? "없음"} ~ ${c.isOngoing ? "진행 중" : (c.endMonth ?? "없음")}`;
  const lines: [string, string | null][] = [
    ["이름", c.name],
    ["구분", KIND_LABELS[c.kind]],
    ["소속·기관", c.organization],
    ["직무·역할", c.role],
    ["기간", period],
    ["상황", c.situation],
    ["본인이 한 일", c.actions],
    ["결과", c.result],
    ["하지 않은 것", c.notDone],
  ];
  return [alias, ...lines.map(([label, value]) => `- ${label}: ${orNone(value)}`)].join("\n");
}

function buildMessage(input: AnalyzeInput): string {
  const experiences =
    input.candidates.length === 0
      ? "없음"
      : input.candidates.map((c, i) => describeCandidate(`E${i + 1}`, c)).join("\n\n");
  const sections: [string, string][] = [
    ["지원 직무", orNone(input.jobNames.filter((name) => name.trim() !== "").join(", "))],
    ["분야", orNone(input.majorName)],
    ["공고 원문", input.rawText],
    ["인재상·회사 소개", orNone(input.companyNote)],
    ["경험 기록", experiences],
  ];
  return sections.map(([label, value]) => `[${label}]\n${value}`).join("\n\n");
}

// why의 숫자가 그 경험의 글과 (원문에서 찾은) quote에 있는지. 별명(E1)의 숫자는 보지 않는다
function grounded(why: string, c: EvidenceCandidate, quote: string): boolean {
  const known = new Set(
    [c.name, c.organization, c.role, c.startMonth, c.endMonth, c.situation, c.actions, c.result, c.notDone, quote].flatMap(
      numbersIn,
    ),
  );
  return numbersIn(why.replace(/\bE\d+\b/g, "")).every((n) => known.has(n));
}

// 저장하지 않는다. 프롬프트 점검도 이것을 쓴다
export async function analyzeText(
  db: Db,
  ai: AiClient,
  userId: string,
  input: AnalyzeInput,
  now: Date = new Date(),
): Promise<{ ok: true; value: PostingAnalysis } | { ok: false; reason: "over_limit" | AiFailure }> {
  const result = await runAi(
    db,
    ai,
    userId,
    {
      purpose: "posting_match",
      system: ANALYZE_SYSTEM,
      messages: [{ role: "user", text: buildMessage(input) }],
      schema: analyzeSchema,
      effort: "medium",
      // 생각하는 데 쓰는 토큰도 max_tokens에 든다. 긴 공고에서 답이 늘 끊기면 점수를 못 봐 지원도 못 고르므로 넉넉히 둔다
      maxTokens: 16000,
    },
    now,
  );
  if (!result.ok) return { ok: false, reason: result.reason };

  // AI가 준 값도 코드가 검사한다. 원문에 없는 구절은 표시하고, 없는 경험과 지어낸 숫자는 버린다
  const source = squash(`${input.rawText}\n${input.companyNote ?? ""}`);
  const byAlias = new Map(input.candidates.map((c, i) => [`E${i + 1}`, c]));

  const requirements: Requirement[] = result.value.requirements
    .map((raw) => ({ ...raw, text: raw.text.trim().slice(0, LIMITS.text), quote: raw.quote.trim().slice(0, LIMITS.quote) }))
    .filter((raw) => raw.text !== "")
    .slice(0, LIMITS.requirements)
    .map((raw) => {
      const quoteKey = squash(raw.quote);
      const quoteFound = quoteKey !== "" && source.includes(quoteKey);
      // 원문에서 찾지 못한 quote는 AI가 지어낸 것일 수 있으므로 why의 숫자 근거로 쓰지 않는다
      const quoteForWhy = quoteFound ? raw.quote : "";
      const seen = new Set<string>();
      const evidence: Evidence[] = [];
      for (const item of raw.evidence) {
        const candidate = byAlias.get(item.exp.trim());
        if (!candidate || seen.has(candidate.id)) continue;
        seen.add(candidate.id);
        const why = item.why.trim().slice(0, LIMITS.why);
        evidence.push({
          experienceId: candidate.id,
          contentVersion: candidate.contentVersion,
          level: item.level,
          why: grounded(why, candidate, quoteForWhy) ? why : "",
        });
      }
      return { kind: raw.kind, text: raw.text, quote: raw.quote, quoteFound, evidence };
    });

  return {
    ok: true,
    value: {
      requirements,
      field: { level: result.value.field.level, reason: result.value.field.reason.trim().slice(0, LIMITS.reason) },
      analyzedAt: now.toISOString(),
    },
  };
}

export async function analyzePosting(
  db: Db,
  ai: AiClient,
  userId: string,
  postingId: string,
  now: Date = new Date(),
): Promise<{ ok: true; value: PostingAnalysis } | { ok: false; reason: "not_found" | "changed" | "over_limit" | AiFailure }> {
  const posting = await getPosting(db, userId, postingId);
  if (!posting) return { ok: false, reason: "not_found" };
  const track = await getTrack(db, userId, posting.trackId);
  if (!track) return { ok: false, reason: "not_found" };

  const [tracks, majors, candidates] = await Promise.all([
    listTracks(db, userId),
    listMajors(db),
    listEvidenceCandidates(db, userId, posting.trackId),
  ]);
  const readAs = { rawText: posting.rawText, companyNote: posting.companyNote };
  const analyzed = await analyzeText(
    db,
    ai,
    userId,
    {
      ...readAs,
      jobNames: tracks.find((t) => t.id === track.id)?.jobNames ?? [],
      majorName: majors.find((m) => m.code === track.majorCode)?.name ?? "",
      candidates,
    },
    now,
  );
  if (!analyzed.ok) return analyzed;

  // 읽었을 때의 원문·인재상 글 그대로일 때만 저장한다(그사이 고쳤으면 changed)
  const saved = await saveAnalysis(db, userId, postingId, analyzed.value, readAs);
  return saved.ok ? analyzed : saved;
}
