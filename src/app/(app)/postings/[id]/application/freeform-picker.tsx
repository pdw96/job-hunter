"use client";

import { useState } from "react";
import { addFreeformAction } from "@/modules/applications/actions";
import { APPLICATION_LIMITS, FREEFORM_CHAR_LIMIT, FREEFORM_DEFAULT, FREEFORM_ITEMS } from "@/modules/applications/options";
import { ErrorLine, useRun } from "./use-run";

// 자유양식: 흔한 항목을 체크해 문항으로 넣는다. 이미 넣은 항목은 끄고 "넣음"으로 보인다
export function FreeformPicker({ postingId, present }: { postingId: string; present: string[] }) {
  const [checked, setChecked] = useState<string[]>(() => FREEFORM_DEFAULT.filter((id) => !present.includes(id)));
  const [custom, setCustom] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [adding, setAdding] = useState(false);
  const [charLimit, setCharLimit] = useState(String(FREEFORM_CHAR_LIMIT));
  const { message, pending, run } = useRun();

  const filled = custom.filter((text) => text.trim() !== "");
  const count = checked.filter((id) => !present.includes(id)).length + filled.length;

  function toggle(id: string) {
    setChecked(checked.includes(id) ? checked.filter((x) => x !== id) : [...checked, id]);
  }
  function commitDraft() {
    if (draft.trim() !== "") setCustom([...custom, draft.trim()]);
    setDraft("");
    setAdding(false);
  }
  function add() {
    run(
      () => addFreeformAction(postingId, { items: checked.filter((id) => !present.includes(id)), custom: filled, charLimit }),
      () => {
        setChecked([]);
        setCustom([]);
      },
    );
  }

  return (
    <div className="space-y-3">
      <ul className="space-y-1">
        {FREEFORM_ITEMS.map((item) => {
          const done = present.includes(item.id);
          return (
            <li key={item.id}>
              <label className={`flex min-h-10 items-center gap-2 text-sm ${done ? "text-foreground/50" : ""}`}>
                <input type="checkbox" checked={!done && checked.includes(item.id)} disabled={done} onChange={() => toggle(item.id)} />
                {item.label}
                {done && <span className="text-xs">넣음</span>}
              </label>
            </li>
          );
        })}
        {custom.map((text, index) => (
          <li key={`${index}:${text}`} className="flex min-h-10 items-center gap-2 text-sm">
            <input type="checkbox" checked readOnly aria-label={text} />
            <span className="break-words">{text}</span>
            <button type="button" onClick={() => setCustom(custom.filter((_, i) => i !== index))} className="text-xs underline">
              빼기
            </button>
          </li>
        ))}
      </ul>
      {adding ? (
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              // 한글 입력 중의 Enter는 글자를 확정하는 것이라 항목을 넣지 않는다
              if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                e.preventDefault();
                commitDraft();
              }
            }}
            maxLength={APPLICATION_LIMITS.customItem}
            placeholder="항목 이름"
            aria-label="직접 추가할 항목"
            autoFocus
            className="min-w-0 flex-1 rounded-lg border border-foreground/20 bg-transparent px-2 py-2 text-sm"
          />
          <button type="button" onClick={commitDraft} className="rounded-lg border border-foreground/20 px-3 py-2 text-sm">
            추가
          </button>
        </div>
      ) : (
        <button type="button" onClick={() => setAdding(true)} className="text-sm underline">
          + 항목 직접 추가
        </button>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm text-foreground/70">
          항목당 글자 수
          <input
            type="number"
            inputMode="numeric"
            value={charLimit}
            onChange={(e) => setCharLimit(e.target.value)}
            className="w-24 rounded-lg border border-foreground/20 bg-transparent px-2 py-1 text-sm"
          />
        </label>
        <button
          type="button"
          onClick={add}
          disabled={pending || count === 0}
          className="rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-50"
        >
          {pending ? "넣는 중…" : `${count}개 넣기`}
        </button>
      </div>
      <ErrorLine message={message} />
    </div>
  );
}
