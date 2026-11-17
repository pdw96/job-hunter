"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { deleteExperienceAction, saveExperienceAction } from "@/modules/experiences/actions";
import type { ExperienceErrors, ExperienceInput } from "@/modules/experiences/input";
import { KIND_LABELS, KINDS, LIMITS, SCOPE_LABELS, SCOPES, type Scope } from "@/modules/experiences/options";
import { setDirty } from "./dirty";

type Props = {
  id?: string; // 있으면 고치기
  initial?: ExperienceInput;
  initialScopes?: Record<string, Scope>;
  tracks: { id: string; name: string }[];
  // 아래는 AI 인터뷰가 정리한 초안을 확인할 때 쓴다
  interviewId?: string;
  warnings?: Partial<Record<keyof ExperienceInput, string>>; // 대화에 없던 숫자 경고
};

const EMPTY: ExperienceInput = {
  name: "",
  kind: "job",
  organization: null,
  role: null,
  startMonth: null,
  endMonth: null,
  isOngoing: false,
  situation: null,
  actions: null,
  result: null,
  metrics: [],
  notDone: null,
  bannedPhrases: [],
  evidenceNote: null,
  tags: [],
};

// 빈 칸("")과 null을 같은 것으로 보고 비교한다
function normalized(input: ExperienceInput, scopes: Record<string, Scope>): string {
  const blank = (value: string | null) => (value === null || value.trim() === "" ? null : value.trim());
  // 칸을 정해진 순서로 하나씩 적는다. 객체에 다른 칸이 섞여 있거나 순서가 달라도 같게 비교된다
  return JSON.stringify([
    input.name.trim(),
    input.kind,
    blank(input.organization),
    blank(input.role),
    input.startMonth,
    input.isOngoing || input.kind === "certificate" ? null : input.endMonth,
    input.kind === "certificate" ? false : input.isOngoing,
    blank(input.situation),
    blank(input.actions),
    blank(input.result),
    input.metrics
      .filter((metric) => metric.text.trim() !== "")
      .map((metric) => [metric.text.trim(), blank(metric.basis)]),
    blank(input.notDone),
    input.bannedPhrases,
    blank(input.evidenceNote),
    [...new Set(input.tags)],
    Object.entries(scopes).sort(([x], [y]) => x.localeCompare(y)),
  ]);
}

const inputClass = "w-full rounded-lg border border-foreground/20 bg-transparent px-3 py-2";

function Field({
  label,
  hint,
  error,
  warning,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  warning?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-sm font-medium">{label}</span>
      {hint && <span className="block text-xs text-foreground/60">{hint}</span>}
      {children}
      {warning && <span className="block text-sm text-amber-700 dark:text-amber-400">{warning}</span>}
      {error && (
        <span role="alert" className="block text-sm text-red-600">
          {error}
        </span>
      )}
    </label>
  );
}

