"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { confirmSceneAction } from "@/modules/experiences/record-actions";
import { useDirty } from "../../experiences/dirty";

type Props = {
  sceneId: string;
  headConfirmed: boolean;
  headNoun: string; // 회사 · 프로젝트 · 활동
  headName: string;
  headLines: string[]; // 머리의 짧은 칸
  headHref: string; // 머리 고치기
  claimsOpen: boolean; // 장면의 열린 주장
  headClaimsOpen: boolean; // 머리의 열린 줄
};

// 장면 확인. 머리가 이미 확인됐으면 한 번에 확인하고, 아니면 머리도 맞는지 함께 묻는다
export function ConfirmScene({ sceneId, headConfirmed, headNoun, headName, headLines, headHref, claimsOpen, headClaimsOpen }: Props) {
  const dirty = useDirty();
  const [asking, setAsking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function confirm(withHead: boolean) {
    setMessage(null);
    startTransition(async () => {
      const result = await confirmSceneAction(sceneId, withHead);
      if (!result.ok) setMessage(result.message);
      else setAsking(false);
    });
  }

  const blocked = dirty || claimsOpen;

  return (
    <div className="space-y-3">
      <button
        type="button"
        disabled={pending || blocked}
        onClick={() => (headConfirmed ? confirm(false) : setAsking(true))}
        className="w-full rounded-lg bg-foreground px-3 py-2 font-medium text-background disabled:opacity-50"
      >
        내용이 맞습니다
      </button>
      {claimsOpen && <p className="text-xs text-foreground/60">가져온 내용을 먼저 하나씩 확인해 주세요</p>}
      {dirty && <p className="text-xs text-foreground/60">저장하지 않은 변경이 있습니다. 먼저 저장해 주세요</p>}

      {asking && !headConfirmed && !blocked && (
        <div role="dialog" aria-label={`${headNoun} 정보도 맞나요?`} className="space-y-3 rounded-lg border border-amber-600/40 bg-amber-600/5 p-3">
          <p className="font-medium">{headNoun} 정보도 맞나요?</p>
          <p className="text-xs text-foreground/70">장면 내용이 맞나요? 이 장면을 자소서에 쓰려면 {headNoun} 정보도 확인돼야 합니다.</p>
          <div className="space-y-0.5 rounded-lg bg-background/60 px-3 py-2">
            <p className="font-medium">{headName}</p>
            {headLines.map((line) => (
              <p key={line} className="text-xs text-foreground/70">
                {line}
              </p>
            ))}
          </div>
          {headClaimsOpen && <p className="text-xs text-amber-700 dark:text-amber-400">{headNoun} 정보에 줄 확인이 남아 있습니다. 고치기에서 먼저 확인해 주세요</p>}
          <div className="flex flex-col gap-2">
            <button
              type="button"
              disabled={pending || headClaimsOpen}
              onClick={() => confirm(true)}
              className="rounded-lg bg-foreground px-3 py-2 text-sm font-medium text-background disabled:opacity-50"
            >
              둘 다 맞음
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => confirm(false)}
              className="rounded-lg border border-foreground/20 px-3 py-2 text-sm font-medium disabled:opacity-50"
            >
              장면만 맞음
            </button>
            <Link href={headHref} className="rounded-lg border border-foreground/20 px-3 py-2 text-center text-sm font-medium">
              고치기
            </Link>
          </div>
          <p className="text-xs text-foreground/60">장면만 맞음을 누르면 {headNoun} 정보가 확인될 때까지 자소서에는 쓰이지 않습니다</p>
        </div>
      )}

      {message && (
        <p role="alert" className="text-xs text-red-600">
          {message}
        </p>
      )}
    </div>
  );
}
