"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { LIMITS, SCOPE_LABELS, SCOPES, type Scope } from "@/modules/experiences/options";
import { deleteFactAction, saveFactAction } from "@/modules/experiences/record-actions";
import {
  CREDENTIAL_TYPE_LABELS,
  CREDENTIAL_TYPES,
  DEGREE_LABELS,
  DEGREES,
  EMPLOYMENT_LABELS,
  EMPLOYMENTS,
  FACT_KIND_LABELS,
  type FactKind,
  GPA_SCALES,
  RECORD_LIMITS,
  SCHOOL_STATUS_LABELS,
  SCHOOL_STATUSES,
} from "@/modules/experiences/record-options";
import { TAB_OF_KIND } from "./fact-summary";

// 값은 모두 문자열로 들고 있다가 저장할 때 서버가 읽는 모양으로 바꾼다. 서버가 한 번 더 검사한다.
type Values = Record<string, string>;
type Option = { value: string; label: string };

type Spec =
  | { key: string; label: string; type: "text" | "number"; hint?: string; max?: number }
  | { key: string; label: string; type: "month"; end?: boolean }
  | { key: string; label: string; type: "area"; hint?: string; rows?: number }
  | { key: string; label: string; type: "choice"; options: Option[]; optional?: boolean }
  | { key: string; label: string; type: "parent" };

const toOptions = <T extends string>(values: readonly T[], labels: Record<T, string>): Option[] =>
  values.map((value) => ({ value, label: labels[value] }));

const SPECS: Record<FactKind, Spec[]> = {
  education: [
    { key: "schoolName", label: "학교 이름", type: "text" },
    { key: "location", label: "소재지", type: "text", hint: "예: 서울" },
    { key: "degree", label: "학위", type: "choice", options: toOptions(DEGREES, DEGREE_LABELS) },
    { key: "status", label: "상태", type: "choice", options: toOptions(SCHOOL_STATUSES, SCHOOL_STATUS_LABELS) },
    { key: "major", label: "전공", type: "text", hint: "고등학교는 비워도 됩니다" },
    { key: "startMonth", label: "시작 월", type: "month" },
    { key: "endMonth", label: "끝 월", type: "month", end: true },
    { key: "gpa", label: "학점", type: "text", hint: "예: 3.8" },
    { key: "gpaScale", label: "학점 기준", type: "choice", optional: true, options: GPA_SCALES.map((s) => ({ value: s, label: s })) },
  ],
  course: [
    { key: "name", label: "과정 이름", type: "text" },
    { key: "institution", label: "기관", type: "text" },
    { key: "startMonth", label: "시작 월", type: "month" },
    { key: "endMonth", label: "끝 월", type: "month", end: true },
    { key: "hours", label: "시간", type: "number", hint: "총 교육 시간" },
    { key: "learned", label: "배운 것", type: "text", hint: "한 줄로" },
  ],
  job: [
    { key: "company", label: "회사 이름", type: "text" },
    { key: "department", label: "부서", type: "text" },
    { key: "title", label: "직위·직무", type: "text" },
    { key: "employment", label: "고용 형태", type: "choice", options: toOptions(EMPLOYMENTS, EMPLOYMENT_LABELS) },
    { key: "startMonth", label: "시작 월", type: "month" },
    { key: "endMonth", label: "끝 월", type: "month", end: true },
    {
      key: "duties",
      label: "담당 업무",
      type: "area",
      rows: 5,
      hint: `한 줄에 하나씩, ${RECORD_LIMITS.duties}줄까지, 줄마다 ${RECORD_LIMITS.dutyLength}자까지`,
    },
  ],
  gap: [
    { key: "startMonth", label: "시작 월", type: "month" },
    { key: "endMonth", label: "끝 월", type: "month", end: true },
    { key: "note", label: "메모", type: "text", hint: "예: 취업 준비" },
  ],
  credential: [
    { key: "type", label: "종류", type: "choice", options: toOptions(CREDENTIAL_TYPES, CREDENTIAL_TYPE_LABELS) },
    { key: "name", label: "이름", type: "text" },
    { key: "issuer", label: "발급 기관", type: "text" },
    { key: "month", label: "취득 월", type: "month" },
    { key: "score", label: "점수·등급", type: "text" },
  ],
  project: [
    { key: "name", label: "프로젝트 이름", type: "text" },
    { key: "parent", label: "소속", type: "parent" },
    { key: "role", label: "역할", type: "text" },
    { key: "startMonth", label: "시작 월", type: "month" },
    { key: "endMonth", label: "끝 월", type: "month", end: true },
    { key: "tools", label: "사용 도구", type: "text", hint: `쉼표로 구분, ${RECORD_LIMITS.tools}개까지` },
    { key: "summary", label: "한 줄 소개", type: "text", max: RECORD_LIMITS.summary },
  ],
  activity: [
    { key: "name", label: "활동 이름", type: "text" },
    { key: "organization", label: "단체·기관", type: "text" },
    { key: "role", label: "역할", type: "text" },
    { key: "startMonth", label: "시작 월", type: "month" },
    { key: "endMonth", label: "끝 월", type: "month", end: true },
  ],
};

