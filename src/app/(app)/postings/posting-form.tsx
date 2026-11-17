"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { readPostingAction, savePostingAction } from "@/modules/postings/actions";
import type { PostingErrors, PostingInput } from "@/modules/postings/input";
import {
  CAREER_TYPE_LABELS,
  CAREER_TYPES,
  type CareerType,
  POSTING_EMPLOYMENT_LABELS,
  POSTING_EMPLOYMENT_TYPES,
  type PostingEmploymentType,
} from "@/modules/postings/options";
import { REGIONS } from "@/modules/tracks/options";

// 폼에서는 숫자와 날짜도 글로 들고 있다가 저장할 때 서버가 검사한다
type Draft = Omit<PostingInput, "deadline" | "minYears" | "locationText" | "url" | "companyNote"> & {
  deadline: string;
  minYears: string;
  locationText: string;
  url: string;
  companyNote: string;
};

const EMPTY: Draft = {
  company: "",
  title: "",
  deadline: "",
  isRolling: false,
  locationText: "",
  regions: [],
  careerType: "any",
  minYears: "",
  employmentType: "unknown",
  url: "",
  rawText: "",
  companyNote: "",
};

const toDraft = (input: PostingInput): Draft => ({
  ...input,
  deadline: input.deadline ?? "",
  minYears: input.minYears === null ? "" : String(input.minYears),
  locationText: input.locationText ?? "",
  url: input.url ?? "",
  companyNote: input.companyNote ?? "",
});

const WORK_REGIONS = REGIONS.filter((region) => region.id !== "anywhere");
const field = "w-full rounded-lg border border-foreground/20 bg-transparent px-3 py-2";

