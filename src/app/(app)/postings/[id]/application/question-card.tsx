"use client";

import Link from "next/link";
import { useState } from "react";
import { approveAndWriteAction, deleteQuestionAction, selectAction, updateQuestionAction } from "@/modules/applications/actions";
import { StartInterview } from "../../../experiences/start-interview";
import { DraftView, type DraftData } from "./draft-view";
import { ErrorLine, useRun } from "./use-run";

// 문항 하나의 카드. 서버가 계산한 값(검사 결과, 경험 이름, 수치 개수, 다른 문항에서의 사용)을 그대로 받아 그린다

export type CandidateView = {
  experienceId: string;
  name: string | null; // null이면 지금 쓸 수 없는 경험
  metricCount: number;
  alsoIn: number[]; // 이 경험을 승인한 다른 문항 번호
  overlap?: string;
  role?: string;
  whyNot?: string;
};

export type SelectionView = {
  selectedAt: string;
  picks: CandidateView[];
  passed: CandidateView[];
  noMatch: boolean;
  approvedIds: string[]; // 승인한 경험 id. 승인 전이면 빈 배열
  approvedStale: boolean; // 승인한 경험의 기록이 바뀌었거나 쓸 수 없게 됨
};

export type QuestionView = {
  id: string;
  number: number;
  prompt: string;
  charLimit: number | null;
  countSpaces: boolean;
  selection: SelectionView | null;
  draft: DraftData | null;
};

const UNUSABLE = "(지금 쓸 수 없는 경험)";
const small = "text-sm underline disabled:opacity-50";
const primary = "rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-50";

