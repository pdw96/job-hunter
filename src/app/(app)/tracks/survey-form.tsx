"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import type { NcsNode } from "@/modules/ncs/repo";
import { createTrackAction, updateTrackAction } from "@/modules/tracks/actions";
import { extraQuestionsFor } from "@/modules/tracks/extra-questions";
import {
  APPLICANT_TYPE_LABELS,
  APPLICANT_TYPES,
  type ApplicantType,
  CRITERIA,
  CRITERION_LABELS,
  type Criterion,
  EMPLOYMENT_TYPE_LABELS,
  EMPLOYMENT_TYPES,
  type EmploymentType,
  MAX_REGIONS,
  REGIONS,
  WEIGHTS_BY_RANK,
} from "@/modules/tracks/options";
import { asksExperience, type SurveyErrors, type SurveyInput, validateSurvey } from "@/modules/tracks/survey";
import { JobPicker, type PickedJob } from "./job-picker";

type StepId = "jobs" | "type" | "experience" | "regions" | "conditions" | "importance" | "confirm";

// 단계마다 검사할 답
const STEP_FIELDS: Record<StepId, (keyof SurveyInput)[]> = {
  jobs: ["jobs", "majorCode"],
  type: ["applicantType"],
  experience: ["experienceMonths"],
  regions: ["regions"],
  conditions: ["salaryMin", "employmentTypes"],
  importance: ["importanceOrder"],
  confirm: ["name"],
};

const STEP_TITLES: Record<StepId, string> = {
  jobs: "어떤 분야와 직무에 지원하나요?",
  type: "지원 유형을 골라 주세요",
  experience: "이 분야에서 일한 기간은 얼마나 되나요?",
  regions: "근무할 수 있는 지역을 선호하는 순서대로 골라 주세요",
  conditions: "희망 조건을 알려 주세요",
  importance: "공고를 볼 때 무엇이 더 중요한가요?",
  confirm: "이대로 만들까요?",
};

export type SurveyInitial = Omit<SurveyInput, "jobs"> & { jobs: PickedJob[] };

type Props = {
  majors: NcsNode[];
  initial?: SurveyInitial;
  trackId?: string; // 있으면 고치기
  isFirst?: boolean;
};

const inputClass = "w-full rounded-lg border border-foreground/20 bg-transparent px-3 py-2";
const choiceClass = (on: boolean) =>
  `rounded-lg border px-4 py-2 text-left ${on ? "border-foreground bg-foreground text-background" : "border-foreground/20"}`;

function toNumber(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : Number.NaN;
}

