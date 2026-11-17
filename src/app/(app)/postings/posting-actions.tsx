"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { deletePostingAction, setExcludeOverrideAction, setPostingStatusAction } from "@/modules/postings/actions";
import type { PostingStatus } from "@/modules/postings/options";

type Result = { ok: true } | { ok: false; message: string };

// 공고의 지원 판단. 지원은 점수를 본 뒤에 고르게 되어 있어 아직 없다
export function PostingActions({
  id,
  status,
  hasReasons,
  excludeOverride,
}: {
  id: string;
  status: PostingStatus;
  hasReasons: boolean;
  excludeOverride: boolean;
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

  const button = "rounded-lg border border-foreground/20 px-4 py-2 text-sm font-medium disabled:opacity-50";

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
          status !== "apply" && (
            <button type="button" disabled={pending} onClick={() => run(() => setPostingStatusAction(id, "interest"))} className={button}>
              관심으로 되돌리기
            </button>
          )
        )}
        <Link href={`/postings/${id}/edit`} className="ml-auto text-sm underline">
          고치기
        </Link>
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            if (window.confirm("이 공고를 지울까요?")) run(() => deletePostingAction(id));
          }}
          className="text-sm text-red-600 underline disabled:opacity-50"
        >
          지우기
        </button>
      </div>
      {message && (
        <p role="alert" className="text-sm text-red-600">
          {message}
        </p>
      )}
    </div>
  );
}
