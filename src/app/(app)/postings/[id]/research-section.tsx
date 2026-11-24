"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { rerunResearchAction, setNewsCheckedAction, setTalentVerdictAction } from "@/modules/postings/research-actions";
import { isWebUrl } from "@/modules/postings/research";
import { KICK_LIMIT_MS, type Kick, type ResearchView, talentSkipNote, waitingForStart } from "./research-view";

type Result = { ok: true } | { ok: false; message: string };

const button = "rounded-lg border border-foreground/20 px-4 py-2 text-sm font-medium disabled:opacity-50";
const pick = "rounded-lg border px-3 py-1 text-sm disabled:opacity-50";
const pickOn = "border-foreground bg-foreground text-background";
const pickOff = "border-foreground/20";
// 조사 중 다시 그리기 간격과 한도. 조사를 막 맡겼을 때(줄이 아직 없을 수 있다)는 짧게 KICK_LIMIT_MS까지만 본다
const POLL_MS = 5_000;
const RUNNING_LIMIT_MS = 5 * 60_000;
const KICK_POLL_MS = 2_000;

export type ResearchSectionProps = {
  postingId: string;
  company: string;
  isApply: boolean; // 아니면 같은 회사의 조사를 읽기로만 보인다
  view: ResearchView;
  runKey: string; // 지금 조사 줄의 시작 시각(없으면 "none"). 조사를 맡긴 뒤 새 조사가 잡혔는지 본다
  kickAt: number | null; // 지원 직후에 그린 화면이면 지원한 때(ms, kickFromApply). 아니면 null
  lastDate: string | null; // 마지막으로 끝난 조사의 날짜
  talent: { id: string; text: string; url: string; host: string; title: string; verdict: "yes" | "no" | null } | null;
  talentSkipped: boolean; // 조사 줄의 값(그 조사를 돌린 공고에 인재상 글이 있었다)
  postingWantsTalent: boolean; // 이 공고에는 인재상 글이 없다(wantsTalent)
  news: { id: string; summary: string; url: string; host: string; title: string; date: string | null; checked: boolean }[];
};

