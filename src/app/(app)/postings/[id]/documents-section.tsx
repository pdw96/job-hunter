"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { chooseDocumentsAction, rereadPostingAction } from "@/modules/applications/document-actions";
import { DOCUMENT_KINDS, DOCUMENT_LABELS, DOCUMENT_WRITER, type DocumentKind } from "@/modules/postings/options";

type Result = { ok: true } | { ok: false; message: string };

const button = "rounded-lg border border-foreground/20 px-4 py-2 text-sm font-medium disabled:opacity-50";
const linkClass = "text-sm underline";

export type DocumentsSectionProps = {
  id: string;
  isApply: boolean;
  locked: boolean;
  // 공고에서 찾은 서류(공고에 적힌 이름 포함). 아직 읽지 않았으면 null
  found: { kind: DocumentKind; label: string }[] | null;
  chosen: DocumentKind[]; // 지금 따르는 서류(고른 것 → 찾은 것 → 기본값)
  userChose: boolean; // 사용자가 직접 골랐는가
  questionCount: number;
};

// 공고 화면의 제출 서류. 지원 공고에서는 낼 서류를 고르고 서류마다 작성 링크를 보인다
export function DocumentsSection({ id, isApply, locked, found, chosen, userChose, questionCount }: DocumentsSectionProps) {
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run(action: () => Promise<Result>) {
    setMessage(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) setMessage(result.message);
    });
  }

  const foundOf = (kind: DocumentKind) => (found ?? []).filter((item) => item.kind === kind).map((item) => item.label);
  // 기타는 찾은 것이 있을 때만 고르게 하고, 공고에 적힌 이름으로 보인다
  const kinds = DOCUMENT_KINDS.filter((kind) => kind !== "other" || foundOf("other").length > 0);
  const nameOf = (kind: DocumentKind) => (kind === "other" ? foundOf("other").join(", ") : DOCUMENT_LABELS[kind]);

  function toggle(kind: DocumentKind) {
    const next = chosen.includes(kind) ? chosen.filter((item) => item !== kind) : [...chosen, kind];
    run(() => chooseDocumentsAction(id, next));
  }

  function reread() {
    if (!window.confirm("AI로 공고를 다시 읽습니다")) return;
    run(() => rereadPostingAction(id));
  }

  const link = (kind: DocumentKind) => {
    if (kind === "cover_letter") {
      return (
        <Link href={`/postings/${id}/application`} className={linkClass}>
          {locked ? "보기" : questionCount > 0 ? `자소서 쓰기 · 문항 ${questionCount}개` : "자소서 쓰기"}
        </Link>
      );
    }
    if (kind === "resume") {
      return (
        <Link href={`/postings/${id}/resume`} className={linkClass}>
          {locked ? "보기" : "이력서 맞춤본"}
        </Link>
      );
    }
    if (DOCUMENT_WRITER[kind] === "ai") return <span className="text-sm text-foreground/60">준비 중</span>;
    return <span className="text-sm text-foreground/60">직접 준비</span>;
  };

  return (
    <section className="space-y-3" aria-label="제출 서류">
      <h2 className="font-semibold">제출 서류</h2>

      {isApply ? (
        <ul className="space-y-2">
          {kinds.map((kind) => {
            const on = chosen.includes(kind);
            return (
              <li key={kind} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                <label className="flex min-w-0 items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={on}
                    // 하나도 고르지 않으면 서버가 기본값으로 보므로 마지막 하나는 끄지 못하게 한다
                    disabled={pending || locked || (on && chosen.length === 1)}
                    onChange={() => toggle(kind)}
                    className="size-4"
                  />
                  <span className="min-w-0 break-words">{nameOf(kind)}</span>
                </label>
                {on && link(kind)}
              </li>
            );
          })}
        </ul>
      ) : (
        found !== null && <p className="text-sm">{found.length > 0 ? found.map((item) => item.label).join(", ") : "공고에 적힌 서류가 없습니다"}</p>
      )}

      {found === null && <p className="text-sm text-foreground/60">아직 공고에서 서류를 읽지 않았습니다</p>}
      {found !== null && found.length === 0 && isApply && !userChose && (
        <p className="text-sm text-foreground/60">공고에 적힌 서류가 없어 이력서·자기소개서를 골랐습니다</p>
      )}

      {!locked && (
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" disabled={pending} onClick={reread} className={button}>
            {pending ? "읽는 중…" : "다시 읽기"}
          </button>
          {pending && (
            <span role="status" className="text-sm text-foreground/60">
              1분쯤 걸릴 수 있습니다
            </span>
          )}
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
