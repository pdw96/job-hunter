"use client";

import { useState, useTransition } from "react";
import { setConfirmedAction, setRubricClosedAction } from "@/modules/experiences/actions";
import {
  type Kind,
  RUBRIC_ITEM_LABELS,
  RUBRIC_ITEM_QUESTIONS,
  RUBRIC_ITEMS,
  type RubricItem,
  VERIFICATION_LABELS,
} from "@/modules/experiences/options";
import type { StoredRubric } from "@/modules/experiences/schema";
import {
  canClose,
  type ItemStatus,
  requiredItems,
  type VerificationState,
} from "@/modules/experiences/verification";
import { useDirty } from "./dirty";

const STATUS_LABELS: Record<ItemStatus, string> = {
  unjudged: "아직 판정 전",
  met: "충족",
  unmet: "미달",
  closed: "해당 없음으로 닫음",
  na: "적용하지 않음",
};

const STATUS_STYLES: Record<ItemStatus, string> = {
  unjudged: "text-foreground/60",
  met: "text-emerald-700 dark:text-emerald-400",
  unmet: "text-amber-700 dark:text-amber-400",
  closed: "text-foreground/60",
  na: "text-foreground/40",
};

const STATE_HELP: Record<VerificationState, string> = {
  unconfirmed: "아직 내용을 확인하지 않았습니다. 지원서에는 쓰이지 않습니다",
  partial: "확인했지만 필수 항목이 아직 충족되지 않았습니다. 지원서에는 쓰이지 않습니다",
  confirmed: "지원서에 쓸 수 있습니다",
};

type Props = { id: string; kind: Kind; rubric: StoredRubric; isConfirmed: boolean; state: VerificationState };

export function RubricPanel({ id, kind, rubric, isConfirmed, state }: Props) {
  const dirty = useDirty();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const required = requiredItems(kind);
  // 본인 역할·수준은 다음 단계에서 AI가 판정한다
  const waitsForAi = (["role", "level"] as RubricItem[]).some((item) => rubric[item].status === "unjudged");

  function run(action: () => Promise<{ ok: true } | { ok: false; message: string }>) {
    setMessage(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) setMessage(result.message);
    });
  }

  return (
    <aside className="space-y-4 self-start rounded-lg border border-foreground/10 p-4 text-sm" aria-label="검증">
      <h2 className="font-semibold">검증</h2>

      <ul className="space-y-3">
        {RUBRIC_ITEMS.map((item) => {
          const { status, note } = rubric[item];
          return (
            <li key={item} className="space-y-1">
              <div className="flex items-baseline gap-2">
                <span className="font-medium">{RUBRIC_ITEM_LABELS[item]}</span>
                {required.includes(item) && <span className="text-xs text-foreground/50">필수</span>}
                <span className={`ml-auto ${STATUS_STYLES[status]}`}>{STATUS_LABELS[status]}</span>
              </div>
              <p className="text-xs text-foreground/60">{RUBRIC_ITEM_QUESTIONS[item]}</p>
              {note && <p className="text-xs">{note}</p>}
              {canClose(kind, item) && (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => run(() => setRubricClosedAction(id, item, status !== "closed"))}
                  className="text-xs underline disabled:opacity-50"
                >
                  {status === "closed" ? "다시 열기" : "해당 없음으로 닫기"}
                </button>
              )}
            </li>
          );
        })}
      </ul>

      {waitsForAi && (
        <p className="rounded bg-foreground/5 p-2 text-xs text-foreground/70">
          본인 역할과 수준은 다음 단계에서 AI가 확인합니다. 그 전까지는 부분 확인까지만 됩니다
        </p>
      )}

      <div className="space-y-2 border-t border-foreground/10 pt-4">
        <p>
          <span className="font-medium">검증 상태: {VERIFICATION_LABELS[state]}</span>
        </p>
        <p className="text-xs text-foreground/60">{STATE_HELP[state]}</p>
        <button
          type="button"
          disabled={pending || (dirty && !isConfirmed)}
          onClick={() => run(() => setConfirmedAction(id, !isConfirmed))}
          className={`w-full rounded-lg px-3 py-2 font-medium disabled:opacity-50 ${
            isConfirmed ? "border border-foreground/20" : "bg-foreground text-background"
          }`}
        >
          {isConfirmed ? "확인 취소" : "내용이 맞습니다"}
        </button>
        {dirty && !isConfirmed && (
          <p className="text-xs text-foreground/60">저장하지 않은 변경이 있습니다. 먼저 저장해 주세요</p>
        )}
        {message && (
          <p role="alert" className="text-xs text-red-600">
            {message}
          </p>
        )}
      </div>
    </aside>
  );
}
