"use client";

import { useState } from "react";
import { answerAsksAction, detachAnswerAction, makeAsksAction, writeAnswerAction } from "@/modules/applications/answer-actions";
import { approveAndWriteAction } from "@/modules/applications/actions";
import { ANSWER_TOPIC_LABELS, type AnswerTopic, APPLICATION_LIMITS } from "@/modules/applications/options";
import type { AskItem, Asks } from "@/modules/applications/types";
import { type AnswerView, type AskPick, type AskPicks, emptyPick, picksToSend, toggled, writesWithoutExperience } from "./answer-view";
import { ErrorLine, useRun } from "./use-run";

// 동기포부형·자기소개형 문항의 답 구역: 붙인 답 → 질문 받기 → 선택지 고르기 → 답 저장. 입력은 체크가 먼저고, 글은 기타·직접 적기에만 쓴다

const small = "text-sm underline disabled:opacity-50";
const primary = "rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-50";
const input = "w-full rounded-lg border border-foreground/20 bg-transparent px-3 py-2 text-sm";

function Check({ checked, disabled, onChange, children }: { checked: boolean; disabled?: boolean; onChange: (on: boolean) => void; children: React.ReactNode }) {
  return (
    <label className="flex items-start gap-2 py-1.5 text-sm">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="mt-1" />
      <span className="min-w-0 break-words">{children}</span>
    </label>
  );
}

function AskCard({ item, pick, onChange }: { item: AskItem; pick: AskPick; onChange: (pick: AskPick) => void }) {
  return (
    <li className="space-y-1 py-3">
      <p className="text-xs text-foreground/60">{ANSWER_TOPIC_LABELS[item.topic]}</p>
      {item.link !== "" && <p className="break-words text-xs text-foreground/50">{item.link}</p>}
      <p className="break-words text-sm font-medium">{item.question}</p>
      <div>
        {item.options.map((option, i) => (
          <Check key={option} checked={pick.options.includes(i)} onChange={(on) => onChange({ ...pick, options: toggled(pick.options, i, on) })}>
            {option}
          </Check>
        ))}
        {item.previous.length > 0 && (
          <div className="mt-1 border-t border-dashed border-foreground/20 pt-1">
            {item.previous.map((previous, i) => (
              <Check key={previous.answerId} checked={pick.previous.includes(i)} onChange={(on) => onChange({ ...pick, previous: toggled(pick.previous, i, on) })}>
                <span className="font-medium">지난번 답</span> <span className="text-foreground/60">({previous.label})</span>
                <span className="block text-foreground/80">{previous.text}</span>
              </Check>
            ))}
          </div>
        )}
      </div>
      <input
        value={pick.note}
        onChange={(e) => onChange({ ...pick, note: e.target.value })}
        maxLength={APPLICATION_LIMITS.note}
        placeholder="기타 (짧게 적기)"
        aria-label={`기타: ${item.question}`}
        className={input}
      />
    </li>
  );
}

function AskList({ questionId, asks }: { questionId: string; asks: Asks }) {
  const [picks, setPicks] = useState<AskPicks>({});
  const { message, pending, run } = useRun();
  const toSend = picksToSend(asks.items, picks);
  return (
    <div className="space-y-2">
      <ul className="divide-y divide-foreground/10 border-y border-foreground/10">
        {asks.items.map((item) => (
          <AskCard key={item.id} item={item} pick={picks[item.id] ?? emptyPick} onChange={(pick) => setPicks({ ...picks, [item.id]: pick })} />
        ))}
      </ul>
      <button type="button" disabled={pending || toSend.length === 0} onClick={() => run(() => answerAsksAction(questionId, toSend), () => setPicks({}))} className={primary}>
        {pending ? "저장 중…" : "답 저장"}
      </button>
      <ErrorLine message={message} />
    </div>
  );
}

