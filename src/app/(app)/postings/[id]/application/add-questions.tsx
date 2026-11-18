"use client";

import { useMemo, useState } from "react";
import { detectCountSpaces, detectLimit, splitQuestions } from "@/modules/applications/input";
import { addQuestionsAction } from "@/modules/applications/actions";
import { ErrorLine, useRun } from "./use-run";

// 문항을 한 번에 붙여 넣는다. 번호로 나누고 글자 수 제한을 찾아 미리 보여 준다
export function AddQuestions({ postingId }: { postingId: string }) {
  const [text, setText] = useState("");
  // 손댄 값은 줄 번호가 아니라 문항 글(같은 글이 여럿이면 몇 번째인지)로 기억한다
  const [limits, setLimits] = useState<Record<string, string>>({});
  const [bases, setBases] = useState<Record<string, boolean>>({});
  const [removed, setRemoved] = useState<string[]>([]);
  const [countSpaces, setCountSpaces] = useState(true); // 문항 글에 기준이 적혀 있지 않을 때의 기본
  const { message, pending, run } = useRun();

  const items = useMemo(() => {
    const seen = new Map<string, number>();
    return splitQuestions(text).map((prompt) => {
      const nth = seen.get(prompt) ?? 0;
      seen.set(prompt, nth + 1);
      return { key: `${nth}:${prompt}`, prompt, detected: detectLimit(prompt), basis: detectCountSpaces(prompt) };
    });
  }, [text]);
  const shown = items.filter((item) => !removed.includes(item.key));
  const limitOf = (item: (typeof items)[number]) => limits[item.key] ?? (item.detected === null ? "" : String(item.detected));
  const basisOf = (item: (typeof items)[number]) => bases[item.key] ?? item.basis ?? countSpaces;

  function add() {
    run(
      () =>
        addQuestionsAction(
          postingId,
          shown.map((item) => ({ prompt: item.prompt, charLimit: limitOf(item) === "" ? null : limitOf(item), countSpaces: basisOf(item) })),
        ),
      () => {
        setText("");
        setLimits({});
        setBases({});
        setRemoved([]);
      },
    );
  }

  return (
    <section className="space-y-3 rounded-lg border border-foreground/20 p-4" aria-label="문항 더하기">
      <h2 className="font-semibold">문항 더하기</h2>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={5}
        placeholder="문항을 붙여 넣으세요. 여러 개면 번호를 붙여 한 번에"
        aria-label="문항"
        className="w-full rounded-lg border border-foreground/20 bg-transparent p-3 text-sm"
      />
      {shown.length > 0 && (
        <ul className="space-y-2">
          {shown.map((item, index) => (
            <li key={item.key} className="space-y-1 rounded-lg bg-foreground/5 p-3 text-sm">
              <p className="whitespace-pre-wrap break-words">
                <span className="font-medium">{index + 1}번 </span>
                {item.prompt}
              </p>
              <button type="button" onClick={() => setRemoved([...removed, item.key])} className="text-xs underline">
                빼기
              </button>
              <label className="flex items-center gap-2 text-xs text-foreground/70">
                글자 수 제한
                <input
                  type="number"
                  inputMode="numeric"
                  value={limitOf(item)}
                  onChange={(e) => setLimits({ ...limits, [item.key]: e.target.value })}
                  placeholder="없음"
                  className="w-24 rounded-lg border border-foreground/20 bg-transparent px-2 py-1 text-sm"
                />
                자
                <select
                  value={basisOf(item) ? "with" : "without"}
                  onChange={(e) => setBases({ ...bases, [item.key]: e.target.value === "with" })}
                  aria-label={`${index + 1}번 글자 수 기준`}
                  className="rounded-lg border border-foreground/20 bg-transparent px-2 py-1 text-sm"
                >
                  <option value="with">공백 포함</option>
                  <option value="without">공백 제외</option>
                </select>
              </label>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <select
          value={countSpaces ? "with" : "without"}
          onChange={(e) => setCountSpaces(e.target.value === "with")}
          aria-label="기본 글자 수 기준"
          className="rounded-lg border border-foreground/20 bg-transparent px-2 py-2 text-sm"
        >
          <option value="with">공백 포함</option>
          <option value="without">공백 제외</option>
        </select>
        <button
          type="button"
          onClick={add}
          disabled={pending || shown.length === 0}
          className="rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-50"
        >
          {pending ? "더하는 중…" : shown.length > 1 ? `${shown.length}개 더하기` : "더하기"}
        </button>
      </div>
      <ErrorLine message={message} />
    </section>
  );
}