// 재직 중·진행 중 칸을 가진 메뉴
const HAS_ONGOING: FactKind[] = ["job", "project", "activity"];
const ONGOING_LABEL: Partial<Record<FactKind, string>> = { job: "재직 중", project: "진행 중", activity: "진행 중" };

const inputClass = "w-full rounded-lg border border-foreground/20 bg-transparent px-3 py-2";

// 서버가 준 값을 입력 칸 문자열로
export function toValues(kind: FactKind, value: Record<string, unknown> | undefined): Values {
  const out: Values = {};
  for (const spec of SPECS[kind]) {
    const raw = value?.[spec.key];
    if (spec.type === "parent") {
      const p = raw as { kind: string; id: string } | null | undefined;
      out[spec.key] = p ? `${p.kind}:${p.id}` : "";
    } else if (spec.key === "duties") out[spec.key] = Array.isArray(raw) ? raw.join("\n") : "";
    else if (spec.key === "tools") out[spec.key] = Array.isArray(raw) ? raw.join(", ") : "";
    else out[spec.key] = raw === null || raw === undefined ? "" : String(raw);
  }
  return out;
}

// 입력 칸 문자열을 서버가 읽는 모양으로. 서버가 고치지 않는 칸(쓰면 안 되는 표현)은 처음 값을 그대로 보낸다
function toInput(kind: FactKind, v: Values, ongoing: boolean, initial: Record<string, unknown> | undefined) {
  const input: Record<string, unknown> = {};
  for (const spec of SPECS[kind]) {
    const raw = v[spec.key] ?? "";
    if (spec.type === "parent") {
      const [parentKind, ...rest] = raw.split(":");
      input[spec.key] = raw === "" ? null : { kind: parentKind, id: rest.join(":") };
    } else if (spec.key === "duties") input[spec.key] = raw.split("\n");
    else if (spec.key === "tools") input[spec.key] = raw.split(",");
    else input[spec.key] = raw;
  }
  if (HAS_ONGOING.includes(kind)) input.isOngoing = ongoing;
  if (initial?.bannedPhrases) input.bannedPhrases = initial.bannedPhrases;
  return input;
}

function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-sm font-medium">{label}</span>
      {hint && <span className="block text-xs text-foreground/60">{hint}</span>}
      {children}
      {error && (
        <span role="alert" className="block text-sm text-red-600">
          {error}
        </span>
      )}
    </label>
  );
}

type Props = {
  kind: FactKind;
  id?: string; // 있으면 고치기
  initial?: Record<string, unknown>;
  initialScopes?: Record<string, Scope>;
  tracks: { id: string; name: string }[];
  parentOptions?: Option[]; // 프로젝트의 소속 후보
};