// 공고 화면의 회사 조사. 인재상은 맞음·아님, 소식은 체크로 고르고, 누르면 바로 저장한다
export function ResearchSection({ postingId, company, isApply, view, runKey, kickAt, lastDate, talent, talentSkipped, postingWantsTalent, news }: ResearchSectionProps) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // 조사를 맡긴 직후(지원 직후에 그린 화면, 또는 이 화면에서 조사하기·다시 조사를 누른 뒤)에만 조사 시작을 기다린다.
  // KICK_LIMIT_MS가 지나면 아래 타이머가 지워서 보통 화면(단추 포함)으로 돌아간다
  const [kick, setKick] = useState<Kick | null>(kickAt !== null ? { at: kickAt, runKey: "none" } : null);
  // 시간은 타이머가 맡으므로 여기서는 맡긴 때를 지금으로 넘긴다(그리는 중에 시계를 읽지 않는다)
  const kicked = waitingForStart(kick, runKey, view.state, kick?.at ?? 0);
  const running = view.state === "running";

  useEffect(() => {
    if (!kick) return;
    // 서버와 브라우저 시계가 달라도 KICK_LIMIT_MS보다 오래 기다리지 않는다
    const left = Math.min(KICK_LIMIT_MS, Math.max(0, kick.at + KICK_LIMIT_MS - Date.now()));
    const timer = setTimeout(() => setKick(null), left);
    return () => clearTimeout(timer);
  }, [kick]);

  useEffect(() => {
    if (!running && !kicked) return;
    const started = Date.now();
    const limit = running ? RUNNING_LIMIT_MS : KICK_LIMIT_MS;
    const timer = setInterval(
      () => {
        if (Date.now() - started > limit) clearInterval(timer);
        else router.refresh();
      },
      running ? POLL_MS : KICK_POLL_MS,
    );
    return () => clearInterval(timer);
  }, [running, kicked, router]);

  function run(action: () => Promise<Result>, onOk?: () => void) {
    setMessage(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) setMessage(result.message);
      else onOk?.();
    });
  }

  function rerun() {
    const first = view.rerunLabel === "조사하기";
    if (!window.confirm(first ? "웹 검색으로 조사합니다. AI 사용량이 듭니다" : "웹 검색으로 다시 조사합니다. AI 사용량이 듭니다")) return;
    run(() => rerunResearchAction(postingId), () => setKick({ at: Date.now(), runKey }));
  }

  const canPick = isApply && view.editable && !pending && !kicked;
  const hasResult = lastDate !== null;
  const showRerun = isApply && view.canRerun && !kicked;
  const skipNote = talentSkipNote({ rowSkipped: talentSkipped, postingWantsTalent, isApply });
  const status = kicked ? "조사를 시작합니다…" : (view.staleNote ?? view.headline);

  return (
    <section className="space-y-3" aria-label="회사 조사">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h2 className="min-w-0 font-semibold">회사 조사 ─ {company}</h2>
        <div className="flex flex-wrap items-center gap-3">
          <span
            role={running || kicked ? "status" : undefined}
            className={`text-sm ${view.staleNote && !kicked ? "text-amber-700" : "text-foreground/60"}`}
          >
            {status}
          </span>
          {showRerun && (
            <button type="button" disabled={pending} onClick={rerun} className={button}>
              {view.rerunLabel}
            </button>
          )}
        </div>
      </div>

      {view.failure && !kicked && (
        <p className="text-sm text-red-600">
          {view.failure}
          {view.pasteLink && (
            <>
              {" "}
              <Link href={`/postings/${postingId}/edit`} className="underline">
                인재상 붙여 넣기
              </Link>
            </>
          )}
        </p>
      )}

      {hasResult && (
        <div className={`space-y-3 ${view.editable ? "" : "opacity-60"}`}>
          {view.state !== "done" && view.state !== "stale" && <p className="text-xs text-foreground/60">지난 조사 {lastDate}</p>}

          <div className="space-y-1">
            <h3 className="text-sm font-medium">인재상</h3>
            {skipNote ? (
              <p className="text-sm text-foreground/70">{skipNote}</p>
            ) : talent ? (
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                <div className="min-w-0 space-y-0.5">
                  <p className="break-words text-sm">“{talent.text}”</p>
                  <SourceLink url={talent.url} title={talent.title} host={talent.host} className="text-xs text-foreground/60" />
                </div>
                <div className="flex gap-2">
                  {(["yes", "no"] as const).map((verdict) => {
                    const on = talent.verdict === verdict;
                    return (
                      <button
                        key={verdict}
                        type="button"
                        aria-pressed={on}
                        disabled={!canPick}
                        // 켜진 쪽을 다시 누르면 미정으로 돌린다
                        onClick={() => run(() => setTalentVerdictAction(postingId, talent.id, on ? null : verdict))}
                        className={`${pick} ${on ? pickOn : pickOff}`}
                      >
                        {verdict === "yes" ? "맞음" : "아님"}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : (
              <p className="text-sm text-foreground/60">
                회사 홈페이지에서 인재상을 찾지 못했습니다.{" "}
                {isApply && (
                  <Link href={`/postings/${postingId}/edit`} className="underline">
                    인재상 붙여 넣기
                  </Link>
                )}
              </p>
            )}
          </div>

          <div className="space-y-1">
            <h3 className="text-sm font-medium">최근 소식</h3>
            {news.length === 0 ? (
              <p className="text-sm text-foreground/60">최근 소식을 찾지 못했습니다</p>
            ) : (
              <ul className="space-y-2">
                {news.map((item) => (
                  <li key={item.id}>
                    <label className="flex items-start gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={item.checked}
                        disabled={!canPick}
                        onChange={() => run(() => setNewsCheckedAction(postingId, item.id, !item.checked))}
                        className="mt-0.5 size-4 shrink-0"
                      />
                      <span className="min-w-0 space-y-0.5">
                        <span className="block break-words">{item.summary}</span>
                        <span className="block text-xs text-foreground/60">
                          <SourceLink url={item.url} title={item.title} host={item.host} />
                          {` · ${item.date ?? "날짜 모름"}`}
                        </span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <p className="text-sm text-foreground/60">
            {isApply ? "체크한 것만 자소서(지원동기·포부)에 씁니다" : "지원으로 고르면 인재상과 소식을 고를 수 있습니다"}
          </p>
        </div>
      )}

      {message && (
        <p role="alert" className="text-sm text-red-600">
          {message}
        </p>
      )}
    </section>
  );
}

// 출처는 http·https 주소일 때만 링크로 잇는다. 그 밖의 주소는 호스트를 글로만 보인다
function SourceLink({ url, title, host, className = "" }: { url: string; title: string; host: string; className?: string }) {
  if (!isWebUrl(url)) return <span className={className}>출처: {host}</span>;
  return (
    <a href={url} title={title} target="_blank" rel="noopener noreferrer" className={`underline ${className}`}>
      출처: {host}
    </a>
  );
}
