"use client";

import { useMemo, useState } from "react";
import { detectCountSpaces, detectLimit, splitQuestions } from "@/modules/applications/input";
import { addQuestionsAction } from "@/modules/applications/actions";
import { ErrorLine, useRun } from "./use-run";

// 문항을 한 번에 붙여 넣는다. 번호로 나누고 글자 수 제한을 찾아 미리 보여 준다
export function AddQuestions({ postingId }: { postingId: string }) {
  const [text, setText] = useState("");
  const [limits, setLimits] = useState<Record<number, string>>({});
  const [bases, setBases] = useState<Record<number, boolean>>({});
  const [countSpaces, setCountSpaces] = useState(true); // 문항 글에 기준이 적혀 있지 않을 때의 기본
  const { message, pending, run } = useRun();

  const items = useMemo(
    () => splitQuestions(text).map((prompt) => ({ prompt, detected: detectLimit(prompt), basis: detectCountSpaces(prompt) })),
    [text],
  );
  const limitOf = (index: number) => limits[index] ?? (items[index].detected === null ? "" : String(items[index].detected));

  const basisOf = (index: number) => bases[index] ?? items[index].basis ?? countSpaces;

  function add() {
    run(
      () =>
        addQuestionsAction(
          postingId,
          items.map((item, index) => ({ prompt: item.prompt, charLimit: limitOf(index) === "" ? null : limitOf(index), countSpaces: basisOf(index) })),
        ),
      () => {
        setText("");
        setLimits({});
        setBases({});
      },
    );
  }

  return (
    <section className="space-y-3 rounded-lg border border-foreground/20 p-4" aria-label="문항 더하기">
      <h2 className="font-semibold">문항 더하기</h2>
      <textarea
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setLimits({});
          setBases({});
        }}
        rows={5}
        placeholder="문항을 붙여 넣으세요. 여러 개면 번호를 붙여 한 번에"
        aria-label="문항"
        className="w-full rounded-lg border border-foreground/20 bg-transparent p-3 text-sm"
      />
      {items.length > 0 && (
        <ul className="space-y-2">
          {items.map((item, index) => (
            <li key={index} className="space-y-1 rounded-lg bg-foreground/5 p-3 text-sm">
              <p className="whitespace-pre-wrap break-words">
                <span className="font-medium">{index + 1}번 </span>
                {item.prompt}
              </p>
              <label className="flex items-center gap-2 text-xs text-foreground/70">
                글자 수 제한
                <input
                  type="number"
                  inputMode="numeric"
                  value={limitOf(index)}
                  onChange={(e) => setLimits({ ...limits, [index]: e.target.value })}
                  placeholder="없음"
                  className="w-24 rounded-lg border border-foreground/20 bg-transparent px-2 py-1 text-sm"
                />
                자
                <select
                  value={basisOf(index) ? "with" : "without"}
                  onChange={(e) => setBases({ ...bases, [index]: e.target.value === "with" })}
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
          disabled={pending || items.length === 0}
          className="rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-50"
        >
          {pending ? "더하는 중…" : items.length > 1 ? `${items.length}개 더하기` : "더하기"}
        </button>
      </div>
      <ErrorLine message={message} />
    </section>
  );
}
