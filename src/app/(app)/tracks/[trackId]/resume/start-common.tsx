"use client";

import { startCommonResumeAction } from "@/modules/applications/resume-actions";
import { ErrorLine, useRun } from "../../../postings/[id]/application/use-run";

// 트랙의 확인된 경험으로 이력서 공통본을 처음 만든다(AI 1번)
export function StartCommon({ trackId, count }: { trackId: string; count: number }) {
  const { message, pending, run } = useRun();
  return (
    <div className="space-y-2 rounded-lg border border-foreground/20 p-4">
      <p className="text-sm">확인된 경험 {count}개로 공통본을 만듭니다</p>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => startCommonResumeAction(trackId))}
          className="rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-50"
        >
          {pending ? "만드는 중…" : "공통본 만들기"}
        </button>
        {pending && (
          <span role="status" className="text-sm text-foreground/60">
            1분쯤 걸릴 수 있습니다
          </span>
        )}
      </div>
      <ErrorLine message={message} />
    </div>
  );
}
