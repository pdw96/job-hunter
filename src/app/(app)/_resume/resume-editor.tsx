"use client";

import { useState } from "react";
import { editResumeAction, rewriteEntriesAction } from "@/modules/applications/resume-actions";
import { RESUME_LIMITS } from "@/modules/applications/options";
import type { EntryCheck } from "@/modules/applications/resume-check";
import { ErrorLine, useRun } from "../postings/[id]/application/use-run";
import type { EditorData, EntryView } from "./editor-data";

// 이력서 공통본·맞춤본이 함께 쓰는 편집 화면. 검사 결과와 섹션은 서버가 그릴 때 계산해 넘긴다

const small = "text-sm underline disabled:opacity-50";
const primary = "rounded-lg bg-foreground px-3 py-1.5 text-sm font-medium text-background disabled:opacity-50";
const WAIT = "1분쯤 걸릴 수 있습니다";
const OVERWRITE = "직접 고친 줄이 덮어써집니다. 다시 쓸까요?";

function problems(check: EntryCheck): string[] {
  if (check.unavailable) return ["이 경험은 지금 쓸 수 없습니다(확인 풀림, 제외, 지움). 빼 주세요"];
  const lines: string[] = [];
  if (check.stale) lines.push("경험 기록이 바뀌었습니다. 다시 쓰기를 권합니다");
  if (check.scopeChanged) lines.push("트랙의 사용 범위가 바뀌었습니다. 다시 쓰기를 권합니다");
  if (check.banned.length > 0) lines.push(`쓰면 안 되는 표현: ${check.banned.join(", ")}`);
  if (check.ungrounded.length > 0) lines.push(`기록에 없는 숫자: ${check.ungrounded.join(", ")}`);
  return lines;
}

// 화면에서 먼저 줄 수와 길이를 본다. 서버도 같은 한도로 다시 본다
function linesProblem(text: string): string | null {
  const lines = text.split(/\r?\n/u).map((line) => line.trim()).filter((line) => line !== "");
  if (lines.length > RESUME_LIMITS.editLines) return `줄은 ${RESUME_LIMITS.editLines}개까지 쓸 수 있습니다`;
  if (lines.some((line) => [...line].length > RESUME_LIMITS.line)) return `한 줄은 ${RESUME_LIMITS.line}자까지 쓸 수 있습니다`;
  return null;
}

function EntryCard({
  data,
  view,
  first,
  last,
  readOnly,
}: {
  data: EditorData;
  view: EntryView;
  first: boolean; // 섹션의 맨 위
  last: boolean; // 섹션의 맨 아래
  readOnly: boolean;
}) {
  const { entry, check } = view;
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const edit = useRun();
  const rewrite = useRun();
  const pending = edit.pending || rewrite.pending;
  const lines = problems(check);
  const recommend = !check.unavailable && (check.stale || check.scopeChanged);
  const heading = [entry.heading.name, entry.heading.organization, entry.heading.role, entry.heading.period].filter(Boolean).join(" · ");

  function save() {
    const problem = linesProblem(text);
    setLocalError(problem);
    if (problem) return;
    edit.run(() => editResumeAction(data.resumeId, { type: "lines", experienceId: entry.experienceId, text }, data.version), () => setEditing(false));
  }

  function rewriteOne() {
    if (entry.lines.some((line) => line.edited) && !confirm(OVERWRITE)) return;
    rewrite.run(() => rewriteEntriesAction(data.resumeId, [entry.experienceId], data.version));
  }

  return (
    <li className="space-y-2 py-3" aria-label={entry.heading.name}>
      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-0 break-words font-medium">{heading}</p>
        {entry.detail === "summary" && <span className="rounded-full border border-foreground/20 px-2 py-0.5 text-xs">요약</span>}
        {entry.emphasized && <span className="rounded-full bg-foreground px-2 py-0.5 text-xs text-background">강조</span>}
      </div>

      {editing ? (
        <div className="space-y-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={Math.max(3, entry.lines.length + 1)}
            aria-label={`${entry.heading.name} 줄`}
            className="w-full rounded-lg border border-foreground/20 bg-transparent p-3 text-sm"
          />
          <p className="text-xs text-foreground/60">
            한 줄에 한 줄씩 씁니다. {RESUME_LIMITS.editLines}줄, 한 줄 {RESUME_LIMITS.line}자까지
          </p>
          <div className="flex gap-3">
            <button type="button" disabled={pending} onClick={save} className={primary}>
              {edit.pending ? "저장 중…" : "저장"}
            </button>
            <button type="button" disabled={pending} onClick={() => setEditing(false)} className={small}>
              취소
            </button>
          </div>
          <ErrorLine message={localError} />
        </div>
      ) : (
        entry.lines.length > 0 && (
          <ul className="list-disc space-y-1 pl-5 text-sm leading-relaxed">
            {entry.lines.map((line, index) => (
              <li key={index} className="break-words">
                {line.text}
                {line.edited && <span className="ml-2 text-xs text-foreground/50">직접 수정</span>}
              </li>
            ))}
          </ul>
        )
      )}

      {lines.map((line) => (
        <p key={line} className="text-xs text-red-600">
          {line}
        </p>
      ))}

      {!readOnly && !editing && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              setText(entry.lines.map((line) => line.text).join("\n"));
              setLocalError(null);
              setEditing(true);
            }}
            className={small}
          >
            고치기
          </button>
          <button
            type="button"
            disabled={pending || first}
            onClick={() => edit.run(() => editResumeAction(data.resumeId, { type: "move", experienceId: entry.experienceId, direction: "up" }, data.version))}
            className={small}
          >
            위로
          </button>
          <button
            type="button"
            disabled={pending || last}
            onClick={() => edit.run(() => editResumeAction(data.resumeId, { type: "move", experienceId: entry.experienceId, direction: "down" }, data.version))}
            className={small}
          >
            아래로
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => edit.run(() => editResumeAction(data.resumeId, { type: "remove", experienceId: entry.experienceId }, data.version))}
            className={small}
          >
            빼기
          </button>
          {!check.unavailable && (
            <button
              type="button"
              disabled={pending}
              onClick={rewriteOne}
              className={recommend ? "rounded-lg border border-red-600 px-3 py-1 text-sm font-medium text-red-600 disabled:opacity-50" : small}
            >
              {rewrite.pending ? "다시 쓰는 중…" : "다시 쓰기"}
            </button>
          )}
          {rewrite.pending && (
            <span role="status" className="text-sm text-foreground/60">
              {WAIT}
            </span>
          )}
        </div>
      )}
      <ErrorLine message={edit.message ?? rewrite.message} />
    </li>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);

  async function copy() {
    setCopyError(false);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopyError(true);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button type="button" onClick={copy} className="rounded-lg border border-foreground/20 px-3 py-1.5 text-sm">
        복사
      </button>
      {copied && (
        <span role="status" className="text-sm text-foreground/60">
          복사했습니다
        </span>
      )}
      {copyError && (
        <span role="alert" className="text-sm text-red-600">
          복사하지 못했습니다. 글을 직접 선택해 복사해 주세요
        </span>
      )}
    </div>
  );
}

