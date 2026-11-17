import Link from "next/link";
import type { AppliedScore, PostingAnalysis, PostingScore, Requirement } from "@/modules/postings/analysis";
import { DESIRE_CRITERIA, FIT_CRITERIA, requirementLevel } from "@/modules/postings/score";
import { todayInKorea } from "@/modules/postings/today";
import { type Criterion, CRITERION_LABELS } from "@/modules/tracks/options";
import { StartInterview } from "../../experiences/start-interview";
import { AnalyzeButton } from "../posting-actions";

// 공고 화면의 점수 칸. 점수는 페이지가 지금의 경험 후보로 계산해 넘긴다(근거가 빠진 경험은 여기서도 보이지 않는다)

const LEVEL_LABELS = { full: "덮음", partial: "일부", none: "부족" } as const;
const LEVEL_STYLES = {
  full: "bg-emerald-600/15 text-emerald-700 dark:text-emerald-400",
  partial: "bg-sky-600/15 text-sky-700 dark:text-sky-400",
  none: "bg-amber-600/15 text-amber-700 dark:text-amber-400",
} as const;

const dateOf = (iso: string) => todayInKorea(new Date(iso));
const number = (value: number | null) => (value === null ? "알 수 없음" : String(value));

function ScoreCard({
  title,
  value,
  keys,
  score,
  notes,
}: {
  title: string;
  value: number | null;
  keys: readonly Criterion[];
  score: PostingScore;
  notes: Partial<Record<Criterion, string>>;
}) {
  return (
    <div className="space-y-3 rounded-lg border border-foreground/20 p-4">
      <p className="text-sm text-foreground/60">{title}</p>
      <p className="text-3xl font-bold">
        {value === null ? (
          <span className="text-xl">알 수 없음</span>
        ) : (
          <>
            {value} <span className="text-base font-normal text-foreground/60">/ 100</span>
          </>
        )}
      </p>
      <ul className="space-y-1 text-sm">
        {keys.map((key) => {
          const { score: part, weight } = score.criteria[key];
          return (
            <li key={key}>
              <span className="text-foreground/70">{CRITERION_LABELS[key]}</span> {weight}점 중{" "}
              <span className="font-medium">{part === null ? "알 수 없음" : Math.round(part * weight)}</span>
              {notes[key] && <span className="block text-xs text-foreground/60">{notes[key]}</span>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function RequirementItem({
  requirement,
  usable,
  names,
}: {
  requirement: Requirement;
  usable: ReadonlySet<string>;
  names: ReadonlyMap<string, string>;
}) {
  const level = requirementLevel(requirement, usable);
  // 지금 쓸 수 없는 경험(지웠거나 확인을 풀었거나 트랙에서 뺀 것)은 근거로 보여 주지 않는다
  const evidence = requirement.evidence.filter((e) => usable.has(e.experienceId) && names.has(e.experienceId));
  return (
    <li className="space-y-1 py-3">
      <div className="flex items-start gap-2">
        {requirement.quoteFound ? (
          <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${LEVEL_STYLES[level]}`}>{LEVEL_LABELS[level]}</span>
        ) : (
          <span className="shrink-0 rounded-full border border-foreground/20 px-2 py-0.5 text-xs text-foreground/60">찾지 못함</span>
        )}
        <span className="min-w-0 break-words text-sm">{requirement.text}</span>
      </div>
      {requirement.quote && requirement.quote !== requirement.text && (
        <p className="break-words text-xs text-foreground/60">“{requirement.quote}”</p>
      )}
      {!requirement.quoteFound && <p className="text-xs text-foreground/60">원문에서 찾지 못해 점수에 넣지 않았습니다</p>}
      {evidence.length > 0 && (
        <ul className="space-y-1 text-xs">
          {evidence.map((e) => (
            <li key={e.experienceId} className="break-words">
              <Link href={`/experiences/${e.experienceId}`} className="underline">
                {names.get(e.experienceId)}
              </Link>
              <span className="text-foreground/60">
                {" "}
                ({LEVEL_LABELS[e.level]}){e.why && ` ${e.why}`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

export function ScoreSection({
  id,
  analysis,
  score,
  appliedScore,
  candidates,
  track,
}: {
  id: string;
  track: { id: string; name: string } | null;
  analysis: PostingAnalysis | null;
  score: PostingScore | null;
  appliedScore: AppliedScore | null;
  candidates: { id: string; name: string }[];
}) {
  const usable = new Set(candidates.map((c) => c.id));
  const names = new Map(candidates.map((c) => [c.id, c.name]));
  const requirements = analysis?.requirements ?? [];
  const groups = [
    { title: "필수", list: requirements.filter((r) => r.kind === "required") },
    { title: "우대", list: requirements.filter((r) => r.kind === "preferred") },
  ].filter((group) => group.list.length > 0);
  const lacking = requirements.filter((r) => r.quoteFound && requirementLevel(r, usable) === "none");

  return (
    <section className="space-y-4" aria-label="점수">
      <h2 className="font-semibold">점수</h2>

      {appliedScore && (
        <p className="text-sm">
          지원할 때의 점수: 원하는 정도 {number(appliedScore.desire)} · 자격이 맞는 정도 {number(appliedScore.fit)}{" "}
          <span className="text-foreground/60">({dateOf(appliedScore.appliedAt)})</span>
        </p>
      )}

      {candidates.length === 0 && (
        <p className="rounded-lg bg-foreground/5 p-3 text-sm">
          확인된 경험이 없어 자격 점수가 낮게 나옵니다.{" "}
          <Link href="/experiences" className="underline">
            경험 기록
          </Link>
        </p>
      )}

      {!analysis || !score ? (
        <div className="space-y-3">
          <p className="text-sm text-foreground/70">
            공고의 요구 사항을 뽑아 내 경험과 맞대고, 원하는 정도와 자격이 맞는 정도를 매깁니다
          </p>
          <AnalyzeButton id={id} again={false} />
        </div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <ScoreCard title="원하는 정도" value={score.desire} keys={DESIRE_CRITERIA} score={score} notes={{ field: analysis.field.reason }} />
            <ScoreCard title="자격이 맞는 정도" value={score.fit} keys={FIT_CRITERIA} score={score} notes={{}} />
          </div>
          <p className="text-xs text-foreground/60">점수는 붙을 확률이 아니라, 어느 공고에 먼저 시간을 쓸지 정하는 순서입니다</p>
          <div className="flex flex-wrap items-center gap-3 text-sm text-foreground/60">
            <span>{dateOf(analysis.analyzedAt)}에 봄</span>
            <AnalyzeButton id={id} again />
          </div>

          <div className="space-y-2">
            <h3 className="font-semibold">요구 사항</h3>
            {groups.length === 0 ? (
              <p className="text-sm text-foreground/70">공고에서 요구 사항을 찾지 못했습니다</p>
            ) : (
              groups.map((group) => (
                <div key={group.title}>
                  <p className="text-sm font-medium text-foreground/70">{group.title}</p>
                  <ul className="divide-y divide-foreground/10">
                    {group.list.map((requirement, index) => (
                      <RequirementItem key={index} requirement={requirement} usable={usable} names={names} />
                    ))}
                  </ul>
                </div>
              ))
            )}
          </div>

          {lacking.length > 0 && (
            <div className="space-y-2 rounded-lg border border-amber-600/40 p-4">
              <h3 className="font-semibold">부족한 점</h3>
              <ul className="list-disc space-y-1 pl-5 text-sm">
                {lacking.map((requirement, index) => (
                  <li key={index} className="break-words">
                    {requirement.kind === "preferred" && <span className="text-foreground/60">(우대) </span>}
                    {requirement.text}
                  </li>
                ))}
              </ul>
              <p className="text-sm text-foreground/70">기록하지 않은 경험이 있다면 경험 인터뷰로 더해 보세요</p>
              {/* /experiences/interview에는 목록 화면이 없어서, 이 공고의 트랙으로 인터뷰를 바로 시작한다 */}
              {track && <StartInterview tracks={[track]} />}
            </div>
          )}
        </>
      )}
    </section>
  );
}
