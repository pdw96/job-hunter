"use client";

import Link from "next/link";
import { useState } from "react";
import {
  approveAndWriteAction,
  deleteQuestionAction,
  selectAction,
  setQuestionKindsAction,
  updateQuestionAction,
  writeManuallyAction,
} from "@/modules/applications/actions";
import { countChars } from "@/modules/applications/check";
import { unansweredKinds } from "@/modules/applications/kinds";
import { type AnswerTopic, APPLICATION_LIMITS, QUESTION_KIND_LABELS, QUESTION_KINDS, type QuestionKind } from "@/modules/applications/options";
import type { Asks } from "@/modules/applications/types";
import { AddRecordLink } from "../../../records/_shared/add-record-link";
import { AnswerSection } from "./answer-section";
import { type AnswerView, wantsExperience, writePlan } from "./answer-view";
import { DraftView, type DraftData } from "./draft-view";
import { ErrorLine, useRun } from "./use-run";

// 문항 하나의 카드. 서버가 계산한 값(검사 결과, 경험 이름, 수치 개수, 다른 문항에서의 사용)을 그대로 받아 그린다

export type CandidateView = {
  experienceId: string;
  name: string | null; // null이면 지금 쓸 수 없는 경험
  href: string | null; // 그 기록을 여는 화면. 모르는 기록(옛 기록 등)이면 null
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
  kinds: QuestionKind[] | null; // 아직 정하지 않았으면 null
  topics: AnswerTopic[]; // 물을 수 있는 주제(경험형만이면 빈 배열)
  answers: AnswerView[]; // 붙인 답
  asks: Asks | null; // 받아 둔 질문
  selection: SelectionView | null;
  draft: DraftData | null;
};

const UNUSABLE = "(지금 쓸 수 없는 경험)";
const small = "text-sm underline disabled:opacity-50";
const primary = "rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-50";
const reselectStyle = "rounded-lg border border-red-600 px-3 py-1 text-sm font-medium text-red-600 disabled:opacity-50";

function Candidate({
  item,
  checked,
  full,
  onChange,
}: {
  item: CandidateView;
  checked: boolean;
  full: boolean; // 5개를 다 골랐다. 체크 안 된 것은 더 고르지 못한다
  onChange: (checked: boolean) => void;
}) {
  const usable = item.name !== null;
  return (
    <li className="space-y-1 py-3">
      <label className="flex items-start gap-2">
        <input
          type="checkbox"
          checked={usable && checked}
          disabled={!usable || (full && !checked)}
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
      {item.href && (
        <p className="pl-6 text-xs">
          <Link href={item.href} className="underline">
            경험 보기
          </Link>
        </p>
      )}
    </li>
  );
}

