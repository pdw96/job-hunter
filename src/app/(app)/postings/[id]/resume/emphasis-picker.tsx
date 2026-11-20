"use client";

import Link from "next/link";
import { type ReactNode, useState } from "react";
import { buildTailoredAction, selectEmphasisAction } from "@/modules/applications/resume-actions";
import { RESUME_LIMITS } from "@/modules/applications/options";
import { ErrorLine, useRun } from "../application/use-run";

// 맞춤본에서 강조할 경험 고르기. AI가 고른 경험(기본 켬)과 나머지 쓸 수 있는 경험(기본 끔)을 체크해 맞춤본을 만든다

// href: 그 기록을 여는 화면. 모르는 기록(옛 기록 등)이면 null이고 이름만 보인다
export type PickView = { experienceId: string; name: string | null; href: string | null; why: string }; // name이 null이면 지금 쓸 수 없는 경험
export type OtherView = { experienceId: string; name: string; href: string | null; summary: boolean; fact: boolean }; // fact: 코드가 쓰는 이력 사실(올려도 줄은 그대로)
export type EmphasisSelectionView = { picks: PickView[]; noMatch: boolean; selectedAt: string };

const small = "text-sm underline disabled:opacity-50";
const primary = "rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-50";
const WAIT = "1분쯤 걸릴 수 있습니다";

function Choice({
  href,
  name,
  checked,
  disabled,
  onChange,
  children,
}: {
  href: string | null;
  name: string | null;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
  children?: ReactNode;
}) {
  return (
    <li className="flex items-start gap-2 py-3">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        aria-label={name ?? "지금 쓸 수 없는 경험"}
        className="mt-1"
      />
      <span className="min-w-0 space-y-1 text-sm">
        {name === null ? (
          <span className="font-medium text-foreground/60">(지금 쓸 수 없는 경험)</span>
        ) : href ? (
          <Link href={href} className="font-medium underline">
            {name}
          </Link>
        ) : (
          <span className="font-medium">{name}</span>
        )}
        {children}
      </span>
    </li>
  );
}

// 고른 결과가 바뀌면(다시 고르면) 체크를 처음으로 돌리려고 key로 새로 만든다
function Checklist({
  postingId,
  selection,
  others,
  tailoredVersion,
  hasTailored,
}: {
  postingId: string;
  selection: EmphasisSelectionView | null;
  others: OtherView[];
  tailoredVersion: number | null;
  hasTailored: boolean;
}) {
  const picks = selection?.picks ?? [];
  const [checked, setChecked] = useState<string[]>(picks.filter((p) => p.name !== null).map((p) => p.experienceId));
  const { message, pending, run } = useRun();
  const full = checked.length >= RESUME_LIMITS.emphasis;
  const toggle = (id: string, on: boolean) => setChecked(on ? [...checked, id] : checked.filter((value) => value !== id));

  function build() {
    if (hasTailored && !confirm("지금 맞춤본을 덮어씁니다. 만들까요?")) return;
    run(() => buildTailoredAction(postingId, checked, tailoredVersion));
  }

  return (
    <div className="space-y-3">
      {selection?.noMatch && (
        <p className="rounded-lg bg-foreground/5 p-3 text-sm">공고에 맞춰 강조할 경험을 찾지 못했습니다. 직접 고르거나 그대로 만들 수 있습니다</p>
      )}
      {picks.length > 0 && (
        <ul className="divide-y divide-foreground/10 border-y border-foreground/10">
          {picks.map((pick) => (
            <Choice
              key={pick.experienceId}
              href={pick.href}
              name={pick.name}
              checked={checked.includes(pick.experienceId)}
              disabled={pick.name === null || (full && !checked.includes(pick.experienceId))}
              onChange={(on) => toggle(pick.experienceId, on)}
            >
              {pick.why !== "" && <span className="block break-words text-foreground/80">{pick.why}</span>}
            </Choice>
          ))}
        </ul>
      )}
      {others.length > 0 && (
        <details className="text-sm" open={selection?.noMatch ?? false}>
          <summary className="cursor-pointer text-foreground/70">다른 경험 {others.length}개</summary>
          <ul className="divide-y divide-foreground/10">
            {others.map((other) => (
              <Choice
                key={other.experienceId}
                href={other.href}
                name={other.name}
                checked={checked.includes(other.experienceId)}
                disabled={full && !checked.includes(other.experienceId)}
                onChange={(on) => toggle(other.experienceId, on)}
              >
                {other.fact ? (
                  <span className="block text-xs text-foreground/60">이력 사실 · 맨 위로만 옮깁니다</span>
                ) : (
                  other.summary && <span className="block text-xs text-foreground/60">요약만 · 직접 올리기</span>
                )}
              </Choice>
            ))}
          </ul>
        </details>
      )}
      {full && <p className="text-xs text-foreground/60">{RESUME_LIMITS.emphasis}개까지 고를 수 있습니다</p>}
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" disabled={pending} onClick={build} className={primary}>
          {pending ? "만드는 중…" : checked.length > 0 ? "이 경험을 강조해 맞춤본 만들기" : "공통본 그대로 맞춤본 만들기"}
        </button>
        {pending && checked.length > 0 && (
          <span role="status" className="text-sm text-foreground/60">
            {WAIT}
          </span>
        )}
      </div>
      <ErrorLine message={message} />
    </div>
  );
}

export function EmphasisPicker({
  postingId,
  selection,
  others,
  tailoredVersion,
  hasTailored,
}: {
  postingId: string;
  selection: EmphasisSelectionView | null;
  others: OtherView[];
  tailoredVersion: number | null; // 맞춤본 행이 있으면 그 version(고르기만 한 행 포함), 없으면 null
  hasTailored: boolean; // 맞춤본 내용이 있다
}) {
  const select = useRun();

  return (
    <section className="space-y-3 rounded-lg border border-foreground/20 p-4" aria-label="강조할 경험">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={select.pending}
          onClick={() => select.run(() => selectEmphasisAction(postingId))}
          className={selection ? small : primary}
        >
          {select.pending ? "고르는 중…" : selection ? "다시 고르기" : "강조할 경험 고르기"}
        </button>
        {select.pending && (
          <span role="status" className="text-sm text-foreground/60">
            {WAIT}
          </span>
        )}
      </div>
      <ErrorLine message={select.message} />
      <Checklist
        key={selection?.selectedAt ?? "none"}
        postingId={postingId}
        selection={selection}
        others={others}
        tailoredVersion={tailoredVersion}
        hasTailored={hasTailored}
      />
    </section>
  );
}