export function ExperienceForm({ id, initial, initialScopes, tracks, interviewId, warnings = {} }: Props) {
  const router = useRouter();
  const start = initial ?? EMPTY;
  const startScopes = initialScopes ?? Object.fromEntries(tracks.map((track) => [track.id, "use" as Scope]));

  const [form, setForm] = useState<ExperienceInput>(start);
  const [scopes, setScopes] = useState<Record<string, Scope>>(startScopes);
  const [tagText, setTagText] = useState(start.tags.join(", "));
  const [phrase, setPhrase] = useState("");
  const [errors, setErrors] = useState<ExperienceErrors>({});
  const [message, setMessage] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  const isCertificate = form.kind === "certificate";
  const tags = tagText.split(",").map((tag) => tag.trim()).filter(Boolean);
  const draft: ExperienceInput = { ...form, tags };
  const changed = normalized(draft, scopes) !== normalized(start, startScopes);

  // 서버에서 기록이 바뀌었으면(주장에 답해 금지 표현이 추가되거나 수치가 지워진 경우 등) 입력 칸도 따라간다.
  // 사용자가 고치던 중이 아닐 때만 그렇게 한다
  const serverKey = normalized(start, startScopes);
  const [seenKey, setSeenKey] = useState(serverKey);
  if (serverKey !== seenKey) {
    setSeenKey(serverKey);
    if (normalized(draft, scopes) === seenKey) {
      setForm(start);
      setTagText(start.tags.join(", "));
      setScopes(startScopes);
    }
  }

  // 검증 패널이 "먼저 저장해 주세요"를 보여 줄 수 있게 알린다
  useEffect(() => {
    setDirty(changed);
    return () => setDirty(false);
  }, [changed]);

  function set<K extends keyof ExperienceInput>(key: K, value: ExperienceInput[K]) {
    setForm((current) => ({ ...current, [key]: value }));
    setSaved(false);
  }

  const text = (key: "organization" | "role" | "situation" | "actions" | "result" | "notDone" | "evidenceNote") => ({
    value: form[key] ?? "",
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => set(key, e.target.value),
  });

  function setMetric(index: number, key: "text" | "basis", value: string) {
    set(
      "metrics",
      form.metrics.map((metric, i) => (i === index ? { ...metric, [key]: value } : metric)),
    );
  }

  function addPhrase() {
    const value = phrase.trim();
    if (value === "" || form.bannedPhrases.includes(value)) return;
    set("bannedPhrases", [...form.bannedPhrases, value]);
    setPhrase("");
  }

  function save() {
    setMessage(null);
    startTransition(async () => {
      const result = await saveExperienceAction(id ?? null, draft, scopes, interviewId);
      if (!result.ok) {
        setErrors(result.errors);
        setMessage(result.message ?? "입력한 내용을 다시 확인해 주세요");
        return;
      }
      setErrors({});
      if (id && !interviewId) {
        // 서버가 다듬은 값(공백 제거, 빈 수치 줄 삭제)으로 맞춘다
        setForm(result.value);
        setTagText(result.value.tags.join(", "));
        setSaved(true);
        router.refresh(); // 검증 상태를 새로 읽는다
      } else {
        router.push(`/experiences/${result.id}`);
      }
    });
  }

  function remove() {
    if (!id || !window.confirm("이 기록을 지울까요? 되돌릴 수 없습니다")) return;
    startTransition(async () => {
      const result = await deleteExperienceAction(id);
      if (result && !result.ok) setMessage(result.message);
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
      {/* 저장하는 동안에는 입력을 막는다. 그 사이 고친 내용이 저장 결과로 덮어써지지 않게 한다 */}
      <fieldset disabled={pending} className="m-0 min-w-0 space-y-8 border-0 p-0 disabled:opacity-70">
      <section className="space-y-4">
        <h2 className="text-lg font-semibold">기본</h2>
        <Field label="이름" hint="나중에 알아보기 쉬운 이름. 예: 결제 시스템 개편" error={errors.name} warning={warnings.name}>
          <input
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
            maxLength={LIMITS.shortText}
            className={inputClass}
          />
        </Field>
        <Field label="구분" error={errors.kind}>
          <select
            value={form.kind}
            onChange={(e) => set("kind", e.target.value as ExperienceInput["kind"])}
            className={inputClass}
          >
            {KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {KIND_LABELS[kind]}
              </option>
            ))}
          </select>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="소속·기관" error={errors.organization} warning={warnings.organization}>
            <input {...text("organization")} maxLength={LIMITS.shortText} className={inputClass} />
          </Field>
          <Field label="직무·역할" error={errors.role} warning={warnings.role}>
            <input {...text("role")} maxLength={LIMITS.shortText} className={inputClass} />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={isCertificate ? "취득 월" : "시작 월"} error={errors.startMonth} warning={warnings.startMonth}>
            <input
              type="month"
              min="1950-01"
              max="2099-12"
              value={form.startMonth ?? ""}
              onChange={(e) => set("startMonth", e.target.value || null)}
              className={inputClass}
            />
          </Field>
          {!isCertificate && (
            <Field label="끝 월" error={errors.endMonth} warning={warnings.endMonth}>
              <input
                type="month"
                min="1950-01"
                max="2099-12"
                value={form.isOngoing ? "" : (form.endMonth ?? "")}
                disabled={form.isOngoing}
                onChange={(e) => set("endMonth", e.target.value || null)}
                className={`${inputClass} disabled:opacity-40`}
              />
            </Field>
          )}
        </div>
        {!isCertificate && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.isOngoing} onChange={(e) => set("isOngoing", e.target.checked)} />
            진행 중
          </label>
        )}
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold">내용</h2>
        <Field label="상황" hint="어떤 배경과 문제가 있었나요" error={errors.situation} warning={warnings.situation}>
          <textarea {...text("situation")} rows={3} maxLength={LIMITS.longText} className={inputClass} />
        </Field>
        <Field
          label="본인이 한 일"
          hint="팀이나 다른 부서가 한 일과 구분해서, 본인이 직접 한 일만 적어 주세요"
          error={errors.actions} warning={warnings.actions}
        >
          <textarea {...text("actions")} rows={5} maxLength={LIMITS.longText} className={inputClass} />
        </Field>
        <Field label="결과" error={errors.result} warning={warnings.result}>
          <textarea {...text("result")} rows={3} maxLength={LIMITS.longText} className={inputClass} />
        </Field>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">수치</h2>
        <p className="text-xs text-foreground/60">수치마다 무엇을 기준으로 어떻게 계산했는지 함께 적어 주세요</p>
        {form.metrics.map((metric, index) => (
          <div key={index} className="space-y-2 rounded-lg border border-foreground/10 p-3">
            <input
              value={metric.text}
              onChange={(e) => setMetric(index, "text", e.target.value)}
              placeholder="수치 내용. 예: 월 장애 5건에서 1건으로"
              aria-label={`수치 ${index + 1} 내용`}
              className={inputClass}
            />
            <input
              value={metric.basis ?? ""}
              onChange={(e) => setMetric(index, "basis", e.target.value)}
              placeholder="기준·산출 근거. 예: 사내 장애 보고서, 개편 전후 3개월 평균"
              aria-label={`수치 ${index + 1} 기준·산출 근거`}
              className={inputClass}
            />
            <button
              type="button"
              onClick={() =>
                set(
                  "metrics",
                  form.metrics.filter((_, i) => i !== index),
                )
              }
              className="text-sm underline"
            >
              이 수치 지우기
            </button>
          </div>
        ))}
        {form.metrics.length < LIMITS.metrics && (
          <button
            type="button"
            onClick={() => set("metrics", [...form.metrics, { text: "", basis: null }])}
            className="rounded-lg border border-foreground/20 px-3 py-2 text-sm"
          >
            수치 추가
          </button>
        )}
        {warnings.metrics && <p className="text-sm text-amber-700 dark:text-amber-400">{warnings.metrics}</p>}
        {errors.metrics && (
          <p role="alert" className="text-sm text-red-600">
            {errors.metrics}
          </p>
        )}
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold">지원서에 쓸 때 지킬 것</h2>
        <Field
          label="하지 않은 것"
          hint="이 경험에서 본인이 하지 않은 일. AI가 이 범위를 넘겨 쓰지 않습니다"
          error={errors.notDone} warning={warnings.notDone}
        >
          <textarea {...text("notDone")} rows={3} maxLength={LIMITS.longText} className={inputClass} />
        </Field>
        <div className="space-y-2">
          <p className="text-sm font-medium">쓰면 안 되는 표현</p>
          <p className="text-xs text-foreground/60">과장으로 읽힐 수 있어 지원서에 쓰지 않을 표현</p>
          <div className="flex gap-2">
            <input
              value={phrase}
              onChange={(e) => setPhrase(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addPhrase();
                }
              }}
              maxLength={LIMITS.shortText}
              placeholder="예: 혼자 구축"
              aria-label="쓰면 안 되는 표현 입력"
              className={`${inputClass} min-w-0 flex-1`}
            />
            <button type="button" onClick={addPhrase} className="rounded-lg border border-foreground/20 px-3 py-2 text-sm">
              추가
            </button>
          </div>
          {form.bannedPhrases.length > 0 && (
            <ul className="flex flex-wrap gap-2">
              {form.bannedPhrases.map((item) => (
                <li key={item} className="flex items-center gap-1 rounded-full bg-foreground/10 py-1 pl-3 pr-1 text-sm">
                  {item}
                  <button
                    type="button"
                    onClick={() =>
                      set(
                        "bannedPhrases",
                        form.bannedPhrases.filter((p) => p !== item),
                      )
                    }
                    aria-label={`${item} 지우기`}
                    className="rounded-full px-2 hover:bg-foreground/10"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
          {errors.bannedPhrases && (
            <p role="alert" className="text-sm text-red-600">
              {errors.bannedPhrases}
            </p>
          )}
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold">그 밖에</h2>
        <Field label="증빙·확인 메모" hint="뒷받침할 서류나 자료가 무엇이고 어디에 있는지" error={errors.evidenceNote} warning={warnings.evidenceNote}>
          <textarea {...text("evidenceNote")} rows={2} maxLength={LIMITS.longText} className={inputClass} />
        </Field>
        <Field label="태그" hint={`쉼표로 구분, ${LIMITS.tags}개까지`} error={errors.tags}>
          <input
            value={tagText}
            onChange={(e) => {
              setTagText(e.target.value);
              setSaved(false);
            }}
            placeholder="예: 결제, API"
            className={inputClass}
          />
        </Field>
      </section>

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
                    onClick={() => {
                      setScopes({ ...scopes, [track.id]: scope });
                      setSaved(false);
                    }}
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

      {id && changed && (
        <p className="text-sm text-foreground/70">
          저장하지 않은 변경이 있습니다. 내용을 고쳐 저장하면 확인이 풀리고 다시 확인해야 합니다
        </p>
      )}
      {message && (
        <p role="alert" className="text-sm text-red-600">
          {message}
        </p>
      )}
      {saved && !changed && (
        <p role="status" className="rounded-lg bg-foreground/5 px-3 py-2 text-sm">
          저장했습니다
        </p>
      )}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending || (Boolean(id) && !interviewId && !changed)}
          className="rounded-lg bg-foreground px-4 py-2 font-medium text-background disabled:opacity-50"
        >
          {pending ? "저장 중…" : "저장"}
        </button>
        {id && (
          <button type="button" onClick={remove} disabled={pending} className="ml-auto text-sm text-red-600 underline">
            기록 지우기
          </button>
        )}
      </div>
    </form>
  );
}
