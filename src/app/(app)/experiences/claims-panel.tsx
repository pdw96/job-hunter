"use client";

import { useState, useTransition } from "react";
import { answerClaimAction, startInterviewAction } from "@/modules/experiences/actions";
import type { Claim, ClaimKind } from "@/modules/experiences/claims";
import type { ClaimAnswer } from "@/modules/experiences/claims-repo";
import { useDirty } from "./dirty";

const KIND_LABELS: Record<ClaimKind, string> = { period: "기간", metric: "수치", role: "역할 표현" };
const KIND_QUESTIONS: Record<ClaimKind, string> = {
  period: "이 기간이 맞나요?",
  metric: "이 수치가 실제로 맞고, 근거를 댈 수 있나요?",
  role: "실제로 한 일보다 크게 적혀 있지 않나요?",
};

// 종류에 따라 고를 수 있는 답
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

// 가져온 기록의 주장을 하나씩 확인한다. 모두 닫아야 기록을 확인할 수 있다
export function ClaimsPanel({ experienceId, claims }: { experienceId: string; claims: Claim[] }) {
  const dirty = useDirty();
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const pendingClaims = claims.filter((claim) => claim.status === "pending");
  const toFix = claims.filter((claim) => claim.status === "needs_fix");
  const closed = claims.length - pendingClaims.length - toFix.length;
  const current = pendingClaims[0];
  // 숫자와 과장 낱말이 함께 든 문장은 한 번에 묻고, 과장임도 고를 수 있게 한다
  const mixed = current?.kind === "metric" && current.phrase !== null;
  const answers = !current
    ? []
    : mixed
      ? [...ANSWERS.metric.slice(0, 2), { answer: "exaggerated" as const, label: "과장임" }, ...ANSWERS.metric.slice(2)]
      : ANSWERS[current.kind];

  if (claims.length === 0 || (pendingClaims.length === 0 && toFix.length === 0)) return null;

  function run(action: () => Promise<{ ok: true } | { ok: false; message: string }>) {
    setMessage(null);
    startTransition(async () => {
      const result = await action();
      if (result && !result.ok) setMessage(result.message);
    });
  }

  return (
    <section className="space-y-4 rounded-lg border border-amber-600/40 p-4" aria-label="확인할 주장">
      <div className="space-y-1">
        <h2 className="font-semibold">가져온 내용 확인</h2>
        <p className="text-sm text-foreground/70">
          가져온 글은 실제보다 부풀려져 있을 수 있습니다. 하나씩 확인해 주세요. {claims.length}개 중 {closed}개 확인
        </p>
      </div>

      {current && (
        <div className="space-y-3 rounded-lg bg-foreground/5 p-4">
          <p className="text-xs text-foreground/60">
            {KIND_LABELS[current.kind]} · {KIND_QUESTIONS[current.kind]}
            {mixed && ` “${current.phrase}”처럼 역할이 크게 적혀 있지는 않나요?`}
          </p>
          <p className="text-lg">“{current.quote}”</p>
          <div className="flex flex-wrap gap-2">
            {answers.map(({ answer, label }) => (
              <button
                key={answer}
                type="button"
                disabled={pending || dirty}
                onClick={() => run(() => answerClaimAction(experienceId, current.id, answer))}
                className={`rounded-lg px-4 py-2 font-medium disabled:opacity-50 ${
                  answer === "confirm" ? "bg-foreground text-background" : "border border-foreground/20"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          {dirty && <p className="text-xs text-foreground/60">저장하지 않은 변경이 있습니다. 먼저 저장해 주세요</p>}
        </div>
      )}

      {toFix.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium">고쳐야 할 것 {toFix.length}개</h3>
          <ul className="space-y-1 text-sm">
            {toFix.map((claim) => (
              <li key={claim.id}>
                <span className="text-foreground/60">{KIND_LABELS[claim.kind]}</span> “{claim.quote}”
              </li>
            ))}
          </ul>
          <p className="text-xs text-foreground/60">
            아래 입력 칸에서 이 구절을 실제에 맞게 고쳐 저장하면 닫힙니다. 직접 쓰기 번거로우면 인터뷰로 답해도 됩니다
          </p>
          <button
            type="button"
            disabled={pending || dirty}
            onClick={() => run(() => startInterviewAction({ experienceId }))}
            className="rounded-lg border border-foreground/20 px-3 py-2 text-sm font-medium disabled:opacity-50"
          >
            인터뷰로 고치기
          </button>
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