export function FactForm({ kind, id, initial, initialScopes, tracks, parentOptions = [] }: Props) {
  const router = useRouter();
  const [values, setValues] = useState<Values>(() => toValues(kind, initial));
  const [ongoing, setOngoing] = useState(initial?.isOngoing === true);
  const [scopes, setScopes] = useState<Record<string, Scope>>(
    initialScopes ?? Object.fromEntries(tracks.map((track) => [track.id, "use" as Scope])),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const set = (key: string, value: string) => setValues((current) => ({ ...current, [key]: value }));
  // 끝 월이 없는 경우: 재직·진행 중, 재학·휴학
  const noEnd = ongoing || (kind === "education" && (values.status === "enrolled" || values.status === "leave"));
  const banned = Array.isArray(initial?.bannedPhrases) ? (initial.bannedPhrases as string[]) : [];

  function save() {
    setMessage(null);
    startTransition(async () => {
      const result = await saveFactAction(kind, id ?? null, toInput(kind, values, ongoing, initial), scopes);
      if (!result.ok) {
        setErrors(result.errors);
        setMessage(result.message ?? "입력한 내용을 다시 확인해 주세요");
        return;
      }
      const tab = TAB_OF_KIND[kind];
      router.push(tab ? `/records?tab=${tab}` : "/records/scenes");
    });
  }

  function remove() {
    if (!id || !window.confirm("이 기록을 지울까요? 되돌릴 수 없습니다")) return;
    startTransition(async () => {
      const result = await deleteFactAction(kind, id);
      if (!result.ok) {
        setMessage(result.message);
        return;
      }
      const tab = TAB_OF_KIND[kind];
      router.push(tab ? `/records?tab=${tab}` : "/records/scenes");
    });
  }

  return (
    <form
      className="space-y-8"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <fieldset disabled={pending} className="m-0 min-w-0 space-y-8 border-0 p-0 disabled:opacity-70">
        <section className="grid gap-4 sm:grid-cols-2">
          {SPECS[kind].map((spec) => {
            const error = errors[spec.key];
            const wide = spec.type === "area" || spec.key === "summary" || spec.key === "name" || spec.key === "schoolName";
            const cell = wide ? "sm:col-span-2" : "";
            if (spec.type === "choice") {
              const empty = spec.optional ? "고르지 않음" : "고르기";
              return (
                <div key={spec.key} className={`space-y-1 ${cell}`}>
                  <p className="text-sm font-medium">{spec.label}</p>
                  <select
                    aria-label={spec.label}
                    value={values[spec.key]}
                    onChange={(e) => set(spec.key, e.target.value)}
                    className={inputClass}
                  >
                    <option value="">{empty}</option>
                    {spec.options.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  {error && (
                    <p role="alert" className="text-sm text-red-600">
                      {error}
                    </p>
                  )}
                </div>
              );
            }
            if (spec.type === "parent") {
              return (
                <div key={spec.key} className={`space-y-1 ${cell}`}>
                  <p className="text-sm font-medium">{spec.label}</p>
                  <select aria-label="소속" value={values.parent} onChange={(e) => set("parent", e.target.value)} className={inputClass}>
                    <option value="">개인</option>
                    {parentOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-foreground/60">내 경력·학교·교육 과정 중 하나를 고르거나 개인으로 둡니다</p>
                  {error && (
                    <p role="alert" className="text-sm text-red-600">
                      {error}
                    </p>
                  )}
                </div>
              );
            }
            if (spec.type === "month") {
              const disabled = spec.end === true && noEnd;
              return (
                <Field key={spec.key} label={spec.label} error={error}>
                  <input
                    type="month"
                    min="1950-01"
                    max="2099-12"
                    value={disabled ? "" : values[spec.key]}
                    disabled={disabled}
                    onChange={(e) => set(spec.key, e.target.value)}
                    className={`${inputClass} disabled:opacity-40`}
                  />
                </Field>
              );
            }
            if (spec.type === "area") {
              return (
                <div key={spec.key} className={cell}>
                  <Field label={spec.label} hint={spec.hint} error={error}>
                    <textarea
                      value={values[spec.key]}
                      onChange={(e) => set(spec.key, e.target.value)}
                      rows={spec.rows ?? 3}
                      className={inputClass}
                    />
                  </Field>
                </div>
              );
            }
            return (
              <div key={spec.key} className={cell}>
                <Field label={spec.label} hint={spec.hint} error={error}>
                  <input
                    type={spec.type === "number" ? "number" : "text"}
                    inputMode={spec.type === "number" ? "numeric" : undefined}
                    value={values[spec.key]}
                    onChange={(e) => set(spec.key, e.target.value)}
                    maxLength={spec.type === "text" ? (spec.max ?? LIMITS.shortText) : undefined}
                    className={inputClass}
                  />
                </Field>
              </div>
            );
          })}
          {HAS_ONGOING.includes(kind) && (
            <label className="flex items-center gap-2 pb-2 text-sm sm:col-span-2">
              <input type="checkbox" checked={ongoing} onChange={(e) => setOngoing(e.target.checked)} />
              {ONGOING_LABEL[kind]}
            </label>
          )}
        </section>

        {banned.length > 0 && (
          <p className="text-sm text-foreground/70">쓰면 안 되는 표현: {banned.join(", ")}</p>
        )}

        {tracks.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-lg font-semibold">트랙별 사용 범위</h2>
            <p className="text-xs text-foreground/60">
              사용: 이력서와 자소서 모두 · 요약만: 이력서에 한두 줄만 · 제외: 그 트랙에서 쓰지 않음
            </p>
            {tracks.map((track) => (
              <fieldset key={track.id} className="flex flex-wrap items-center gap-2">
                <legend className="float-left mr-2 min-w-0 text-sm font-medium">{track.name}</legend>
                {SCOPES.map((scope) => {
                  const on = (scopes[track.id] ?? "use") === scope;
                  return (
                    <button
                      key={scope}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setScopes({ ...scopes, [track.id]: scope })}
                      className={`rounded-full border px-3 py-1 text-sm ${
                        on ? "border-foreground bg-foreground text-background" : "border-foreground/20"
                      }`}
                    >
                      {SCOPE_LABELS[scope]}
                    </button>
                  );
                })}
              </fieldset>
            ))}
          </section>
        )}
      </fieldset>

      {id && <p className="text-xs text-foreground/60">내용을 고쳐 저장하면 확인이 풀리고 다시 `맞음`을 눌러야 합니다</p>}
      {message && (
        <p role="alert" className="text-sm text-red-600">
          {message}
        </p>
      )}
      <div className="flex items-center gap-3 pt-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-foreground px-4 py-2 font-medium text-background disabled:opacity-50"
        >
          {pending ? "저장 중…" : "저장"}
        </button>
        {id && (
          <button type="button" onClick={remove} disabled={pending} className="ml-auto text-sm text-red-600 underline">
            {FACT_KIND_LABELS[kind]} 지우기
          </button>
        )}
      </div>
    </form>
  );
}
