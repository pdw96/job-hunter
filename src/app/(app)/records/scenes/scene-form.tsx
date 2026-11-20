"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { LIMITS, SCOPE_LABELS, SCOPES, type Scope } from "@/modules/experiences/options";
import { deleteSceneAction, saveSceneAction } from "@/modules/experiences/record-actions";
import { setDirty } from "../../experiences/dirty";
import { EMPTY_SCENE, inputOfValues, type SceneFormValues } from "./scene-values";

type Props = {
  id?: string; // 있으면 고치기
  heads: { value: string; label: string }[];
  initial?: Partial<SceneFormValues>;
  initialScopes?: Record<string, Scope>;
  tracks: { id: string; name: string }[];
  interviewId?: string; // 인터뷰로 만든 초안을 확인할 때
  warnings?: Record<string, string | undefined>; // 대화에 없던 숫자 경고
};

const inputClass = "w-full rounded-lg border border-foreground/20 bg-transparent px-3 py-2";

function Field({ label, hint, error, warning, children }: { label: string; hint?: string; error?: string; warning?: string; children: React.ReactNode }) {
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

// 칸을 정해진 순서로 적어 비교한다. 빈 칸과 공백만 있는 칸은 같게 본다
function snapshot(v: SceneFormValues, scopes: Record<string, Scope>): string {
  const t = (s: string) => s.trim();
  return JSON.stringify([
    v.head, t(v.title), v.startMonth, v.isOngoing ? "" : v.endMonth, v.isOngoing,
    t(v.situation), t(v.judgment), t(v.actions), t(v.result), t(v.lessons),
    v.metrics.filter((m) => t(m.text) !== "").map((m) => [t(m.text), t(m.basis)]),
    t(v.notDone), v.bannedPhrases, t(v.evidenceNote), [...new Set(v.tags)],
    Object.entries(scopes).sort(([a], [b]) => a.localeCompare(b)),
  ]);
}

export function SceneForm({ id, heads, initial, initialScopes, tracks, interviewId, warnings = {} }: Props) {
  const router = useRouter();
  const start: SceneFormValues = { ...EMPTY_SCENE, ...initial };
  const startScopes = initialScopes ?? Object.fromEntries(tracks.map((t) => [t.id, "use" as Scope]));

  const [v, setV] = useState<SceneFormValues>(start);
  const [scopes, setScopes] = useState<Record<string, Scope>>(startScopes);
  const [tagText, setTagText] = useState(start.tags.join(", "));
  const [phrase, setPhrase] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  const draft: SceneFormValues = { ...v, tags: tagText.split(",").map((s) => s.trim()).filter(Boolean) };
  const changed = snapshot(draft, scopes) !== snapshot(start, startScopes);

  // 서버에서 값이 바뀌었으면(과장임 답이나 금지 표현 후보로 금지 목록이 늘어난 경우 등) 입력 칸도 따라간다.
  // 사용자가 고치던 중이 아닐 때만 그렇게 하고, 고치던 중이면 저장 때 옛 목록이 덮어쓰지 않도록 서버 쪽 금지 표현을 합친다
  const serverKey = snapshot(start, startScopes);
  const [seenKey, setSeenKey] = useState(serverKey);
  if (serverKey !== seenKey) {
    setSeenKey(serverKey);
    if (snapshot(draft, scopes) === seenKey) {
      setV(start);
      setTagText(start.tags.join(", "));
      setScopes(startScopes);
    } else {
      const merged = [...new Set([...v.bannedPhrases, ...start.bannedPhrases])];
      if (merged.length !== v.bannedPhrases.length) setV((cur) => ({ ...cur, bannedPhrases: merged }));
    }
  }

  // 검증 패널이 "먼저 저장해 주세요"를 보여 줄 수 있게 알린다
  useEffect(() => {
    setDirty(changed);
    return () => setDirty(false);
  }, [changed]);

  function set<K extends keyof SceneFormValues>(key: K, value: SceneFormValues[K]) {
    setV((cur) => ({ ...cur, [key]: value }));
    setSaved(false);
  }
  const text = (key: "title" | "situation" | "judgment" | "actions" | "result" | "lessons" | "notDone" | "evidenceNote") => ({
    value: v[key],
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => set(key, e.target.value),
  });
  const err = (key: string) => errors[key];

  function setMetric(index: number, key: "text" | "basis", value: string) {
    set("metrics", v.metrics.map((m, i) => (i === index ? { ...m, [key]: value } : m)));
  }
  function addPhrase() {
    const value = phrase.trim();
    if (value === "" || v.bannedPhrases.includes(value)) return;
    set("bannedPhrases", [...v.bannedPhrases, value]);
    setPhrase("");
  }

  function save() {
    setMessage(null);
    startTransition(async () => {
      const result = await saveSceneAction(id ?? null, inputOfValues(draft), scopes, interviewId);
      if (!result.ok) {
        setErrors(result.errors);
        setMessage(result.message ?? "입력한 내용을 다시 확인해 주세요");
        return;
      }
      setErrors({});
      if (id && !interviewId) {
        setSaved(true);
        setDirty(false);
        router.refresh();
      } else {
        router.push(`/records/scenes/${result.id}`);
      }
    });
  }

  function remove() {
    if (!id || !window.confirm("이 사례를 지울까요? 되돌릴 수 없습니다")) return;
    startTransition(async () => {
      const result = await deleteSceneAction(id);
      if (!result.ok) {
        setMessage(result.message);
        return;
      }
      router.push("/records/scenes");
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
        <section className="space-y-4">
          <h2 className="text-lg font-semibold">기본</h2>
          <div className="space-y-1">
            <p className="text-sm font-medium">어디에 속한 사례인가요</p>
            <select aria-label="소속" value={v.head} onChange={(e) => set("head", e.target.value)} className={inputClass}>
              <option value="">고르기</option>
              {heads.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            {err("head") && (
              <p role="alert" className="text-sm text-red-600">
                {err("head")}
              </p>
            )}
          </div>
          <Field label="제목" hint="나중에 알아보기 쉬운 이름. 예: 결제 장애 대응" error={err("title")} warning={warnings.title}>
            <input {...text("title")} maxLength={LIMITS.shortText} className={inputClass} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="시작 월" error={err("startMonth")} warning={warnings.startMonth}>
              <input type="month" min="1950-01" max="2099-12" value={v.startMonth} onChange={(e) => set("startMonth", e.target.value)} className={inputClass} />
            </Field>
            <Field label="끝 월" error={err("endMonth")} warning={warnings.endMonth}>
              <input
                type="month"
                min="1950-01"
                max="2099-12"
                value={v.isOngoing ? "" : v.endMonth}
                disabled={v.isOngoing}
                onChange={(e) => set("endMonth", e.target.value)}
                className={`${inputClass} disabled:opacity-40`}
              />
            </Field>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={v.isOngoing} onChange={(e) => set("isOngoing", e.target.checked)} />
            진행 중
          </label>
          <p className="text-xs text-foreground/60">기간을 비우면 소속의 기간을 씁니다</p>
        </section>

        <section className="space-y-4">
          <h2 className="text-lg font-semibold">내용</h2>
          <Field label="상황" hint="어떤 배경과 문제가 있었나요" error={err("situation")} warning={warnings.situation}>
            <textarea {...text("situation")} rows={3} maxLength={LIMITS.longText} className={inputClass} />
          </Field>
          <Field label="판단" hint="어떤 선택지 중에 왜 그렇게 정했나요" error={err("judgment")} warning={warnings.judgment}>
            <textarea {...text("judgment")} rows={3} maxLength={LIMITS.longText} className={inputClass} />
          </Field>
          <Field label="본인이 한 일" hint="팀이나 다른 부서가 한 일과 구분해서, 본인이 직접 한 일만 적어 주세요" error={err("actions")} warning={warnings.actions}>
            <textarea {...text("actions")} rows={5} maxLength={LIMITS.longText} className={inputClass} />
          </Field>
          <Field label="결과" error={err("result")} warning={warnings.result}>
            <textarea {...text("result")} rows={3} maxLength={LIMITS.longText} className={inputClass} />
          </Field>
          <Field label="배운 점" error={err("lessons")} warning={warnings.lessons}>
            <textarea {...text("lessons")} rows={3} maxLength={LIMITS.longText} className={inputClass} />
          </Field>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">수치</h2>
          <p className="text-xs text-foreground/60">수치마다 무엇을 기준으로 어떻게 계산했는지 함께 적어 주세요</p>
          {v.metrics.map((metric, index) => (
            <div key={index} className="space-y-2 rounded-lg border border-foreground/10 p-3">
              <input
                value={metric.text}
                onChange={(e) => setMetric(index, "text", e.target.value)}
                placeholder="수치 내용. 예: 월 장애 5건에서 1건으로"
                aria-label={`수치 ${index + 1} 내용`}
                className={inputClass}
              />
              <input
                value={metric.basis}
                onChange={(e) => setMetric(index, "basis", e.target.value)}
                placeholder="기준·산출 근거. 예: 사내 장애 보고서, 개편 전후 3개월 평균"
                aria-label={`수치 ${index + 1} 기준·산출 근거`}
                className={inputClass}
              />
              <button type="button" onClick={() => set("metrics", v.metrics.filter((_, i) => i !== index))} className="text-sm underline">
                이 수치 지우기
              </button>
            </div>
          ))}
          {v.metrics.length < LIMITS.metrics && (
            <button type="button" onClick={() => set("metrics", [...v.metrics, { text: "", basis: "" }])} className="rounded-lg border border-foreground/20 px-3 py-2 text-sm">
              수치 추가
            </button>
          )}
          {warnings.metrics && <p className="text-sm text-amber-700 dark:text-amber-400">{warnings.metrics}</p>}
          {err("metrics") && (
            <p role="alert" className="text-sm text-red-600">
              {err("metrics")}
            </p>
          )}
        </section>

        <section className="space-y-4">
          <h2 className="text-lg font-semibold">지원서에 쓸 때 지킬 것</h2>
          <Field label="하지 않은 것" hint="이 사례에서 본인이 하지 않은 일. AI가 이 범위를 넘겨 쓰지 않습니다" error={err("notDone")} warning={warnings.notDone}>
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
              <button type="button" onClick={addPhrase} className="shrink-0 rounded-lg border border-foreground/20 px-3 py-2 text-sm">
                추가
              </button>
            </div>
            {v.bannedPhrases.length > 0 && (
              <ul className="flex flex-wrap gap-2">
                {v.bannedPhrases.map((item) => (
                  <li key={item} className="flex items-center gap-1 rounded-full bg-foreground/10 py-1 pl-3 pr-1 text-sm">
                    {item}
                    <button type="button" onClick={() => set("bannedPhrases", v.bannedPhrases.filter((p) => p !== item))} aria-label={`${item} 지우기`} className="rounded-full px-2 hover:bg-foreground/10">
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {err("bannedPhrases") && (
              <p role="alert" className="text-sm text-red-600">
                {err("bannedPhrases")}
              </p>
            )}
          </div>
        </section>

        <section className="space-y-4">
          <h2 className="text-lg font-semibold">그 밖에</h2>
          <Field label="증빙·확인 메모" hint="뒷받침할 서류나 자료가 무엇이고 어디에 있는지" error={err("evidenceNote")} warning={warnings.evidenceNote}>
            <textarea {...text("evidenceNote")} rows={2} maxLength={LIMITS.longText} className={inputClass} />
          </Field>
          <Field label="태그" hint={`쉼표로 구분, ${LIMITS.tags}개까지`} error={err("tags")}>
            <input value={tagText} onChange={(e) => { setTagText(e.target.value); setSaved(false); }} placeholder="예: 결제, API" className={inputClass} />
          </Field>
        </section>

        {tracks.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-lg font-semibold">트랙별 사용 범위</h2>
            <p className="text-xs text-foreground/60">사용: 이력서와 자소서 모두 · 요약만: 이력서에 한두 줄만 · 제외: 그 트랙에서 쓰지 않음</p>
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
                      onClick={() => { setScopes({ ...scopes, [track.id]: scope }); setSaved(false); }}
                      className={`rounded-full border px-3 py-1 text-sm ${on ? "border-foreground bg-foreground text-background" : "border-foreground/20"}`}
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

      {id && changed && <p className="text-sm text-foreground/70">저장하지 않은 변경이 있습니다. 내용을 고쳐 저장하면 확인이 풀리고 다시 확인해야 합니다</p>}
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
            사례 지우기
          </button>
        )}
      </div>
    </form>
  );
}