// 질문 없이 직접 적는다(주제마다)
function Manual({ questionId, topics }: { questionId: string; topics: AnswerTopic[] }) {
  const [open, setOpen] = useState(false);
  const [topic, setTopic] = useState<AnswerTopic>(topics[0]);
  const [text, setText] = useState("");
  const { message, pending, run } = useRun();
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={small}>
        직접 적기
      </button>
    );
  }
  return (
    <div className="space-y-2">
      {topics.length > 1 && (
        <div className="flex flex-wrap gap-2" role="group" aria-label="주제">
          {topics.map((t) => (
            <button
              key={t}
              type="button"
              aria-pressed={t === topic}
              onClick={() => setTopic(t)}
              className={`rounded-full border px-3 py-1 text-sm ${t === topic ? "border-foreground bg-foreground text-background" : "border-foreground/30"}`}
            >
              {ANSWER_TOPIC_LABELS[t]}
            </button>
          ))}
        </div>
      )}
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={4}
        maxLength={APPLICATION_LIMITS.answer}
        aria-label={`${ANSWER_TOPIC_LABELS[topic]} 직접 적기`}
        className={input}
      />
      <div className="flex gap-3">
        <button
          type="button"
          disabled={pending || text.trim() === ""}
          onClick={() =>
            run(
              () => writeAnswerAction(questionId, topic, text),
              () => {
                setText("");
                setOpen(false);
              },
            )
          }
          className={primary}
        >
          {pending ? "저장 중…" : "답 저장"}
        </button>
        <button type="button" disabled={pending} onClick={() => setOpen(false)} className={small}>
          취소
        </button>
      </div>
      <ErrorLine message={message} />
    </div>
  );
}

function Attached({ questionId, answer, canAct }: { questionId: string; answer: AnswerView; canAct: boolean }) {
  const { message, pending, run } = useRun();
  return (
    <li className="space-y-1 py-2">
      <p className="break-words text-sm">
        <span className="text-foreground/60">내 답 · {answer.label}: </span>
        <span className="whitespace-pre-wrap">{answer.text}</span>
      </p>
      {canAct && (
        <button type="button" disabled={pending} onClick={() => run(() => detachAnswerAction(questionId, answer.id))} className={small}>
          빼기
        </button>
      )}
      <ErrorLine message={message} />
    </li>
  );
}

export function AnswerSection({
  questionId,
  topics,
  answers,
  asks,
  kinds,
  hasDraft,
  canAct,
}: {
  questionId: string;
  topics: AnswerTopic[];
  answers: AnswerView[];
  asks: Asks | null;
  kinds: string[] | null;
  hasDraft: boolean;
  canAct: boolean;
}) {
  const ask = useRun();
  const write = useRun();
  if (topics.length === 0) return null;
  const withoutExperience = writesWithoutExperience(kinds);

  function writeNow() {
    if (hasDraft && !confirm("지금 쓴 답을 지우고 다시 씁니다. 직접 고친 문단도 사라집니다. 다시 쓸까요?")) return;
    write.run(() => approveAndWriteAction(questionId, []));
  }

  return (
    <div className="space-y-3 rounded-lg bg-foreground/5 p-3">
      <p className="text-sm font-medium">내 답</p>
      {answers.length > 0 ? (
        <ul className="divide-y divide-foreground/10">
          {answers.map((answer) => (
            <Attached key={answer.id} questionId={questionId} answer={answer} canAct={canAct} />
          ))}
        </ul>
      ) : (
        <p className="text-sm text-foreground/70">아직 붙인 답이 없습니다. 질문에 답하면 그 답으로 씁니다</p>
      )}

      {canAct && (
        <>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <button type="button" disabled={ask.pending} onClick={() => ask.run(() => makeAsksAction(questionId, topics))} className={asks || answers.length > 0 ? small : primary}>
              {ask.pending ? "질문을 만드는 중…" : asks ? "질문 다시 받기" : "질문 받기"}
            </button>
            {ask.pending && (
              <span role="status" className="text-sm text-foreground/60">
                1분쯤 걸릴 수 있습니다
              </span>
            )}
            <Manual key={answers.length} questionId={questionId} topics={topics} />
          </div>
          <ErrorLine message={ask.message} />
          {asks && <AskList key={asks.madeAt} questionId={questionId} asks={asks} />}
          {withoutExperience && (
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" disabled={write.pending || answers.length === 0} onClick={writeNow} className={primary}>
                {write.pending ? "쓰는 중…" : hasDraft ? "다시 쓰기" : "이 답으로 쓰기"}
              </button>
              {write.pending && (
                <span role="status" className="text-sm text-foreground/60">
                  1분쯤 걸릴 수 있습니다
                </span>
              )}
            </div>
          )}
          <ErrorLine message={write.message} />
        </>
      )}
    </div>
  );
}
