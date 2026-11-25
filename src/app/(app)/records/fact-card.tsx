"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import type { Claim } from "@/modules/experiences/claims";
import { setFactConfirmedAction } from "@/modules/experiences/record-actions";
import type { CardData } from "./fact-summary";
import { HeadClaims } from "./head-claims";

// sceneCount: 이 기록에 바로 딸린 사례 수(0이면 안 보임). below: 카드 아래에 붙여 그릴 것(이력 탭의 프로젝트 줄)
export function FactCard({
  card,
  claims = [],
  sceneCount = 0,
  below,
}: {
  card: CardData;
  claims?: Claim[];
  sceneCount?: number;
  below?: React.ReactNode;
}) {
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const open = claims.filter((claim) => claim.status === "pending" || claim.status === "needs_fix").length;

  function confirm() {
    setMessage(null);
    startTransition(async () => {
      const result = await setFactConfirmedAction(card.kind, card.id, true);
      if (!result.ok) setMessage(result.message);
    });
  }

  return (
    <li className="space-y-2">
      <div className="space-y-3 rounded-lg border border-foreground/15 p-4">
        <div className="flex items-start gap-3">
          <p className="min-w-0 flex-1 break-words font-medium">
            {card.title}
            {sceneCount > 0 && <span className="ml-2 text-xs font-normal text-foreground/60">사례 {sceneCount}개</span>}
          </p>
          <span
            className={`shrink-0 rounded-full border px-2 py-0.5 text-xs ${
              card.confirmed
                ? "border-emerald-600/50 text-emerald-700 dark:text-emerald-400"
                : "border-amber-600/50 text-amber-700 dark:text-amber-400"
            }`}
          >
            {card.confirmed ? "확인됨" : "미확인"}
          </span>
        </div>
        {card.lines.length > 0 && <p className="break-words text-sm text-foreground/70">{card.lines.join(" · ")}</p>}
        {card.duties.length > 0 && (
          <ul className="list-disc space-y-0.5 pl-5 text-sm text-foreground/80">
            {card.duties.map((duty, index) => (
              <li key={index}>{duty}</li>
            ))}
          </ul>
        )}
        <HeadClaims claims={claims} />
        <div className="flex flex-wrap gap-2">
          {!card.confirmed && (
            <button
              type="button"
              onClick={confirm}
              disabled={pending || open > 0}
              className="rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-40"
            >
              맞음
            </button>
          )}
          <Link
            href={`/records/facts/${card.kind}/${card.id}`}
            className="rounded-lg border border-foreground/20 px-4 py-2 text-sm font-medium"
          >
            고치기
          </Link>
        </div>
        {message && (
          <p role="alert" className="text-sm text-red-600">
            {message}
          </p>
        )}
      </div>
      {below}
    </li>
  );
}
