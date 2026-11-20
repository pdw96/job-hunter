"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import type { PageGroup } from "@/modules/experiences/notion-export";
import type { ImportKit, ImportOutcome } from "./import-form";

// made: 처음에 만든 기록 수. 사용자가 지운 뒤에도 그대로 둔다
type Outcome<C> = (Extract<ImportOutcome<C>, { ok: true }> & { made?: number }) | Extract<ImportOutcome<C>, { ok: false }>;

// 노션 묶음을 골라 하나씩 가져온다. 묶음마다 AI를 한 번 부른다
export function ZipImport<C extends { id: string }>({ kit, groups, onBack }: { kit: ImportKit<C>; groups: PageGroup[]; onBack: () => void }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<number>>(() => new Set(groups.flatMap((group, index) => (group.tooLong ? [] : [index]))));
  const [outcomes, setOutcomes] = useState<Record<number, Outcome<C>>>({});
  const [running, setRunning] = useState<{ done: number; total: number; title: string } | null>(null);
  const [started, setStarted] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const stop = useRef(false);

  const selectable = groups.flatMap((group, index) => (group.tooLong ? [] : [index]));
  // 다시 보낼 만한 묶음: 호출이 실패했거나, 초안이 형식에 맞지 않아 하나도 만들지 못한 것
  const failed = Object.entries(outcomes).flatMap(([index, outcome]) =>
    (!outcome.ok && !outcome.empty) || (outcome.ok && outcome.made === 0) ? [Number(index)] : [],
  );

  function toggle(index: number) {
    const next = new Set(selected);
    if (next.has(index)) next.delete(index);
    else next.add(index);
    setSelected(next);
  }

  async function run(indexes: number[]) {
    stop.current = false;
    setStarted(true);
    setNotice(null);
    for (const [position, index] of indexes.entries()) {
      if (stop.current) {
        setNotice(`멈췄습니다. ${indexes.length - position}개 묶음은 가져오지 않았습니다`);
        break;
      }
      setRunning({ done: position, total: indexes.length, title: groups[index].title });
      const formData = new FormData();
      formData.set("text", groups[index].text);
      let outcome: Outcome<C>;
      try {
        outcome = await kit.run(formData);
      } catch {
        outcome = { ok: false, message: "연결이 끊겼습니다. 다시 시도해 주세요" };
      }
      if (outcome.ok) outcome = { ...outcome, made: outcome.created.length };
      setOutcomes((previous) => ({ ...previous, [index]: outcome }));
      if (!outcome.ok && outcome.stop) {
        setNotice(`${outcome.message}. 남은 ${indexes.length - position - 1}개 묶음은 가져오지 않았습니다`);
        break;
      }
    }
    setRunning(null);
    router.refresh();
  }

  function remove(index: number, item: C) {
    if (!kit.remove || !window.confirm("이 기록을 지울까요?")) return;
    const outcome = outcomes[index];
    if (!outcome?.ok) return;
    setOutcomes({ ...outcomes, [index]: { ...outcome, created: outcome.created.filter((other) => other.id !== item.id) } });
    void kit.remove(item).then(() => router.refresh());
  }

  if (!started) {
    return (
      <div className="max-w-2xl space-y-6">
        <div className="space-y-2">
          <h1 className="text-2xl font-bold">가져올 묶음 고르기</h1>
          <p className="text-sm text-foreground/70">
            묶음 {groups.length}개를 찾았습니다. 본문 페이지와 그 하위 페이지가 한 묶음입니다. 경험이 아닌 묶음(메모, 원칙 등)은 빼
            주세요
          </p>
          <div className="flex gap-4 text-sm">
            <button type="button" onClick={() => setSelected(new Set(selectable))} className="underline">
              전체 선택
            </button>
            <button type="button" onClick={() => setSelected(new Set())} className="underline">
              전체 해제
            </button>
          </div>
        </div>
        <ul className="divide-y divide-foreground/10 border-y border-foreground/10">
          {groups.map((group, index) => (
            <li key={index} className="py-2">
              <label className="flex items-start gap-3">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={selected.has(index)}
                  disabled={group.tooLong}
                  onChange={() => toggle(index)}
                />
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{group.title}</span>
                  <span className="block text-xs text-foreground/60">
                    페이지 {group.pages}개 · {group.chars.toLocaleString()}자
                    {group.tooLong && " · 4만 자를 넘어 가져올 수 없습니다. 나눠서 붙여 넣어 주세요"}
                  </span>
                </span>
              </label>
            </li>
          ))}
        </ul>
        <div className="flex items-center gap-3">
          <button
            type="button"
            disabled={selected.size === 0}
            onClick={() => run([...selected].sort((a, b) => a - b))}
            className="rounded-lg bg-foreground px-4 py-2 font-medium text-background disabled:opacity-50"
          >
            {selected.size}개 묶음 가져오기
          </button>
          <button type="button" onClick={onBack} className="text-sm underline">
            다른 파일 고르기
          </button>
        </div>
        <p className="text-xs text-foreground/60">묶음 하나에 1분쯤 걸릴 수 있습니다. 끝날 때까지 이 화면을 닫지 말아 주세요</p>
      </div>
    );
  }

  const allCreated = Object.values(outcomes).flatMap((outcome) => (outcome.ok ? outcome.created : []));

  return (
    <div className="max-w-2xl space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">{running ? "가져오는 중" : kit.headline(allCreated)}</h1>
        {!running && kit.summary && <p className="text-sm font-medium">{kit.summary(allCreated)}</p>}
        {running ? (
          <div className="flex flex-wrap items-center gap-3 text-sm" role="status">
            <span>
              {running.done + 1} / {running.total} · {running.title}
            </span>
            <button
              type="button"
              onClick={() => {
                stop.current = true;
              }}
              className="underline"
            >
              멈추기
            </button>
          </div>
        ) : (
          <p className="text-sm text-foreground/70">{kit.note}</p>
        )}
        {notice && <p className="text-sm text-amber-700 dark:text-amber-400">{notice}</p>}
      </div>

      <ul className="divide-y divide-foreground/10 border-y border-foreground/10">
        {Object.entries(outcomes).map(([key, outcome]) => {
          const index = Number(key);
          return (
            <li key={key} className="space-y-1 py-3">
              <p className="text-sm text-foreground/60">{groups[index].title}</p>
              {!outcome.ok && outcome.empty && <p className="text-sm text-foreground/70">경험으로 볼 내용이 없어 기록을 만들지 않았습니다</p>}
              {!outcome.ok && !outcome.empty && <p className="text-sm text-red-600">가져오지 못했습니다: {outcome.message}</p>}
              {outcome.ok && outcome.made === 0 && (
                <p className="text-sm text-red-600">AI가 만든 초안이 형식에 맞지 않아 기록을 만들지 못했습니다. 다시 가져와 주세요</p>
              )}
              {outcome.ok && outcome.made !== 0 && outcome.created.length === 0 && (
                <p className="text-sm text-foreground/70">만든 기록을 모두 지웠습니다</p>
              )}
              {outcome.ok &&
                outcome.created.map((item) => (
                  <div key={item.id} className="flex flex-wrap items-center gap-3">
                    <kit.Item item={item} onRemove={kit.remove ? () => remove(index, item) : undefined} />
                  </div>
                ))}
              {outcome.ok && kit.isTrimmed && outcome.created.some(kit.isTrimmed) && (
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  내용이 길어 일부가 잘린 기록이 있습니다. 원본과 비교해 빠진 내용을 채워 주세요
                </p>
              )}
              {outcome.ok && outcome.created.length > 0 && (outcome.skipped > 0 || outcome.more) && (
                <p className="text-xs text-amber-700 dark:text-amber-400">다 담지 못한 내용이 있습니다. 원본과 비교해 빠진 경험을 확인해 주세요</p>
              )}
            </li>
          );
        })}
      </ul>

      {!running && (
        <div className="flex flex-wrap gap-4 text-sm">
          {failed.length > 0 && (
            <button type="button" onClick={() => run(failed)} className="underline">
              실패한 {failed.length}개 묶음 다시 가져오기
            </button>
          )}
          <Link href={kit.backHref} className="underline">
            {kit.backLabel}
          </Link>
        </div>
      )}
    </div>
  );
}
