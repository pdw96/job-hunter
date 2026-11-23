"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { reopenAction, submitAction } from "@/modules/applications/submission-actions";

type Result = { ok: true } | { ok: false; message: string };

const button = "rounded-lg border border-foreground/20 px-4 py-2 text-sm font-medium disabled:opacity-50";
const RESUME_LABELS = { tailored: "맞춤본", common: "트랙 공통본" } as const;

export type SubmitPanelProps = {
  postingId: string;
  lastNumber: number; // 제출본이 없으면 0
  locked: boolean;
  isApply: boolean;
  preview: { resumeFrom: "tailored" | "common" | null; questionCount: number; warnings: string[] } | null;
  // 고른 서류. 고르지 않은 서류는 확인 창에서 말하지 않는다
  withResume?: boolean;
  withLetter?: boolean;
  submissions: { number: number; dateLabel: string; shortLabel: string }[];
};

// 공고 화면의 제출함 / 새 버전 만들기. 누르면 그 자리에 확인 상자를 띄운다
export function SubmitPanel({ postingId, lastNumber, locked, isApply, preview, submissions, withResume = true, withLetter = true }: SubmitPanelProps) {
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run(action: () => Promise<Result>) {
    setMessage(null);
    startTransition(async () => {
      const result = await action();
      if (result.ok) setConfirming(false);
      else setMessage(result.message);
    });
  }

  function open() {
    setMessage(null);
    setConfirming(true);
  }
  function cancel() {
    setMessage(null);
    setConfirming(false);
  }

  const last = submissions.at(-1);
  const resumeText = preview?.resumeFrom ? RESUME_LABELS[preview.resumeFrom] : "없음";

  // 끝말에 맞는 조사(을/를)를 붙인다: 원문만 있으면 "원문을", 서류가 이어지면 "이력서(…)를"·"문항 n개를"
  const frozen = ["지금의 공고 원문", withResume && `이력서(${resumeText})`, withLetter && `자소서 문항 ${preview?.questionCount ?? 0}개`].filter(
    (item): item is string => Boolean(item),
  );
  const frozenText = `${frozen.join(", ")}${frozen.length === 1 ? "을" : "를"}`;

  return (
    <section className="space-y-3" aria-label="제출">
      {isApply && locked && last && (
        <div className="space-y-2">
          <p className="text-sm">
            제출함 · {last.dateLabel} · 제출 {last.number}
          </p>
          {!confirming && (
            <button type="button" disabled={pending} onClick={open} className={button}>
              새 버전 만들기
            </button>
          )}
          {confirming && (
            <div className="space-y-3 rounded-lg border border-foreground/20 p-4" role="group" aria-label="새 버전 만들기 확인">
              <p className="text-sm">새 버전을 만들면 자소서와 맞춤본을 다시 고칠 수 있습니다. 지금 제출본은 그대로 남습니다</p>
              <div className="flex items-center gap-3">
                <button type="button" disabled={pending} onClick={() => run(() => reopenAction(postingId, lastNumber))} className={button}>
                  {pending ? "만드는 중…" : "새 버전 만들기"}
                </button>
                <button type="button" disabled={pending} onClick={cancel} className="text-sm underline">
                  취소
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {isApply && !locked && preview && (
        <div className="space-y-2">
          {!confirming && (
            <button type="button" onClick={open} className="rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background">
              제출함
            </button>
          )}
          {confirming && (
            <div className="space-y-3 rounded-lg border border-foreground/20 p-4" role="group" aria-label="제출 확인">
              <p className="text-sm">
                {frozenText} 얼립니다. 얼린 제출본은 고칠 수 없습니다
              </p>
              {preview.warnings.length > 0 && (
                <ul className="list-disc space-y-1 pl-5 text-sm text-amber-700 dark:text-amber-400">
                  {preview.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              )}
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => run(() => submitAction(postingId, lastNumber))}
                  className="rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-50"
                >
                  {pending ? "얼리는 중…" : "얼리기"}
                </button>
                <button type="button" disabled={pending} onClick={cancel} className="text-sm underline">
                  취소
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {message && (
        <p role="alert" className="text-sm text-red-600">
          {message}
        </p>
      )}

      {submissions.length > 0 && (
        <p className="text-sm">
          제출본:{" "}
          {submissions.map((item, index) => (
            <span key={item.number}>
              {index > 0 && ", "}
              <Link href={`/postings/${postingId}/submissions/${item.number}`} className="underline">
                제출 {item.number} ({item.shortLabel})
              </Link>
            </span>
          ))}
        </p>
      )}
    </section>
  );
}
