import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { requireUser } from "@/lib/session";
import { EXCLUSION_LABELS, exclusionReasons } from "@/modules/postings/exclusion";
import { CAREER_TYPE_LABELS, POSTING_EMPLOYMENT_LABELS, POSTING_STATUS_LABELS } from "@/modules/postings/options";
import { getPosting } from "@/modules/postings/repo";
import { todayInKorea } from "@/modules/postings/today";
import { REGIONS } from "@/modules/tracks/options";
import { getTrack } from "@/modules/tracks/repo";
import { deadlineLabel } from "../deadline";
import { PostingActions } from "../posting-actions";

const regionLabel = (id: string) => REGIONS.find((region) => region.id === id)?.label ?? id;

export default async function PostingPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  // 없는 공고와 남의 공고를 구분하지 않고 404로 보낸다
  const posting = await getPosting(db, user.id, id);
  if (!posting) notFound();

  const today = todayInKorea();
  const track = await getTrack(db, user.id, posting.trackId);
  const reasons = track ? exclusionReasons(posting, track, today) : [];

  const facts: [string, string][] = [
    ["트랙", track?.name ?? ""],
    ["마감", deadlineLabel(posting.deadline, posting.isRolling, today)],
    ["근무지", [posting.locationText, posting.regions.map(regionLabel).join(", ")].filter(Boolean).join(" · ") || "적혀 있지 않음"],
    [
      "경력",
      CAREER_TYPE_LABELS[posting.careerType] + (posting.minYears !== null ? ` · ${posting.minYears}년 이상` : ""),
    ],
    ["고용 형태", POSTING_EMPLOYMENT_LABELS[posting.employmentType]],
  ];

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <p className="text-sm text-foreground/60">
          <Link href={`/postings?track=${posting.trackId}`} className="underline">
            공고
          </Link>
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="min-w-0 text-2xl font-bold">{posting.company}</h1>
          <span className="rounded-full border border-foreground/20 px-2 py-0.5 text-xs">{POSTING_STATUS_LABELS[posting.status]}</span>
        </div>
        <p className="text-foreground/70">{posting.title}</p>
      </div>

      {reasons.length > 0 && (
        <section
          className={`space-y-2 rounded-lg border p-4 ${posting.excludeOverride ? "border-foreground/20" : "border-amber-600/40"}`}
          aria-label="제외 조건"
        >
          <h2 className="font-semibold">
            {posting.excludeOverride ? "희망 조건과 다른 점이 있지만 진행하기로 했습니다" : "희망 조건과 다른 점이 있습니다"}
          </h2>
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {reasons.map((reason) => (
              <li key={reason}>{EXCLUSION_LABELS[reason]}</li>
            ))}
          </ul>
        </section>
      )}

      <dl className="grid grid-cols-[6rem_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
        {facts.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-foreground/60">{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
        {posting.url && (
          <div className="contents">
            <dt className="text-foreground/60">주소</dt>
            <dd className="min-w-0 truncate">
              <a href={posting.url} target="_blank" rel="noreferrer noopener" className="underline">
                {posting.url}
              </a>
            </dd>
          </div>
        )}
      </dl>

      <PostingActions id={posting.id} status={posting.status} hasReasons={reasons.length > 0} excludeOverride={posting.excludeOverride} />

      <section className="space-y-2">
        <h2 className="font-semibold">공고 원문</h2>
        <pre className="max-h-[32rem] overflow-auto whitespace-pre-wrap break-words rounded-lg bg-foreground/5 p-4 text-sm">{posting.rawText}</pre>
      </section>

      {posting.companyNote && (
        <section className="space-y-2">
          <h2 className="font-semibold">인재상·회사 소개</h2>
          <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-foreground/5 p-4 text-sm">{posting.companyNote}</pre>
        </section>
      )}
    </div>
  );
}
