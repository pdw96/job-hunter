"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import {
  analyzePostingAction,
  applyToPostingAction,
  deletePostingAction,
  setExcludeOverrideAction,
  setPostingStatusAction,
} from "@/modules/postings/actions";
import type { PostingStatus } from "@/modules/postings/options";

type Result = { ok: true } | { ok: false; message: string };

const button = "rounded-lg border border-foreground/20 px-4 py-2 text-sm font-medium disabled:opacity-50";

// 점수 보기 / 다시 보기. AI가 요구 사항을 읽는 동안 기다리는 표시를 한다
export function AnalyzeButton({ id, again }: { id: string; again: boolean }) {
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function analyze() {
    setMessage(null);
    startTransition(async () => {
      const result = await analyzePostingAction(id);
      if (!result.ok) setMessage(result.message);
    });
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={pending}
          onClick={analyze}
          className={again ? "text-sm underline disabled:opacity-50" : "rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-50"}
        >
          {pending ? "요구 사항을 읽는 중…" : again ? "다시 보기" : "점수 보기"}
        </button>
        {pending && (
          <span role="status" className="text-sm text-foreground/60">
            1분쯤 걸릴 수 있습니다
          </span>
        )}
      </div>
      {message && (
        <p role="alert" className="text-sm text-red-600">
          {message}
        </p>
      )}
    </div>
  );
}

// 공고의 지원 판단. 지원은 점수를 본 뒤에만 고를 수 있고, 고르면 서버가 그때의 점수를 남긴다
export function PostingActions({
  id,
  status,
  hasReasons,
  excludeOverride,
  hasAnalysis,
  submissionCount,
}: {
  id: string;
  status: PostingStatus;
  hasReasons: boolean;
  excludeOverride: boolean;
  hasAnalysis: boolean;
  submissionCount: number;
}) {
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run(action: () => Promise<Result>) {
    setMessage(null);
    startTransition(async () => {
      const result = await action();
      if (result && !result.ok) setMessage(result.message);
    });
  }

  const canApply = status === "interest" || status === "hold";

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {hasReasons && !excludeOverride && (
          <button type="button" disabled={pending} onClick={() => run(() => setExcludeOverrideAction(id, true))} className={button}>
            그래도 진행
          </button>
        )}
        {hasReasons && excludeOverride && (
          <button type="button" disabled={pending} onClick={() => run(() => setExcludeOverrideAction(id, false))} className={button}>
            진행 취소
          </button>
        )}
        {canApply && (
          <button
            type="button"
            disabled={pending || !hasAnalysis}
            onClick={() => run(() => applyToPostingAction(id))}
            className={button}
          >
            지원
          </button>
        )}
        {status === "interest" ? (
          <>
            <button type="button" disabled={pending} onClick={() => run(() => setPostingStatusAction(id, "hold"))} className={button}>
              보류
            </button>
            <button type="button" disabled={pending} onClick={() => run(() => setPostingStatusAction(id, "excluded"))} className={button}>
              제외
            </button>
          </>
        ) : (
          <button type="button" disabled={pending} onClick={() => run(() => setPostingStatusAction(id, "interest"))} className={button}>
            관심으로 되돌리기
          </button>
        )}
        <Link href={`/postings/${id}/edit`} className="ml-auto text-sm underline">
          고치기
        </Link>
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            if (window.confirm(submissionCount > 0 ? `이 공고를 지울까요? 제출본 ${submissionCount}개도 함께 지워집니다` : "이 공고를 지울까요?")) run(() => deletePostingAction(id));
          }}
          className="text-sm text-red-600 underline disabled:opacity-50"
        >
          지우기
        </button>
      </div>
      {canApply && !hasAnalysis && <p className="text-sm text-foreground/60">점수를 본 뒤 고를 수 있습니다</p>}
      {message && (
        <p role="alert" className="text-sm text-red-600">
          {message}
        </p>
      )}
    </div>
  );
}