export function SurveyForm({ majors, initial, trackId, isFirst = false }: Props) {
  const [jobs, setJobs] = useState<PickedJob[]>(initial?.jobs ?? []);
  const [browseMajor, setBrowseMajor] = useState(initial?.majorCode ?? "");
  const [applicantType, setApplicantType] = useState<ApplicantType | null>(initial?.applicantType ?? null);
  const [years, setYears] = useState(
    initial?.experienceMonths != null ? String(Math.floor(initial.experienceMonths / 12)) : "",
  );
  const [months, setMonths] = useState(initial?.experienceMonths != null ? String(initial.experienceMonths % 12) : "");
  const [regions, setRegions] = useState<string[]>(initial?.regions ?? []);
  const [salary, setSalary] = useState(initial?.salaryMin != null ? String(initial.salaryMin) : "");
  const [employmentTypes, setEmploymentTypes] = useState<EmploymentType[]>(initial?.employmentTypes ?? []);
  const [order, setOrder] = useState<Criterion[]>(initial?.importanceOrder ?? [...CRITERIA]);
  const [extraAnswers, setExtraAnswers] = useState<Record<string, string>>(initial?.extraAnswers ?? {});
  const [name, setName] = useState(initial?.name ?? "");

  const [stepIndex, setStepIndex] = useState(0);
  const [errors, setErrors] = useState<SurveyErrors>({});
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // 분야는 처음 고른 NCS 직무의 대분류를 따른다. 직접 입력한 직무뿐이면 고른 대분류를 쓴다
  const majorCode = jobs.find((j) => j.majorCode)?.majorCode ?? browseMajor;
  const majorName = majors.find((m) => m.code === majorCode)?.name;
  const extraQuestions = extraQuestionsFor(majorCode);

  const steps: StepId[] = [
    "jobs",
    "type",
    ...(applicantType && asksExperience(applicantType) !== "skip" ? (["experience"] as const) : []),
    "regions",
    "conditions",
    "importance",
    "confirm",
  ];
  const step = steps[Math.min(stepIndex, steps.length - 1)];

  function draft(): Record<string, unknown> {
    const y = toNumber(years);
    const m = toNumber(months);
    const experienceMonths = y === null && m === null ? null : (y ?? 0) * 12 + (m ?? 0);
    return {
      name,
      majorCode,
      jobs: jobs.map(({ ncsCode, customName }) => ({ ncsCode, customName })),
      applicantType,
      experienceMonths,
      regions,
      salaryMin: toNumber(salary),
      employmentTypes,
      importanceOrder: order,
      extraAnswers,
    };
  }

  // 지금 단계의 답만 검사한다. 서버에서 전체를 다시 검사한다
  function stepErrors(id: StepId): SurveyErrors {
    const result = validateSurvey(draft());
    if (result.ok) return {};
    return Object.fromEntries(STEP_FIELDS[id].flatMap((f) => (result.errors[f] ? [[f, result.errors[f]]] : [])));
  }

  function next() {
    const found = stepErrors(step);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    // 확인 단계에 들어갈 때 트랙 이름이 비어 있으면 첫 직무 이름을 제안한다
    if (steps[stepIndex + 1] === "confirm" && name.trim() === "" && jobs[0]) setName(jobs[0].label);
    setStepIndex(stepIndex + 1);
  }

  function back() {
    setErrors({});
    setStepIndex(Math.max(0, stepIndex - 1));
  }

  function submit() {
    const input = draft();
    const checked = validateSurvey(input);
    if (!checked.ok) {
      showErrors(checked.errors);
      return;
    }
    setMessage(null);
    startTransition(async () => {
      const result = trackId ? await updateTrackAction(trackId, input) : await createTrackAction(input);
      // 성공하면 서버가 홈으로 보내므로 여기로 돌아오지 않는다
      if (result && !result.ok) {
        showErrors(result.errors);
        setMessage(result.message ?? null);
      }
    });
  }

  // 오류가 있는 첫 단계로 돌아가 보여 준다
  function showErrors(found: SurveyErrors) {
    setErrors(found);
    const index = steps.findIndex((id) => STEP_FIELDS[id].some((f) => found[f]));
    if (index >= 0) setStepIndex(index);
  }

  function toggleRegion(id: string) {
    if (regions.includes(id)) setRegions(regions.filter((r) => r !== id));
    else if (id === "anywhere") setRegions(["anywhere"]);
    else if (regions.length < MAX_REGIONS) setRegions([...regions.filter((r) => r !== "anywhere"), id]);
  }

  function toggleEmployment(type: EmploymentType) {
    if (employmentTypes.includes(type)) setEmploymentTypes(employmentTypes.filter((t) => t !== type));
    else if (type === "any") setEmploymentTypes(["any"]);
    else setEmploymentTypes([...employmentTypes.filter((t) => t !== "any"), type]);
  }

  function move(index: number, delta: -1 | 1) {
    const target = index + delta;
    if (target < 0 || target >= order.length) return;
    const nextOrder = [...order];
    [nextOrder[index], nextOrder[target]] = [nextOrder[target], nextOrder[index]];
    setOrder(nextOrder);
  }

  // 알려 준 오류 중 아직 고쳐지지 않은 것만 보여 준다. 답을 고치면 바로 사라진다
  const remaining = stepErrors(step);
  const shownErrors = STEP_FIELDS[step].flatMap((f) => (errors[f] && remaining[f] ? [remaining[f]] : []));
  const experienceText =
    applicantType && asksExperience(applicantType) !== "skip" && (years || months)
      ? `${toNumber(years) ?? 0}년 ${toNumber(months) ?? 0}개월`
      : null;

  return (
    <div className="max-w-xl space-y-6">
      {isFirst && stepIndex === 0 && <p className="text-foreground/70">처음이시네요. 몇 가지만 여쭤볼게요</p>}

      <div className="space-y-2">
        <p className="text-sm text-foreground/60" aria-live="polite">
          {stepIndex + 1} / {steps.length}
        </p>
        <h1 className="text-2xl font-bold">{STEP_TITLES[step]}</h1>
      </div>

      {step === "jobs" && (
        <div className="space-y-4">
          <JobPicker
            majors={majors}
            browseMajor={browseMajor}
            onBrowseMajorChange={setBrowseMajor}
            jobs={jobs}
            onJobsChange={setJobs}
          />
          {majorName && <p className="text-sm text-foreground/70">분야: {majorName}</p>}
        </div>
      )}

      {step === "type" && (
        <div className="grid gap-2 sm:grid-cols-2">
          {APPLICANT_TYPES.map((type) => (
            <button
              key={type}
              type="button"
              aria-pressed={applicantType === type}
              onClick={() => setApplicantType(type)}
              className={choiceClass(applicantType === type)}
            >
              {APPLICANT_TYPE_LABELS[type]}
            </button>
          ))}
        </div>
      )}

      {step === "experience" && (
        <div className="space-y-2">
          <div className="flex items-end gap-3">
            <label className="block w-28 space-y-1">
              <span className="text-sm font-medium">년</span>
              <input
                inputMode="numeric"
                value={years}
                onChange={(e) => setYears(e.target.value.replace(/\D/g, "").slice(0, 2))}
                className={inputClass}
              />
            </label>
            <label className="block w-28 space-y-1">
              <span className="text-sm font-medium">개월</span>
              <input
                inputMode="numeric"
                value={months}
                onChange={(e) => {
                  const digits = e.target.value.replace(/\D/g, "").slice(0, 2);
                  setMonths(digits !== "" && Number(digits) > 11 ? "11" : digits);
                }}
                className={inputClass}
              />
            </label>
          </div>
          {applicantType === "any" && <p className="text-sm text-foreground/60">없으면 비워 두셔도 됩니다</p>}
        </div>
      )}

      {step === "regions" && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {REGIONS.map((region) => {
              const rank = regions.indexOf(region.id);
              const on = rank >= 0;
              return (
                <button
                  key={region.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggleRegion(region.id)}
                  className={`rounded-full border px-3 py-1 text-sm ${
                    on ? "border-foreground bg-foreground text-background" : "border-foreground/20"
                  }`}
                >
                  {on && region.id !== "anywhere" ? `${rank + 1}. ` : ""}
                  {region.label}
                </button>
              );
            })}
          </div>
          <p className="text-sm text-foreground/60">누른 순서가 선호 순서입니다. {MAX_REGIONS}곳까지 고를 수 있습니다</p>
        </div>
      )}

      {step === "conditions" && (
        <div className="space-y-6">
          <label className="block space-y-1">
            <span className="text-sm font-medium">희망 최소 연봉 (만원, 비워 둘 수 있음)</span>
            <input
              inputMode="numeric"
              value={salary}
              onChange={(e) => setSalary(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="예: 4000"
              className={`${inputClass} max-w-48`}
            />
          </label>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">고용 형태 (여러 개 선택 가능)</legend>
            <div className="flex flex-wrap gap-2">
              {EMPLOYMENT_TYPES.map((type) => (
                <button
                  key={type}
                  type="button"
                  aria-pressed={employmentTypes.includes(type)}
                  onClick={() => toggleEmployment(type)}
                  className={choiceClass(employmentTypes.includes(type))}
                >
                  {EMPLOYMENT_TYPE_LABELS[type]}
                </button>
              ))}
            </div>
          </fieldset>
          {extraQuestions.map((question) => (
            <fieldset key={question.id} className="space-y-2">
              <legend className="text-sm font-medium">{question.label}</legend>
              <div className="flex flex-wrap gap-2">
                {question.options.map((option) => {
                  const on = extraAnswers[question.id] === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setExtraAnswers({ ...extraAnswers, [question.id]: option.value })}
                      className={choiceClass(on)}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          ))}
        </div>
      )}

      {step === "importance" && (
        <div className="space-y-3">
          <ol className="divide-y divide-foreground/10 border-y border-foreground/10">
            {order.map((criterion, index) => (
              <li key={criterion} className="flex items-center gap-3 py-3">
                <span className="w-6 text-foreground/60">{index + 1}</span>
                <span className="flex-1">{CRITERION_LABELS[criterion]}</span>
                <span className="w-12 text-right text-sm text-foreground/60">{WEIGHTS_BY_RANK[index]}점</span>
                <button
                  type="button"
                  onClick={() => move(index, -1)}
                  disabled={index === 0}
                  aria-label={`${CRITERION_LABELS[criterion]} 위로`}
                  className="rounded border border-foreground/20 px-2 py-1 disabled:opacity-30"
                >
                  ↑
                </button>
                <button
                  type="button"
                  onClick={() => move(index, 1)}
                  disabled={index === order.length - 1}
                  aria-label={`${CRITERION_LABELS[criterion]} 아래로`}
                  className="rounded border border-foreground/20 px-2 py-1 disabled:opacity-30"
                >
                  ↓
                </button>
              </li>
            ))}
          </ol>
          <p className="text-sm text-foreground/60">위에 있을수록 공고 적합도 점수에 크게 반영됩니다. 합계 100점</p>
        </div>
      )}

      {step === "confirm" && (
        <div className="space-y-6">
          <label className="block space-y-1">
            <span className="text-sm font-medium">트랙 이름</span>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={50} className={inputClass} />
          </label>
          <dl className="divide-y divide-foreground/10 border-y border-foreground/10 text-sm">
            {[
              ["분야", majorName ?? ""],
              ["직무", jobs.map((j) => j.label).join(", ")],
              ["지원 유형", applicantType ? APPLICANT_TYPE_LABELS[applicantType] : ""],
              ...(experienceText ? [["일한 기간", experienceText]] : []),
              ["근무 가능 지역", regions.map((id) => REGIONS.find((r) => r.id === id)?.label).join(" → ")],
              ["희망 최소 연봉", salary ? `${Number(salary).toLocaleString("ko-KR")}만원` : "정하지 않음"],
              ["고용 형태", employmentTypes.map((t) => EMPLOYMENT_TYPE_LABELS[t]).join(", ")],
              ...extraQuestions.map((q) => [
                q.label,
                q.options.find((o) => o.value === extraAnswers[q.id])?.label ?? "답하지 않음",
              ]),
              ["중요도", order.map((c, i) => `${CRITERION_LABELS[c]} ${WEIGHTS_BY_RANK[i]}`).join(" · ")],
            ].map(([label, value]) => (
              <div key={label} className="flex gap-4 py-2">
                <dt className="w-32 shrink-0 text-foreground/60">{label}</dt>
                <dd className="min-w-0 flex-1">{value}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      {(shownErrors.length > 0 || message) && (
        <div role="alert" className="space-y-1 text-sm text-red-600">
          {shownErrors.map((text) => (
            <p key={text}>{text}</p>
          ))}
          {message && <p>{message}</p>}
        </div>
      )}

      <div className="flex items-center gap-3">
        {stepIndex > 0 && (
          <button type="button" onClick={back} disabled={pending} className="rounded-lg border border-foreground/20 px-4 py-2">
            이전
          </button>
        )}
        {step !== "confirm" ? (
          <button type="button" onClick={next} className="rounded-lg bg-foreground px-4 py-2 font-medium text-background">
            다음
          </button>
        ) : (
          <button
            type="button"
            onClick={submit}
            disabled={pending}
            className="rounded-lg bg-foreground px-4 py-2 font-medium text-background disabled:opacity-60"
          >
            {pending ? "저장 중…" : trackId ? "저장" : "만들기"}
          </button>
        )}
        {!isFirst && (
          <Link href="/" className="ml-auto text-sm underline">
            취소
          </Link>
        )}
      </div>
    </div>
  );
}