// 고른 결과. 체크 상태는 카드가 들고 있고, 다시 고르면(selectedAt이 바뀌면) 카드가 처음으로 돌린다
function Picker({
  question,
  selection,
  hasDraft,
  checked,
  setChecked,
  canWrite,
  needAnswers,
}: {
  question: QuestionView;
  selection: SelectionView;
  hasDraft: boolean;
  checked: string[]; // 카드가 들고 있다(경험형이 없는 문항은 답 구역의 쓰기 단추가 이 값을 쓴다)
  setChecked: (ids: string[]) => void;
  canWrite: boolean; // writePlan의 판단(고른 경험, 바뀐 기록, 유형마다의 답)
  needAnswers: boolean; // 동기포부형·자기소개형 쪽 답이 아직 없다
}) {
  // 경험형이 아닌 문항(동기포부형·자기소개형만)은 "맞는 기록이 없다"고 알리지 않고, 쓰기 단추는 답 구역에 있다
  const wants = wantsExperience(question.kinds);
  const { message, pending, run } = useRun();

  const toggle = (id: string, on: boolean) => setChecked(on ? [...checked, id] : checked.filter((value) => value !== id));
  const usableChecked = [...selection.picks, ...selection.passed].filter((c) => c.name !== null && checked.includes(c.experienceId));

  const full = usableChecked.length >= APPLICATION_LIMITS.approved;

  function write() {
    if (hasDraft && !confirm("지금 쓴 답을 지우고 다시 씁니다. 직접 고친 문단도 사라집니다. 다시 쓸까요?")) return;
    run(() => approveAndWriteAction(question.id, usableChecked.map((c) => c.experienceId)));
  }

  const writeButton = !wants ? null : (
    <div className="flex flex-wrap items-center gap-3">
      {full && <span className="w-full text-xs text-foreground/60">{APPLICATION_LIMITS.approved}개까지 고를 수 있습니다</span>}
      {needAnswers && <span className="w-full text-xs text-foreground/60">먼저 &apos;내 답&apos;의 질문에 답해 주세요</span>}
      <button type="button" disabled={pending || !canWrite} onClick={write} className={primary}>
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
        <Candidate key={item.experienceId} item={item} checked={checked.includes(item.experienceId)} full={full} onChange={(on) => toggle(item.experienceId, on)} />
      ))}
    </ul>
  );

  const staleHint = selection.approvedStale && (
    <p role="status" className="text-sm text-amber-700 dark:text-amber-400">
      고른 경험의 기록이 바뀌었습니다. 다시 고르기를 눌러 주세요
    </p>
  );

  if (selection.noMatch) {
    return (
      <div className="space-y-3">
        {staleHint}
        {wants && (
          <div className="space-y-2 rounded-lg bg-foreground/5 p-3">
            <p className="text-sm">이 문항에 맞는 확인된 기록이 없습니다</p>
            <AddRecordLink href="/records/scenes/new" label="경험 사례 추가" />
          </div>
        )}
        {!wants && selection.passed.length === 0 && <p className="text-sm text-foreground/70">이어지는 경험이 없습니다</p>}
        {selection.passed.length > 0 && (
          <div className="space-y-3">
            <p className="text-sm text-foreground/70">{wants ? "그래도 쓰고 싶은 경험이 있으면 직접 고를 수 있습니다" : "이어지는 경험이 있으면 고를 수 있습니다"}</p>
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
      {staleHint}
      <ul className="divide-y divide-foreground/10 border-y border-foreground/10">
        {selection.picks.map((item) => (
          <Candidate key={item.experienceId} item={item} checked={checked.includes(item.experienceId)} full={full} onChange={(on) => toggle(item.experienceId, on)} />
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

// 문항 유형. 하나 이상 켜 둔다(마지막 하나는 끌 수 없다)
function KindChips({ question, canAct }: { question: QuestionView; canAct: boolean }) {
  const { message, pending, run } = useRun();
  const kinds = question.kinds;
  if (kinds === null) return <p className="text-sm text-foreground/60">유형은 경험 고르기 때 정합니다</p>;

  const toggle = (kind: QuestionKind) => {
    const on = kinds.includes(kind);
    if (on && kinds.length === 1) return;
    const next = QUESTION_KINDS.filter((k) => (k === kind ? !on : kinds.includes(k)));
    run(() => setQuestionKindsAction(question.id, next));
  };
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-foreground/60">유형:</span>
        {QUESTION_KINDS.map((kind) => {
          const on = kinds.includes(kind);
          return (
            <button
              key={kind}
              type="button"
              aria-pressed={on}
              disabled={!canAct || pending}
              onClick={() => toggle(kind)}
              className={`rounded-full border px-3 py-1 text-sm disabled:opacity-60 ${on ? "border-foreground bg-foreground text-background" : "border-foreground/30"}`}
            >
              {QUESTION_KIND_LABELS[kind]}
            </button>
          );
        })}
      </div>
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

// 답이 아직 없을 때 AI 없이 직접 쓴다. 빈 줄로 문단을 나눈다
function ManualWrite({ question }: { question: QuestionView }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const { message, pending, run } = useRun();
  const count = countChars(text.trim(), question.countSpaces);
  const over = question.charLimit !== null && count > question.charLimit;
  const basis = question.countSpaces ? "공백 포함" : "공백 제외";

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={small}>
        직접 쓰기
      </button>
    );
  }
  return (
    <div className="space-y-2">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={10}
        aria-label="직접 쓴 답"
        className="w-full rounded-lg border border-foreground/20 bg-transparent p-3 text-sm"
      />
      <p className="text-xs text-foreground/60">빈 줄로 문단을 나눕니다</p>
      <p className={`text-sm ${over ? "font-medium text-red-600" : ""}`}>
        {question.charLimit !== null ? `${count} / ${question.charLimit}자` : `${count}자`} ({basis})
      </p>
      <div className="flex gap-3">
        <button type="button" disabled={pending || text.trim() === ""} onClick={() => run(() => writeManuallyAction(question.id, text))} className={primary}>
          {pending ? "저장 중…" : "저장"}
        </button>
        <button type="button" disabled={pending} onClick={() => setOpen(false)} className={small}>
          취소
        </button>
      </div>
      <ErrorLine message={message} />
    </div>
  );
}

export function QuestionCard({
  question,
  canAct,
}: {
  question: QuestionView;
  canAct: boolean; // 지원으로 고른 공고일 때만 고치고 AI를 부를 수 있다
}) {
  const [editing, setEditing] = useState(false);
  const select = useRun();
  const remove = useRun();
  const { selection, draft } = question;
  // 고른 경험. 다시 고르면(selectedAt이 바뀌면) 처음으로 돌린다
  const initialChecked = selection
    ? selection.approvedIds.length > 0
      ? selection.approvedIds
      : selection.picks.filter((p) => p.name !== null).map((p) => p.experienceId)
    : [];
  const [checkedState, setCheckedState] = useState({ at: selection?.selectedAt ?? null, ids: initialChecked });
  let checked = checkedState.ids;
  if (checkedState.at !== (selection?.selectedAt ?? null)) {
    checked = initialChecked;
    setCheckedState({ at: selection?.selectedAt ?? null, ids: initialChecked });
  }
  const setChecked = (ids: string[]) => setCheckedState({ at: selection?.selectedAt ?? null, ids });
  const usableChecked = selection ? [...selection.picks, ...selection.passed].filter((c) => c.name !== null && checked.includes(c.experienceId)).map((c) => c.experienceId) : [];
  const empty = draft === null || draft.draft.paragraphs.length === 0; // 문단을 다 지운 답은 답이 없는 것으로 본다
  // 근거가 옛 기록인 문단이 있으면 다시 고르기를 눈에 띄게 한다(문단마다 단추를 두지 않고 문항에 하나만)
  const wants = wantsExperience(question.kinds); // 경험형이 없으면 경험 고르기는 답 구역 아래의 선택 사항이다
  const answerTopics = question.answers.map((answer) => answer.topic);
  const plan = writePlan({ kinds: question.kinds, answerTopics, checked: usableChecked, hasSelection: !!selection, approvedStale: !!selection?.approvedStale });
  const needAnswers = unansweredKinds(question.kinds, answerTopics).length > 0;
  const structureChanged = !empty && draft.check.paragraphs.some((paragraph) => paragraph.structureChanged);

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

      <KindChips question={question} canAct={canAct} />

      {canAct && wants && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={select.pending}
              onClick={() => select.run(() => selectAction(question.id))}
              className={structureChanged ? reselectStyle : selection ? small : primary}
            >
              {select.pending ? "경험을 고르는 중…" : selection ? "다시 고르기" : "경험 고르기"}
            </button>
            {select.pending && (
              <span role="status" className="text-sm text-foreground/60">
                1분쯤 걸릴 수 있습니다
              </span>
            )}
          </div>
          {structureChanged && (
            <p className="text-sm text-red-600">기록 구조가 바뀌어 답을 다시 만들어야 합니다. 다시 고르기를 누른 뒤 다시 써 주세요</p>
          )}
          <ErrorLine message={select.message} />
          {empty && <ManualWrite question={question} />}
          {selection && <Picker question={question} selection={selection} hasDraft={!empty} checked={checked} setChecked={setChecked} canWrite={plan.enabled} needAnswers={needAnswers} />}
        </div>
      )}

      {question.topics.length > 0 && (
        <AnswerSection
          questionId={question.id}
          topics={question.topics}
          answers={question.answers}
          asks={question.asks}
          kinds={question.kinds}
          hasDraft={!empty}
          canAct={canAct}
          write={plan}
          experience={
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-3">
                <button type="button" disabled={select.pending} onClick={() => select.run(() => selectAction(question.id))} className={small}>
                  {select.pending ? "경험을 찾는 중…" : selection ? "이어지는 경험 다시 고르기" : "이어지는 경험도 고르기"}
                </button>
                <span className="text-xs text-foreground/60">선택 사항</span>
              </div>
              <ErrorLine message={select.message} />
              {selection && <Picker question={question} selection={selection} hasDraft={!empty} checked={checked} setChecked={setChecked} canWrite={plan.enabled} needAnswers={needAnswers} />}
            </div>
          }
        />
      )}

      {canAct && !wants && empty && <ManualWrite question={question} />}

      {draft && !empty && <DraftView questionId={question.id} data={draft} canRevise={canAct} />}
    </section>
  );
}
