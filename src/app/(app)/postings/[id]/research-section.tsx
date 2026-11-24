"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { rerunResearchAction, setNewsCheckedAction, setTalentVerdictAction } from "@/modules/postings/research-actions";
import type { ResearchView } from "./research-view";

type Result = { ok: true } | { ok: false; message: string };

const button = "rounded-lg border border-foreground/20 px-4 py-2 text-sm font-medium disabled:opacity-50";
const pick = "rounded-lg border px-3 py-1 text-sm disabled:opacity-50";
const pickOn = "border-foreground bg-foreground text-background";
const pickOff = "border-foreground/20";
// 조사 중 다시 그리기 간격과 한도. 조사를 막 시작했을 때(줄이 아직 없을 수 있다)는 짧게 몇 번만 본다
const POLL_MS = 5_000;
const RUNNING_LIMIT_MS = 5 * 60_000;
const KICK_POLL_MS = 2_000;
const KICK_LIMIT_MS = 20_000;

export type ResearchSectionProps = {
  postingId: string;
  company: string;
  isApply: boolean; // 아니면 같은 회사의 조사를 읽기로만 보인다
  view: ResearchView;
  runKey: string; // 지금 조사 줄의 시작 시각(없으면 "none"). 다시 조사를 누른 뒤 새 조사가 잡혔는지 본다
  lastDate: string | null; // 마지막으로 끝난 조사의 날짜
  talent: { id: string; text: string; url: string; host: string; title: string; verdict: "yes" | "no" | null } | null;
  talentSkipped: boolean;
  news: { id: string; summary: string; url: string; host: string; title: string; date: string | null; checked: boolean }[];
};

// 공고 화면의 회사 조사. 인재상은 맞음·아님, 소식은 체크로 고르고, 누르면 바로 저장한다
export function ResearchSection({ postingId, company, isApply, view, runKey, lastDate, talent, talentSkipped, news }: ResearchSectionProps) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // 조사를 맡긴 뒤 아직 조사 줄이 잡히지 않았을 때: 그때의 runKey. 지원 직후(줄 없음)에도 켠다
  const [kickKey, setKickKey] = useState<string | null>(isApply && view.state === "none" ? "none" : null);
  const kicked = kickKey !== null && kickKey === runKey && view.state !== "running";
  const running = view.state === "running";

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
    run(() => rerunResearchAction(postingId), () => setKickKey(runKey));
  }

  const canPick = isApply && view.editable && !pending && !kicked;
  const hasResult = lastDate !== null;
  const showRerun = isApply && view.canRerun && !kicked;
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
            {talentSkipped ? (
              <p className="text-sm text-foreground/70">공고의 인재상을 씁니다</p>
            ) : talent ? (
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                <div className="min-w-0 space-y-0.5">
                  <p className="break-words text-sm">“{talent.text}”</p>
                  <a href={talent.url} title={talent.title} target="_blank" rel="noopener noreferrer" className="text-xs text-foreground/60 underline">
                    출처: {talent.host}
                  </a>
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
                          <a href={item.url} title={item.title} target="_blank" rel="noopener noreferrer" className="underline">
                            출처: {item.host}
                          </a>
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