export function ResumeEditor({
  data,
  readOnly,
  tailored,
}: {
  data: EditorData;
  readOnly: boolean; // 맞춤본인데 지원이 아니면 버튼을 숨기고 복사만 둔다
  tailored: boolean;
}) {
  const add = useRun();
  const all = useRun();
  const usable = data.sections.flatMap((section) => section.entries.filter((view) => !view.check.unavailable));
  const empty = data.sections.length === 0;

  function rewriteAll() {
    const edited = usable.some((view) => view.entry.lines.some((line) => line.edited));
    const question = `쓸 수 있는 항목 ${usable.length}개를 모두 다시 씁니다.${edited ? " 직접 고친 줄이 덮어써집니다." : ""} 다시 쓸까요?`;
    if (!confirm(question)) return;
    all.run(() => rewriteEntriesAction(data.resumeId, usable.map((view) => view.entry.experienceId), data.version));
  }

  return (
    <section className="space-y-4" aria-label={tailored ? "이력서 맞춤본" : "이력서 공통본"}>
      {!readOnly && data.missing.length > 0 && (
        <div className="space-y-2 rounded-lg bg-foreground/5 p-3">
          <p className="text-sm">
            넣을 수 있는 경험 {data.missing.length}개: {data.missing.map((item) => item.name).join(", ")}
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={add.pending}
              onClick={() => add.run(() => rewriteEntriesAction(data.resumeId, data.missing.map((item) => item.id), data.version))}
              className={primary}
            >
              {add.pending ? "넣는 중…" : "넣기"}
            </button>
            {add.pending && (
              <span role="status" className="text-sm text-foreground/60">
                {WAIT}
              </span>
            )}
          </div>
          <ErrorLine message={add.message} />
        </div>
      )}
      {data.commonChanged && (
        <p className="text-sm text-amber-700 dark:text-amber-400">공통본을 고친 뒤입니다. 다시 만들면 고친 공통본에서 출발합니다</p>
      )}
      <CopyButton text={data.copyText} />

      {empty ? (
        <p className="text-sm text-foreground/70">이력서에 남은 항목이 없습니다</p>
      ) : (
        data.sections.map((section) => (
          <div key={section.kind} className="space-y-1">
            <h2 className="text-lg font-semibold">{section.label}</h2>
            <ul className="divide-y divide-foreground/10 border-y border-foreground/10">
              {section.entries.map((view, index) => (
                <EntryCard
                  key={view.entry.experienceId}
                  data={data}
                  view={view}
                  first={index === 0}
                  last={index === section.entries.length - 1}
                  readOnly={readOnly}
                />
              ))}
            </ul>
          </div>
        ))
      )}

      {!readOnly && usable.length > 0 && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" disabled={all.pending} onClick={rewriteAll} className={small}>
              {all.pending ? "모두 다시 쓰는 중…" : "모두 다시 쓰기"}
            </button>
            {all.pending && (
              <span role="status" className="text-sm text-foreground/60">
                {WAIT}
              </span>
            )}
          </div>
          <ErrorLine message={all.message} />
        </div>
      )}
    </section>
  );
}
