"use client";

import { useState, useTransition } from "react";
import { answerRecordClaimAction } from "@/modules/experiences/record-actions";
import type { Claim, ClaimKind } from "@/modules/experiences/claims";
import type { ClaimAnswer } from "@/modules/experiences/claims-repo";

const KIND_LABELS: Record<ClaimKind, string> = { period: "기간", metric: "수치", role: "역할 표현" };

// 종류에 따라 고를 수 있는 답. 경력·프로젝트에는 수치 줄이 없어 "숫자 모름"은 수치 주장에만 있다
const ANSWERS: Record<ClaimKind, { answer: ClaimAnswer; label: string }[]> = {
  period: [
    { answer: "confirm", label: "맞음" },
    { answer: "wrong", label: "틀림" },
  ],
  metric: [
    { answer: "confirm", label: "맞음" },
    { answer: "unknown", label: "숫자 모름" },
    { answer: "wrong", label: "틀림" },
  ],
  role: [
    { answer: "confirm", label: "맞음" },
    { answer: "exaggerated", label: "과장임" },
    { answer: "wrong", label: "고칠게요" },
  ],
};

function answersOf(claim: Claim) {
  // 숫자와 과장 낱말이 함께 든 줄은 과장임도 고를 수 있게 한다
  if (claim.kind === "metric" && claim.phrase !== null) {
    return [...ANSWERS.metric.slice(0, 2), { answer: "exaggerated" as const, label: "과장임" }, ...ANSWERS.metric.slice(2)];
  }
  return ANSWERS[claim.kind];
}

// 가져온 경력·프로젝트의 줄마다 답한다. 모두 닫아야 `맞음`을 누를 수 있다
export function HeadClaims({ claims }: { claims: Claim[] }) {
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const open = claims.filter((claim) => claim.status === "pending" || claim.status === "needs_fix");
  if (open.length === 0) return null;

  function answer(claimId: string, value: ClaimAnswer) {
    setMessage(null);
    startTransition(async () => {
      const result = await answerRecordClaimAction(claimId, value);
      if (!result.ok) setMessage(result.message);
    });
  }

  return (
    <div className="space-y-3 rounded-lg bg-amber-600/5 p-3">
      <div className="space-y-0.5">
        <p className="text-sm font-medium text-amber-700 dark:text-amber-400">줄 확인이 남아 있습니다 {open.length}개</p>
        <p className="text-xs text-foreground/60">가져온 담당 업무 줄은 줄마다 확인해야 맞음을 누를 수 있습니다</p>
      </div>
      <ul className="space-y-3">
        {open.map((claim) => (
          <li key={claim.id} className="space-y-2">
            <p className="text-sm">
              <span className="text-foreground/60">{KIND_LABELS[claim.kind]}</span> “{claim.quote}”
            </p>
            {claim.status === "needs_fix" ? (
              <p className="text-xs text-foreground/60">고쳐야 합니다. 고치기에서 이 줄을 실제에 맞게 고쳐 저장하면 닫힙니다</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {answersOf(claim).map(({ answer: value, label }) => (
                  <button
                    key={value}
                    type="button"
                    disabled={pending}
                    onClick={() => answer(claim.id, value)}
                    className={`rounded-lg px-3 py-1.5 text-sm font-medium disabled:opacity-50 ${
                      value === "confirm" ? "bg-foreground text-background" : "border border-foreground/20"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
          </li>
        ))}
      </ul>
      {message && (
        <p role="alert" className="text-sm text-red-600">
          {message}
        </p>
      )}
    </div>
  );
}
