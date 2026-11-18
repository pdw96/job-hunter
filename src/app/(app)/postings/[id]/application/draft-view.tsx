"use client";

import { useState } from "react";
import { editParagraphAction, reviseAction } from "@/modules/applications/actions";
import { answerText, type DraftCheck, type ParagraphCheck } from "@/modules/applications/check";
import type { Draft } from "@/modules/applications/types";
import { ErrorLine, useRun } from "./use-run";

// 쓴 답. 문단마다 근거와 검사 결과를 보이고, 그 자리에서 고친다. 검사 결과와 이름은 서버가 그릴 때 계산해 넘긴다

export type DraftData = {
  draft: Draft;
  check: DraftCheck;
  names: Record<string, string>; // 경험 id → 이름. 지금 쓸 수 없는 경험은 들어 있지 않다
  limit: number | null;
  countSpaces: boolean;
};

const small = "text-sm underline disabled:opacity-50";
const PRESETS = [
  { id: "shorter", label: "더 짧게" },
  { id: "concrete", label: "더 구체적으로" },
  { id: "natural", label: "더 자연스럽게" },
] as const;

function problems(check: ParagraphCheck): string[] {
  const lines: string[] = [];
  if (check.banned.length > 0) lines.push(`쓰면 안 되는 표현: ${check.banned.join(", ")}`);
  if (check.ungrounded.length > 0) lines.push(`기록에 없는 숫자: ${check.ungrounded.join(", ")}`);
  if (check.noSource) lines.push("근거 경험이 없습니다");
  if (check.staleSource) lines.push("근거 경험의 기록이 바뀌었습니다");
  return lines;
}

function ParagraphView({
  questionId,
  index,
  data,
  canRevise,
}: {
  questionId: string;
  index: number;
  data: DraftData;
  canRevise: boolean;
}) {
  const paragraph = data.draft.paragraphs[index];
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(paragraph.text);
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState("");
  const { message, pending, run } = useRun();
  const lines = problems(data.check.paragraphs[index]);

  const names = paragraph.sources.map((id) => data.names[id] ?? "(지금 쓸 수 없는 경험)");

  return (
    <li className="space-y-2 py-3">
      {editing ? (
        <div className="space-y-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={6}
            aria-label={`${index + 1}번째 문단`}
            className="w-full rounded-lg border border-foreground/20 bg-transparent p-3 text-sm"
          />
          <div className="flex gap-3">
            <button
              type="button"
              disabled={pending}
              onClick={() => run(() => editParagraphAction(questionId, index, text, data.draft), () => setEditing(false))}
              className="rounded-lg bg-foreground px-3 py-1.5 text-sm font-medium text-background disabled:opacity-50"
            >
              {pending ? "저장 중…" : "저장"}
            </button>
            <button type="button" disabled={pending} onClick={() => setEditing(false)} className={small}>
              취소
            </button>
          </div>
          <p className="text-xs text-foreground/60">글을 모두 지우고 저장하면 이 문단이 빠집니다</p>
        </div>
      ) : (
        <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{paragraph.text}</p>
      )}

      <p className="text-xs text-foreground/60">{paragraph.edited ? "직접 수정" : names.length > 0 ? `근거: ${names.join(", ")}` : ""}</p>
      {lines.map((line) => (
        <p key={line} className="text-xs text-red-600">
          {line}
        </p>
      ))}

      {!editing && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              setText(paragraph.text);
              setEditing(true);
            }}
            className={small}
          >
            고치기
          </button>
          {canRevise && (
            <>
              {PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  disabled={pending}
                  onClick={() => run(() => reviseAction(questionId, index, preset.id, "", data.draft))}
                  className={small}
                >
                  {preset.label}
                </button>
              ))}
              <button type="button" disabled={pending} onClick={() => setAsking(!asking)} className={small}>
                요청 적기
              </button>
            </>
          )}
          {pending && (
            <span role="status" className="text-xs text-foreground/60">
              고치는 중…
            </span>
          )}
        </div>
      )}
      {asking && !editing && canRevise && (
        <div className="flex flex-wrap gap-2">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={200}
            placeholder="어떻게 고칠지 짧게"
            aria-label="고칠 방향"
            className="min-w-0 flex-1 rounded-lg border border-foreground/20 bg-transparent px-3 py-1.5 text-sm"
          />
          <button
            type="button"
            disabled={pending || note.trim() === ""}
            onClick={() =>
              run(() => reviseAction(questionId, index, null, note, data.draft), () => {
                setAsking(false);
                setNote("");
              })
            }
            className="rounded-lg border border-foreground/20 px-3 py-1.5 text-sm disabled:opacity-50"
          >
            고쳐 쓰기
          </button>
        </div>
      )}
      <ErrorLine message={message} />
    </li>
  );
}

export function DraftView({ questionId, data, canRevise }: { questionId: string; data: DraftData; canRevise: boolean }) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const { length } = data.check;
  const basis = data.countSpaces ? "공백 포함" : "공백 제외";

  async function copy() {
    setCopyError(false);
    try {
      await navigator.clipboard.writeText(answerText(data.draft));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopyError(true);
    }
  }

  return (
    <div className="space-y-2">
      <ul className="divide-y divide-foreground/10 border-y border-foreground/10">
        {data.draft.paragraphs.map((_, index) => (
          <ParagraphView
            key={`${data.draft.writtenAt}-${index}-${data.draft.paragraphs.length}`}
            questionId={questionId}
            index={index}
            data={data}
            canRevise={canRevise}
          />
        ))}
      </ul>
      <p className={`text-sm ${length.over ? "font-medium text-red-600" : ""}`}>
        {length.limit !== null ? `${length.count} / ${length.limit}자` : `${length.count}자`} ({basis})
      </p>
      {data.draft.shortage && <p className="text-sm text-amber-700 dark:text-amber-400">기록이 모자란 점: {data.draft.shortage}</p>}
      {data.check.questionChanged && <p className="text-sm text-amber-700 dark:text-amber-400">문항을 고친 뒤 쓴 답입니다. 다시 쓰기를 권합니다</p>}
      <div className="flex items-center gap-3">
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
    </div>
  );
}