// 공고 넣기와 고치기. 새 공고는 원문을 붙여 넣고 AI로 값을 뽑거나 직접 채운다
export function PostingForm({
  tracks,
  trackId: initialTrackId,
  id,
  initial,
}: {
  tracks: { id: string; name: string }[];
  trackId: string;
  id?: string;
  initial?: PostingInput;
}) {
  const router = useRouter();
  const [trackId, setTrackId] = useState(initialTrackId);
  const [draft, setDraft] = useState<Draft>(initial ? toDraft(initial) : EMPTY);
  // 새 공고는 원문을 넣는 단계에서 시작한다
  const [step, setStep] = useState<"paste" | "fields">(id ? "fields" : "paste");
  const [unverified, setUnverified] = useState<string[]>([]);
  const [errors, setErrors] = useState<PostingErrors>({});
  const [message, setMessage] = useState<string | null>(null);
  const [similar, setSimilar] = useState<{ id: string; company: string; title: string }[] | null>(null);
  const [pending, startTransition] = useTransition();

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((previous) => ({ ...previous, [key]: value }));
    setSimilar(null);
  };

  function read() {
    setMessage(null);
    startTransition(async () => {
      const result = await readPostingAction(draft.rawText);
      if (!result.ok) return setMessage(result.message);
      const { unverified: doubts, ...value } = result.value;
      setDraft((previous) => ({
        ...previous,
        ...value,
        deadline: value.deadline ?? "",
        minYears: value.minYears === null ? "" : String(value.minYears),
        locationText: value.locationText ?? "",
      }));
      setUnverified(doubts);
      setStep("fields");
    });
  }

  function save(force = false) {
    setMessage(null);
    setErrors({});
    startTransition(async () => {
      const result = await savePostingAction(trackId, draft, { id, force });
      if (result.ok) {
        router.push(`/postings/${result.id}`);
        return;
      }
      if (result.similar) return setSimilar(result.similar);
      setErrors(result.errors ?? {});
      setMessage(result.message ?? "고칠 곳이 있습니다. 표시된 칸을 확인해 주세요");
    });
  }

  const error = (key: keyof PostingInput) =>
    errors[key] && (
      <span role="alert" className="block text-sm text-red-600">
        {errors[key]}
      </span>
    );

  if (step === "paste") {
    return (
      <form
        className="max-w-2xl space-y-6"
        onSubmit={(e) => {
          e.preventDefault();
          read();
        }}
      >
        <div className="space-y-2">
          <h1 className="text-2xl font-bold">공고 넣기</h1>
          <p className="text-sm text-foreground/70">
            채용 사이트의 공고 글을 복사해 붙여 넣으면, AI가 회사명과 마감일 같은 값을 뽑아 채웁니다. 뽑은 값은 저장하기 전에 확인하고
            고칠 수 있습니다
          </p>
        </div>

        <fieldset disabled={pending} className="mx-0 min-w-0 space-y-6 border-0 p-0 disabled:opacity-70">
          {tracks.length > 1 && (
            <label className="block space-y-1">
              <span className="text-sm font-medium">트랙</span>
              <select value={trackId} onChange={(e) => setTrackId(e.target.value)} className={field}>
                {tracks.map((track) => (
                  <option key={track.id} value={track.id}>
                    {track.name}
                  </option>
                ))}
              </select>
            </label>
          )}

          <label className="block space-y-1">
            <span className="text-sm font-medium">공고 원문</span>
            <textarea
              value={draft.rawText}
              onChange={(e) => set("rawText", e.target.value)}
              rows={12}
              placeholder="공고 글 전체를 붙여 넣어 주세요 (3만 자까지)"
              className={field}
            />
            <span className="block text-xs text-foreground/60">원문은 고치지 않고 그대로 보관합니다</span>
          </label>

          <label className="block space-y-1">
            <span className="text-sm font-medium">공고 주소 (선택)</span>
            <input
              type="url"
              value={draft.url}
              onChange={(e) => set("url", e.target.value)}
              placeholder="https://"
              className={field}
            />
          </label>

          <label className="block space-y-1">
            <span className="text-sm font-medium">인재상·회사 소개 (선택)</span>
            <textarea
              value={draft.companyNote}
              onChange={(e) => set("companyNote", e.target.value)}
              rows={4}
              placeholder="회사 홈페이지의 인재상이나 소개 글이 있으면 붙여 넣어 주세요. 나중에 적합도를 볼 때 씁니다"
              className={field}
            />
          </label>
        </fieldset>

        {message && (
          <p role="alert" className="text-sm text-red-600">
            {message}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={pending || draft.rawText.trim() === ""}
            className="rounded-lg bg-foreground px-4 py-2 font-medium text-background disabled:opacity-50"
          >
            {pending ? "읽는 중…" : "읽기"}
          </button>
          <button
            type="button"
            disabled={pending || draft.rawText.trim() === ""}
            onClick={() => setStep("fields")}
            className="rounded-lg border border-foreground/20 px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            직접 채우기
          </button>
          <Link href="/postings" className="text-sm underline">
            취소
          </Link>
        </div>
      </form>
    );
  }

  return (
    <form
      className="max-w-2xl space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">{id ? "공고 고치기" : "뽑은 값 확인"}</h1>
        {!id && (
          <p className="text-sm text-foreground/70">
            공고에 적혀 있지 않은 값은 비워 두었습니다. 틀린 곳을 고치고 저장해 주세요
          </p>
        )}
        {unverified.length > 0 && (
          <p className="text-sm text-amber-700 dark:text-amber-400">
            {unverified.map((key) => (key === "company" ? "회사명" : "직무명")).join(", ")}을 원문에서 글자 그대로 찾지 못했습니다. 맞는지
            확인해 주세요
          </p>
        )}
      </div>

      <fieldset disabled={pending} className="mx-0 min-w-0 space-y-6 border-0 p-0 disabled:opacity-70">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block space-y-1">
            <span className="text-sm font-medium">회사명</span>
            <input value={draft.company} onChange={(e) => set("company", e.target.value)} className={field} />
            {error("company")}
          </label>
          <label className="block space-y-1">
            <span className="text-sm font-medium">직무명</span>
            <input value={draft.title} onChange={(e) => set("title", e.target.value)} className={field} />
            {error("title")}
          </label>
        </div>

        <div className="space-y-2">
          <label className="block space-y-1">
            <span className="text-sm font-medium">마감일</span>
            <input
              type="date"
              value={draft.deadline}
              min="2000-01-01"
              max="2099-12-31"
              disabled={draft.isRolling}
              onChange={(e) => set("deadline", e.target.value)}
              className={`${field} block disabled:opacity-40 sm:w-60`}
            />
            {error("deadline")}
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={draft.isRolling} onChange={(e) => set("isRolling", e.target.checked)} />
            상시 채용 (채용 시 마감)
          </label>
        </div>

        <div className="space-y-2">
          <label className="block space-y-1">
            <span className="text-sm font-medium">근무지</span>
            <input
              value={draft.locationText}
              onChange={(e) => set("locationText", e.target.value)}
              placeholder="공고에 적힌 그대로 (예: 서울 강남구)"
              className={field}
            />
            {error("locationText")}
          </label>
          <fieldset className="m-0 border-0 p-0">
            <legend className="text-xs text-foreground/60">시·도 (희망 지역과 견줄 때 씁니다. 모르면 비워 두세요)</legend>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm">
              {WORK_REGIONS.map((region) => (
                <label key={region.id} className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={draft.regions.includes(region.id)}
                    onChange={(e) =>
                      set(
                        "regions",
                        e.target.checked ? [...draft.regions, region.id] : draft.regions.filter((item) => item !== region.id),
                      )
                    }
                  />
                  {region.label}
                </label>
              ))}
            </div>
            {error("regions")}
          </fieldset>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <label className="block space-y-1">
            <span className="text-sm font-medium">신입·경력</span>
            <select value={draft.careerType} onChange={(e) => set("careerType", e.target.value as CareerType)} className={field}>
              {CAREER_TYPES.map((type) => (
                <option key={type} value={type}>
                  {CAREER_TYPE_LABELS[type]}
                </option>
              ))}
            </select>
            {error("careerType")}
          </label>
          <label className="block space-y-1">
            <span className="text-sm font-medium">요구 경력 (년)</span>
            <input
              type="number"
              min={0}
              max={40}
              step={1}
              value={draft.minYears}
              onChange={(e) => set("minYears", e.target.value)}
              placeholder="없으면 비움"
              className={field}
            />
            {error("minYears")}
          </label>
          <label className="block space-y-1">
            <span className="text-sm font-medium">고용 형태</span>
            <select
              value={draft.employmentType}
              onChange={(e) => set("employmentType", e.target.value as PostingEmploymentType)}
              className={field}
            >
              {POSTING_EMPLOYMENT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {POSTING_EMPLOYMENT_LABELS[type]}
                </option>
              ))}
            </select>
            {error("employmentType")}
          </label>
        </div>

        {id && (
          <>
            <label className="block space-y-1">
              <span className="text-sm font-medium">공고 주소 (선택)</span>
              <input type="url" value={draft.url} onChange={(e) => set("url", e.target.value)} placeholder="https://" className={field} />
            </label>
            <label className="block space-y-1">
              <span className="text-sm font-medium">인재상·회사 소개 (선택)</span>
              <textarea value={draft.companyNote} onChange={(e) => set("companyNote", e.target.value)} rows={4} className={field} />
            </label>
          </>
        )}
        {error("url")}
        {error("companyNote")}
        {error("rawText")}
      </fieldset>

      {similar && (
        <div className="space-y-2 rounded-lg border border-amber-600/40 p-4 text-sm" role="alert">
          <p>같은 회사와 직무의 공고가 이미 있습니다. 그래도 새로 넣을까요?</p>
          <ul className="list-disc pl-5">
            {similar.map((item) => (
              <li key={item.id}>
                <Link href={`/postings/${item.id}`} className="underline">
                  {item.company} · {item.title}
                </Link>
              </li>
            ))}
          </ul>
          <button type="button" disabled={pending} onClick={() => save(true)} className="rounded-lg border border-foreground/20 px-3 py-1.5 font-medium">
            그래도 넣기
          </button>
        </div>
      )}

      {message && (
        <p role="alert" className="text-sm text-red-600">
          {message}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className="rounded-lg bg-foreground px-4 py-2 font-medium text-background disabled:opacity-50">
          {pending ? "저장하는 중…" : "저장"}
        </button>
        {!id && (
          <button type="button" disabled={pending} onClick={() => setStep("paste")} className="text-sm underline">
            원문으로 돌아가기
          </button>
        )}
        <Link href={id ? `/postings/${id}` : "/postings"} className="text-sm underline">
          취소
        </Link>
      </div>
    </form>
  );
}
