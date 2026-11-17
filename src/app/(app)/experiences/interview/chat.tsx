"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { answerInterviewAction, draftInterviewAction } from "@/modules/experiences/actions";
import type { ExperienceInput } from "@/modules/experiences/input";
import type { Scope } from "@/modules/experiences/options";
import type { InterviewMessage } from "@/modules/experiences/schema";
import { ExperienceForm } from "../experience-form";

type Props = {
  interviewId: string;
  experienceId: string | null; // 있으면 기존 기록을 보완하는 인터뷰
  initialMessages: InterviewMessage[];
  finished: boolean;
  tracks: { id: string; name: string }[];
  scopes?: Record<string, Scope>;
};

type Draft = { draft: ExperienceInput; warnings: Partial<Record<keyof ExperienceInput, string>> };

export function InterviewChat({ interviewId, experienceId, initialMessages, finished, tracks, scopes }: Props) {
  const [messages, setMessages] = useState(initialMessages);
  const [text, setText] = useState("");
  const [suggestFinish, setSuggestFinish] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"answer" | "draft" | null>(null);
  const [, startTransition] = useTransition();
  const endRef = useRef<HTMLDivElement>(null);

  const answered = messages.some((message) => message.role === "user");

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [messages, busy]);

  function send() {
    const answer = text.trim();
    if (answer === "" || busy) return;
    setError(null);
    setBusy("answer");
    setMessages((current) => [...current, { role: "user", text: answer }]);
    setText("");
    startTransition(async () => {
      const result = await answerInterviewAction(interviewId, answer);
      if (result.ok) {
        setMessages((current) => [...current, { role: "assistant", text: result.message }]);
        setSuggestFinish(result.suggestFinish);
      } else {
        // 보내지 못한 답은 입력 칸으로 되돌린다
        setMessages((current) => current.slice(0, -1));
        setText(answer);
        setError(result.message);
      }
      setBusy(null);
    });
  }

  function makeDraft() {
    if (busy) return;
    setError(null);
    setBusy("draft");
    startTransition(async () => {
      const result = await draftInterviewAction(interviewId);
      if (result.ok) setDraft({ draft: result.draft, warnings: result.warnings });
      else setError(result.message);
      setBusy(null);
    });
  }

  if (draft) {
    const warned = Object.keys(draft.warnings).length > 0;
    return (
      <div className="max-w-2xl space-y-6">
        <div className="space-y-2">
          <h1 className="text-2xl font-bold">초안 확인</h1>
          <p className="rounded-lg bg-foreground/5 px-3 py-2 text-sm">
            AI가 대화를 정리한 초안입니다. 말한 것과 다른 곳이 없는지 확인하고, 고친 뒤 저장해 주세요. 저장해도
            “미확인” 상태이며, 기록 화면에서 “내용이 맞습니다”를 눌러야 확인됩니다
          </p>
          {warned && (
            <p className="rounded-lg border border-amber-600/50 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
              대화에 없던 숫자가 들어간 칸이 있습니다. 해당 칸의 안내를 보고 맞는지 확인해 주세요
            </p>
          )}
          <button type="button" onClick={() => setDraft(null)} className="text-sm underline">
            대화로 돌아가기
          </button>
        </div>
        <ExperienceForm
          id={experienceId ?? undefined}
          initial={draft.draft}
          initialScopes={scopes}
          tracks={tracks}
          interviewId={interviewId}
          warnings={draft.warnings}
        />
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-4">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold">{experienceId ? "기록 보완 인터뷰" : "AI 인터뷰"}</h1>
        <p className="text-sm text-foreground/60">
          질문에 짧게 답해 주세요. 모르거나 없는 것은 “모름”, “없음”이라고 하시면 됩니다. 연락처는 적지 마세요
        </p>
      </div>

      <ol className="space-y-3" aria-live="polite">
        {messages.map((message, index) => (
          <li key={index} className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}>
            <p
              className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2 ${
                message.role === "user" ? "bg-foreground text-background" : "bg-foreground/10"
              }`}
            >
              {message.text}
            </p>
          </li>
        ))}
        {busy === "answer" && (
          <li className="flex justify-start">
            <p className="rounded-2xl bg-foreground/10 px-4 py-2 text-foreground/60">생각 중…</p>
          </li>
        )}
      </ol>
      <div ref={endRef} />

      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}

      {finished ? (
        <p className="text-sm text-foreground/60">
          끝난 인터뷰입니다.{" "}
          <Link href="/experiences" className="underline">
            경험 기록으로 돌아가기
          </Link>
        </p>
      ) : (
        <div className="space-y-3">
          <form
            className="flex items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
          >
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  send();
                }
              }}
              rows={2}
              maxLength={4000}
              disabled={busy !== null}
              placeholder="답을 입력해 주세요"
              aria-label="답 입력"
              className="min-w-0 flex-1 rounded-lg border border-foreground/20 bg-transparent px-3 py-2 disabled:opacity-60"
            />
            <button
              type="submit"
              disabled={busy !== null || text.trim() === ""}
              className="rounded-lg bg-foreground px-4 py-2 font-medium text-background disabled:opacity-50"
            >
              보내기
            </button>
          </form>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={makeDraft}
              disabled={busy !== null || !answered}
              className={`rounded-lg px-4 py-2 font-medium disabled:opacity-50 ${
                suggestFinish ? "bg-foreground text-background" : "border border-foreground/20"
              }`}
            >
              {busy === "draft" ? "정리하는 중…" : "기록으로 정리하기"}
            </button>
            <Link href={experienceId ? `/experiences/${experienceId}` : "/experiences"} className="text-sm underline">
              그만두기
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
