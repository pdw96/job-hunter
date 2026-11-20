"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { setFactConfirmedAction } from "@/modules/experiences/record-actions";
import type { HeadKind } from "@/modules/experiences/record-options";

// 프로젝트·활동 머리의 맞음. 사례가 없어도 확인할 수 있게 목록과 편집 화면에서 쓴다
export function HeadConfirm({ kind, id, openClaims = 0, showFix = true }: { kind: HeadKind; id: string; openClaims?: number; showFix?: boolean }) {
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function confirm() {
    setMessage(null);
    startTransition(async () => {
      const result = await setFactConfirmedAction(kind, id, true);
      if (!result.ok) setMessage(result.message);
    });
  }

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={confirm}
          disabled={pending || openClaims > 0}
          className="rounded-lg bg-foreground px-3 py-1.5 text-sm font-medium text-background disabled:opacity-40"
        >
          맞음
        </button>
        {showFix && (
          <Link href={`/records/facts/${kind}/${id}`} className="rounded-lg border border-foreground/20 px-3 py-1.5 text-sm font-medium">
            고치기
          </Link>
        )}
      </div>
      {openClaims > 0 && <p className="text-xs text-foreground/60">줄 확인이 남아 있습니다 {openClaims}개. 고치기에서 먼저 확인해 주세요</p>}
      {message && (
        <p role="alert" className="text-xs text-red-600">
          {message}
        </p>
      )}
    </div>
  );
}