function Candidate({
  item,
  checked,
  onChange,
}: {
  item: CandidateView;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  const usable = item.name !== null;
  return (
    <li className="space-y-1 py-3">
      <label className="flex items-start gap-2">
        <input
          type="checkbox"
          checked={usable && checked}
          disabled={!usable}
          onChange={(e) => onChange(e.target.checked)}
          className="mt-1"
        />
        <span className="min-w-0 space-y-1 text-sm">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-medium">{item.name ?? UNUSABLE}</span>
            <span className="text-xs text-foreground/60">{item.metricCount > 0 ? `확인된 수치 ${item.metricCount}개` : "수치 없음"}</span>
            {item.alsoIn.length > 0 && (
              <span className="rounded-full border border-foreground/20 px-2 py-0.5 text-xs">
                {item.alsoIn.map((n) => `${n}번`).join(", ")} 문항에도 씀
              </span>
            )}
          </span>
          {item.overlap !== undefined && item.overlap !== "" && (
            <span className="block break-words text-foreground/80">
              <span className="text-foreground/60">겹치는 점 </span>
              {item.overlap}
            </span>
          )}
          {item.role !== undefined && item.role !== "" && (
            <span className="block break-words text-foreground/80">
              <span className="text-foreground/60">본인 역할 </span>
              {item.role}
            </span>
          )}
          {item.whyNot !== undefined && <span className="block break-words text-foreground/80">{item.whyNot}</span>}
        </span>
      </label>
      <p className="pl-6 text-xs">
        <Link href={`/experiences/${item.experienceId}`} className="underline">
          경험 보기
        </Link>
      </p>
    </li>
  );
}

// 고른 결과. selectedAt이 바뀌면(다시 고르면) 체크를 처음으로 돌리려고 key로 새로 만든다
function Picker({
  question,
  selection,
  track,
  hasDraft,
}: {
  question: QuestionView;
  selection: SelectionView;
  track: { id: string; name: string };
  hasDraft: boolean;
}) {
  const initial = selection.approvedIds.length > 0 ? selection.approvedIds : selection.picks.filter((p) => p.name !== null).map((p) => p.experienceId);
  const [checked, setChecked] = useState<string[]>(initial);
  const { message, pending, run } = useRun();

  const toggle = (id: string, on: boolean) => setChecked(on ? [...checked, id] : checked.filter((value) => value !== id));
  const usableChecked = [...selection.picks, ...selection.passed].filter((c) => c.name !== null && checked.includes(c.experienceId));

  function write() {
    if (hasDraft && !confirm("지금 쓴 답을 지우고 다시 씁니다. 직접 고친 문단도 사라집니다. 다시 쓸까요?")) return;
    run(() => approveAndWriteAction(question.id, usableChecked.map((c) => c.experienceId)));
  }

  const writeButton = (
    <div className="flex flex-wrap items-center gap-3">
      <button type="button" disabled={pending || selection.approvedStale || usableChecked.length === 0} onClick={write} className={primary}>
        {pending ? "쓰는 중…" : hasDraft ? "다시 쓰기" : "이 경험으로 쓰기"}
      </button>
      {pending && (
        <span role="status" className="text-sm text-foreground/60">
          1분쯤 걸릴 수 있습니다
        </span>
      )}
    </div>
  );
  const passedList = (
    <ul className="divide-y divide-foreground/10">
      {selection.passed.map((item) => (
        <Candidate key={item.experienceId} item={item} checked={checked.includes(item.experienceId)} onChange={(on) => toggle(item.experienceId, on)} />
      ))}
    </ul>
  );

  if (selection.noMatch) {
    return (
      <div className="space-y-3">
        <div className="space-y-2 rounded-lg bg-foreground/5 p-3">
          <p className="text-sm">이 문항에 맞는 확인된 기록이 없습니다</p>
          <StartInterview tracks={[track]} />
        </div>
        {selection.passed.length > 0 && (
          <div className="space-y-3">
            <p className="text-sm text-foreground/70">그래도 쓰고 싶은 경험이 있으면 직접 고를 수 있습니다</p>
            {passedList}
            {writeButton}
            <ErrorLine message={message} />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {selection.approvedStale && (
        <p role="status" className="text-sm text-amber-700 dark:text-amber-400">
          고른 경험의 기록이 바뀌었습니다. 다시 고르기를 눌러 주세요
        </p>
      )}
      <ul className="divide-y divide-foreground/10 border-y border-foreground/10">
        {selection.picks.map((item) => (
          <Candidate key={item.experienceId} item={item} checked={checked.includes(item.experienceId)} onChange={(on) => toggle(item.experienceId, on)} />
        ))}
      </ul>
      {selection.passed.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-foreground/70">다른 후보 {selection.passed.length}개</summary>
          {passedList}
        </details>
      )}
      {writeButton}
      <ErrorLine message={message} />
    </div>
  );
}

function QuestionEditor({ question, onClose }: { question: QuestionView; onClose: () => void }) {
  const [prompt, setPrompt] = useState(question.prompt);
  const [limit, setLimit] = useState(question.charLimit === null ? "" : String(question.charLimit));
  const [countSpaces, setCountSpaces] = useState(question.countSpaces);
  const { message, pending, run } = useRun();

  return (
    <div className="space-y-2">
      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        rows={4}
        aria-label="문항"
        className="w-full rounded-lg border border-foreground/20 bg-transparent p-3 text-sm"
      />
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <label className="flex items-center gap-2">
          글자 수 제한
          <input
            type="number"
            inputMode="numeric"
            value={limit}
            onChange={(e) => setLimit(e.target.value)}
            placeholder="없음"
            className="w-24 rounded-lg border border-foreground/20 bg-transparent px-2 py-1 text-sm"
          />
          자
        </label>
        <select
          value={countSpaces ? "with" : "without"}
          onChange={(e) => setCountSpaces(e.target.value === "with")}
          aria-label="글자 수 기준"
          className="rounded-lg border border-foreground/20 bg-transparent px-2 py-1 text-sm"
        >
          <option value="with">공백 포함</option>
          <option value="without">공백 제외</option>
        </select>
      </div>
      <p className="text-xs text-foreground/60">문항 글을 고치면 고른 경험은 지워지고 다시 골라야 합니다. 쓴 답은 남습니다</p>
      <div className="flex gap-3">
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            run(() => updateQuestionAction(question.id, { prompt, charLimit: limit === "" ? null : limit, countSpaces }), onClose)
          }
          className="rounded-lg bg-foreground px-3 py-1.5 text-sm font-medium text-background disabled:opacity-50"
        >
          {pending ? "저장 중…" : "저장"}
        </button>
        <button type="button" disabled={pending} onClick={onClose} className={small}>
          취소
        </button>
      </div>
      <ErrorLine message={message} />
    </div>
  );
}

export function QuestionCard({
  question,
  track,
  canAct,
}: {
  question: QuestionView;
  track: { id: string; name: string };
  canAct: boolean; // 지원으로 고른 공고일 때만 고치고 AI를 부를 수 있다
}) {
  const [editing, setEditing] = useState(false);
  const select = useRun();
  const remove = useRun();
  const { selection, draft } = question;

  return (
    <section className="space-y-4 rounded-lg border border-foreground/20 p-4" aria-label={`${question.number}번 문항`}>
      {editing ? (
        <QuestionEditor question={question} onClose={() => setEditing(false)} />
      ) : (
        <div className="space-y-1">
          <p className="whitespace-pre-wrap break-words font-medium">
            <span className="text-foreground/60">{question.number}. </span>
            {question.prompt}
          </p>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="text-sm text-foreground/60">
              {question.charLimit !== null ? `${question.charLimit}자` : "글자 수 제한 없음"} · {question.countSpaces ? "공백 포함" : "공백 제외"}
            </span>
            {canAct && (
              <>
                <button type="button" onClick={() => setEditing(true)} className={small}>
                  고치기
                </button>
                <button
                  type="button"
                  disabled={remove.pending}
                  onClick={() => {
                    if (confirm("이 문항과 쓴 답을 지웁니다. 지울까요?")) remove.run(() => deleteQuestionAction(question.id));
                  }}
                  className={small}
                >
                  지우기
                </button>
              </>
            )}
          </div>
          <ErrorLine message={remove.message} />
        </div>
      )}

      {canAct && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={select.pending}
              onClick={() => select.run(() => selectAction(question.id))}
              className={selection ? small : primary}
            >
              {select.pending ? "경험을 고르는 중…" : selection ? "다시 고르기" : "경험 고르기"}
            </button>
            {select.pending && (
              <span role="status" className="text-sm text-foreground/60">
                1분쯤 걸릴 수 있습니다
              </span>
            )}
          </div>
          <ErrorLine message={select.message} />
          {selection && <Picker key={selection.selectedAt} question={question} selection={selection} track={track} hasDraft={draft !== null} />}
        </div>
      )}

      {draft && <DraftView questionId={question.id} data={draft} canRevise={canAct} />}
    </section>
  );
}
