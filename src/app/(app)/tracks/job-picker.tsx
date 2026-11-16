"use client";

import { useEffect, useState } from "react";
import { listJobsUnderAction, listMiddlesAction, searchJobsAction } from "@/modules/ncs/actions";
import type { NcsJob, NcsNode } from "@/modules/ncs/repo";
import { MAX_JOBS } from "@/modules/tracks/options";

// 고른 직무. label과 majorCode는 화면 표시용이고 저장하지 않는다
export type PickedJob = {
  ncsCode: string | null;
  customName: string | null;
  label: string;
  majorCode: string | null;
};

type Props = {
  majors: NcsNode[];
  browseMajor: string;
  onBrowseMajorChange: (code: string) => void;
  jobs: PickedJob[];
  onJobsChange: (jobs: PickedJob[]) => void;
};

const inputClass = "w-full rounded-lg border border-foreground/20 bg-transparent px-3 py-2";

export function JobPicker({ majors, browseMajor, onBrowseMajorChange, jobs, onJobsChange }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<NcsJob[] | null>(null);
  const [middles, setMiddles] = useState<NcsNode[]>([]);
  const [middle, setMiddle] = useState("");
  const [groups, setGroups] = useState<{ group: NcsNode; jobs: NcsNode[] }[]>([]);
  const [custom, setCustom] = useState("");
  const [showCustom, setShowCustom] = useState(false);

  const full = jobs.length >= MAX_JOBS;
  const picked = new Set(jobs.map((j) => j.ncsCode ?? `custom:${j.customName}`));

  // 검색: 입력을 멈추면 찾는다
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return;
    let stale = false;
    const timer = setTimeout(async () => {
      const found = await searchJobsAction(q);
      if (!stale) setResults(found);
    }, 250);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [query]);

  // 대분류가 바뀌면 중분류 목록을 다시 불러온다
  useEffect(() => {
    if (!browseMajor) return;
    let stale = false;
    listMiddlesAction(browseMajor).then((list) => {
      if (!stale) setMiddles(list);
    });
    return () => {
      stale = true;
    };
  }, [browseMajor]);

  // 중분류가 바뀌면 직무 목록을 다시 불러온다
  useEffect(() => {
    if (!middle) return;
    let stale = false;
    listJobsUnderAction(middle).then((list) => {
      if (!stale) setGroups(list);
    });
    return () => {
      stale = true;
    };
  }, [middle]);

  function changeMajor(code: string) {
    onBrowseMajorChange(code);
    setMiddles([]);
    setMiddle("");
    setGroups([]);
  }

  function changeMiddle(code: string) {
    setMiddle(code);
    setGroups([]);
  }

  function add(job: PickedJob) {
    const key = job.ncsCode ?? `custom:${job.customName}`;
    if (full || picked.has(key)) return;
    onJobsChange([...jobs, job]);
  }

  function toggle(job: PickedJob) {
    if (picked.has(job.ncsCode ?? "")) onJobsChange(jobs.filter((j) => j.ncsCode !== job.ncsCode));
    else add(job);
  }

  // 검색 결과를 고르면 단계별 선택의 대분류·중분류가 그 직무의 것으로 채워진다
  function pickResult(job: NcsJob) {
    add({ ncsCode: job.code, customName: null, label: job.name, majorCode: job.path[0].code });
    if (job.path[0].code !== browseMajor) changeMajor(job.path[0].code);
    changeMiddle(job.path[1].code);
    setQuery("");
    setResults(null);
  }

  function addCustom() {
    const name = custom.trim();
    if (name === "") return;
    add({ ncsCode: null, customName: name, label: name, majorCode: null });
    setCustom("");
  }

  const shownResults = query.trim().length >= 2 ? results : null;

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <label className="block space-y-1">
          <span className="text-sm font-medium">직무 검색</span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="예: 백엔드, 인사, 마케팅"
            autoComplete="off"
            className={inputClass}
          />
        </label>
        {shownResults && shownResults.length === 0 && (
          <p className="text-sm text-foreground/60">찾은 직무가 없습니다. 아래에서 단계별로 고르거나 직접 입력해 주세요</p>
        )}
        {shownResults && shownResults.length > 0 && (
          <ul className="max-h-64 divide-y divide-foreground/10 overflow-y-auto rounded-lg border border-foreground/20">
            {shownResults.map((job) => (
              <li key={job.code}>
                <button
                  type="button"
                  onClick={() => pickResult(job)}
                  disabled={full || picked.has(job.code)}
                  className="w-full px-3 py-2 text-left hover:bg-foreground/5 disabled:opacity-50"
                >
                  <span className="block font-medium">{job.name}</span>
                  <span className="block text-xs text-foreground/60">{job.path.map((p) => p.name).join(" > ")}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="space-y-3">
        <p className="text-sm font-medium">단계별로 고르기</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block space-y-1">
            <span className="text-xs text-foreground/60">대분류</span>
            <select value={browseMajor} onChange={(e) => changeMajor(e.target.value)} className={inputClass}>
              <option value="">선택</option>
              {majors.map((m) => (
                <option key={m.code} value={m.code}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block space-y-1">
            <span className="text-xs text-foreground/60">중분류</span>
            <select
              value={middle}
              onChange={(e) => changeMiddle(e.target.value)}
              disabled={middles.length === 0}
              className={inputClass}
            >
              <option value="">선택</option>
              {middles.map((m) => (
                <option key={m.code} value={m.code}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        {groups.map(({ group, jobs: groupJobs }) => (
          <fieldset key={group.code} className="space-y-2">
            <legend className="text-xs text-foreground/60">{group.name}</legend>
            <div className="flex flex-wrap gap-2">
              {groupJobs.map((job) => {
                const on = picked.has(job.code);
                return (
                  <button
                    key={job.code}
                    type="button"
                    aria-pressed={on}
                    disabled={full && !on}
                    onClick={() =>
                      toggle({ ncsCode: job.code, customName: null, label: job.name, majorCode: job.code.slice(0, 2) })
                    }
                    className={`rounded-full border px-3 py-1 text-sm disabled:opacity-40 ${
                      on ? "border-foreground bg-foreground text-background" : "border-foreground/20"
                    }`}
                  >
                    {job.name}
                  </button>
                );
              })}
            </div>
          </fieldset>
        ))}
      </div>

      <div className="space-y-2">
        {!showCustom ? (
          <button type="button" onClick={() => setShowCustom(true)} className="text-sm underline">
            목록에 없어요
          </button>
        ) : (
          <div className="flex gap-2">
            <input
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addCustom();
                }
              }}
              maxLength={50}
              placeholder="직무 이름 직접 입력"
              aria-label="직무 이름 직접 입력"
              className={`${inputClass} min-w-0 flex-1`}
            />
            <button type="button" onClick={addCustom} disabled={full} className="rounded-lg border border-foreground/20 px-3 py-2 text-sm disabled:opacity-40">
              추가
            </button>
          </div>
        )}
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium">
          고른 직무 {jobs.length} / {MAX_JOBS}
        </p>
        {jobs.length === 0 ? (
          <p className="text-sm text-foreground/60">아직 고른 직무가 없습니다</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {jobs.map((job) => (
              <li key={job.ncsCode ?? `custom:${job.customName}`} className="flex items-center gap-1 rounded-full bg-foreground/10 py-1 pl-3 pr-1 text-sm">
                {job.label}
                <button
                  type="button"
                  onClick={() => onJobsChange(jobs.filter((j) => j !== job))}
                  aria-label={`${job.label} 지우기`}
                  className="rounded-full px-2 hover:bg-foreground/10"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
