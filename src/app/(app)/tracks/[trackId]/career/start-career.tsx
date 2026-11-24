"use client";

import { startCommonCareerAction } from "@/modules/applications/career-actions";
import { ErrorLine, useRun } from "../../../postings/[id]/application/use-run";

// 트랙의 확인된 경력과 그 아래 항목으로 경력기술서 공통본을 처음 만든다(항목이 있으면 AI 1번)
export function StartCareer({ trackId, jobs, items }: { trackId: string; jobs: number; items: number }) {
  const { message, pending, run } = useRun();
  return (
    <div className="space-y-2 rounded-lg border border-foreground/20 p-4">
      <p className="text-sm">
        경력 {jobs}개, 항목 {items}개로 경력기술서를 씁니다
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => startCommonCareerAction(trackId))}
          className="rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-50"
        >
          {pending ? "만드는 중…" : "만들기"}
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
