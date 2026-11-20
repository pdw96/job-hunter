"use client";

import { useState, useTransition } from "react";
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

type Result = { ok: true } | { ok: false; message: string };

// 판정, 닫기, 후보 결정, 확인 액션. 사례 화면이 넘겨 준다
export type RubricActions = {
  judge: (id: string) => Promise<Result>;
  setClosed: (id: string, item: RubricItem, closed: boolean) => Promise<Result>;
  decidePhrase: (id: string, phrase: string, approve: boolean) => Promise<Result>;
  setConfirmed: (id: string, confirmed: boolean) => Promise<Result>;
  startInterview?: (id: string) => Promise<Result>; // 없으면 "지금 보완하기"를 보이지 않는다
};

type Props = {
  actions: RubricActions;
  confirmSlot?: React.ReactNode; // 있으면 아직 확인 전일 때 "내용이 맞습니다" 단추 대신 보인다
  id: string;
  kind: Kind;
  rubric: StoredRubric;
  isConfirmed: boolean;
  state: VerificationState;
  phraseCandidates: string[];
  isJudged: boolean;
  claimsOpen?: boolean; // 가져온 기록에 아직 닫지 않은 주장이 있는가
};

export function RubricPanel({
  actions,
  confirmSlot,
  id,
  kind,
  rubric,
  isConfirmed,
  state,
  phraseCandidates,
  isJudged,
  claimsOpen = false,
}: Props) {
  const dirty = useDirty();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const required = requiredItems(kind);
  // 본인 역할·수준은 AI 판정을 받아야 채워진다
  const waitsForAi = (["role", "level"] as RubricItem[]).some((item) => rubric[item].status === "unjudged");
  const hasUnmet = RUBRIC_ITEMS.some((item) => rubric[item].status === "unmet");
  const [busy, setBusy] = useState<"judge" | "interview" | null>(null);

  function run(
    action: () => Promise<{ ok: true } | { ok: false; message: string }>,
    kind: "judge" | "interview" | null = null,
  ) {
    setMessage(null);
    setBusy(kind);
    startTransition(async () => {
      const result = await action();
      // 인터뷰를 시작하면 서버가 인터뷰 화면으로 보내므로 여기로 돌아오지 않는다
      if (result && !result.ok) setMessage(result.message);
      setBusy(null);
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
                  onClick={() => run(() => actions.setClosed(id, item, status !== "closed"))}
                  className="text-xs underline disabled:opacity-50"
                >
                  {status === "closed" ? "다시 열기" : "해당 없음으로 닫기"}
                </button>
              )}
            </li>
          );
        })}
      </ul>

      <div className="space-y-2">
        <button
          type="button"
          disabled={pending || dirty}
          onClick={() => run(() => actions.judge(id), "judge")}
          className="w-full rounded-lg border border-foreground/20 px-3 py-2 font-medium disabled:opacity-50"
        >
          {busy === "judge" ? "판정 중…" : isJudged ? "AI 판정 다시 받기" : "AI 판정 받기"}
        </button>
        {hasUnmet && actions.startInterview && (
          <button
            type="button"
            disabled={pending || dirty}
            onClick={() => run(() => actions.startInterview?.(id) ?? Promise.resolve({ ok: true as const }), "interview")}
            className="w-full rounded-lg border border-foreground/20 px-3 py-2 font-medium disabled:opacity-50"
          >
            {busy === "interview" ? "준비 중…" : "지금 보완하기"}
          </button>
        )}
        <p className="text-xs text-foreground/60">
          {waitsForAi
            ? "본인 역할과 수준은 AI 판정을 받아야 확인됩니다. AI는 내용이 구체적인지만 봅니다"
            : "AI는 내용이 구체적인지만 봅니다. 사실인지는 직접 확인해 주세요"}
        </p>
      </div>

      {phraseCandidates.length > 0 && (
        <div className="space-y-2 border-t border-foreground/10 pt-4">
          <p className="font-medium">과장으로 읽힐 수 있는 표현</p>
          <p className="text-xs text-foreground/60">금지 목록에 넣으면 지원서에 이 표현을 쓰지 않습니다</p>
          <ul className="space-y-2">
            {phraseCandidates.map((phrase) => (
              <li key={phrase} className="space-y-1">
                <p>“{phrase}”</p>
                <div className="flex gap-3 text-xs">
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => run(() => actions.decidePhrase(id, phrase, true))}
                    className="underline disabled:opacity-50"
                  >
                    금지 목록에 넣기
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => run(() => actions.decidePhrase(id, phrase, false))}
                    className="underline disabled:opacity-50"
                  >
                    괜찮아요
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="space-y-2 border-t border-foreground/10 pt-4">
        <p>
          <span className="font-medium">검증 상태: {VERIFICATION_LABELS[state]}</span>
        </p>
        <p className="text-xs text-foreground/60">{STATE_HELP[state]}</p>
        {confirmSlot && !isConfirmed ? (
          confirmSlot
        ) : (
          <button
            type="button"
            disabled={pending || ((dirty || claimsOpen) && !isConfirmed)}
            onClick={() => run(() => actions.setConfirmed(id, !isConfirmed))}
            className={`w-full rounded-lg px-3 py-2 font-medium disabled:opacity-50 ${
              isConfirmed ? "border border-foreground/20" : "bg-foreground text-background"
            }`}
          >
            {isConfirmed ? "확인 취소" : "내용이 맞습니다"}
          </button>
        )}
        {claimsOpen && !isConfirmed && (
          <p className="text-xs text-foreground/60">가져온 내용을 먼저 하나씩 확인해 주세요</p>
        )}
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
