import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { requireUser } from "@/lib/session";
import { EXCLUSION_LABELS, exclusionReasons } from "@/modules/postings/exclusion";
import { CAREER_TYPE_LABELS, POSTING_EMPLOYMENT_LABELS, POSTING_STATUS_LABELS } from "@/modules/postings/options";
import { recordHrefs } from "@/modules/experiences/record-href";
import { listEvidenceCandidates } from "@/modules/experiences/sources";
import { listQuestions } from "@/modules/applications/repo";
import { getTailoredCareer } from "@/modules/applications/career-repo";
import { getTailoredResume } from "@/modules/applications/resume-repo";
import { isLocked, listSubmissions } from "@/modules/applications/submission-repo";
import { submitPreview } from "@/modules/applications/submit";
import { companyKey } from "@/modules/postings/company";
import { chosenDocuments } from "@/modules/postings/documents";
import { getPosting } from "@/modules/postings/repo";
import { hostOf, wantsTalent } from "@/modules/postings/research";
import { getResearch } from "@/modules/postings/research-repo";
import { fieldStale, scorePosting, usableOf } from "@/modules/postings/score";
import { koreaDate, koreaMonthDay, todayInKorea } from "@/modules/postings/today";
import { REGIONS } from "@/modules/tracks/options";
import { getTrack } from "@/modules/tracks/repo";
import { deadlineLabel } from "../deadline";
import { PostingActions } from "../posting-actions";
import { DocumentsSection } from "./documents-section";
import { ResearchSection } from "./research-section";
import { kickFromApply, researchView } from "./research-view";
import { ScoreSection } from "./score-section";
import { SubmitPanel } from "./submit-panel";

// 지원(회사 조사를 응답 뒤에 돌린다)과 다시 조사가 이 페이지의 서버 액션이다. after()는 이 시간 안에서 돈다
export const maxDuration = 300;

const regionLabel = (id: string) => REGIONS.find((region) => region.id === id)?.label ?? id;

export default async function PostingPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  // 없는 공고와 남의 공고를 구분하지 않고 404로 보낸다
  const posting = await getPosting(db, user.id, id);
  if (!posting) notFound();

  const today = todayInKorea();
  const key = companyKey(posting.company);
  const [track, candidates, questions, tailored, tailoredCareer, submissions, research] = await Promise.all([
    getTrack(db, user.id, posting.trackId),
    listEvidenceCandidates(db, user.id, posting.trackId),
    listQuestions(db, user.id, posting.id),
    getTailoredResume(db, user.id, posting.id),
    getTailoredCareer(db, user.id, posting.id),
    listSubmissions(db, user.id, posting.id),
    key ? getResearch(db, user.id, key) : Promise.resolve(null),
  ]);
  const hrefs = await recordHrefs(db, user.id, candidates.map((c) => c.id));
  const latest = submissions.at(-1) ?? null;
  const locked = isLocked(latest);
  const preview = posting.status === "apply" && !locked ? await submitPreview(db, user.id, posting) : null;
  const chosen = chosenDocuments(posting);
  const reasons = track ? exclusionReasons(posting, track, today) : [];
  // 점수는 그릴 때마다 지금의 경험 후보로 계산한다(지웠거나 확인을 풀었거나 맞댄 뒤 고친 경험은 바로 빠진다)
  const score =
    track && posting.analysis
      ? scorePosting({ posting, track, analysis: posting.analysis, usable: usableOf(candidates) })
      : null;

  const isApply = posting.status === "apply";
  // 회사 조사는 회사 단위다. 지원 공고에서는 늘 보이고, 아니면 같은 회사의 조사가 있을 때 읽기로만 보인다
  const showResearch = key !== "" && (isApply || research !== null);
  const now = new Date();
  const view = researchView(research, now);

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

      <ScoreSection
        id={posting.id}
        analysis={posting.analysis}
        score={score}
        fieldStale={track !== null && posting.analysis !== null && fieldStale(posting.analysis, track)}
        // 관심으로 되돌리면 지원할 때의 점수는 남겨 두되 보여 주지 않는다
        appliedScore={posting.status === "apply" ? posting.appliedScore : null}
        candidates={candidates.map((c) => ({ id: c.id, name: c.name, contentVersion: c.contentVersion, href: hrefs.get(c.id) ?? null }))}
      />

      <DocumentsSection
        id={posting.id}
        isApply={posting.status === "apply"}
        locked={locked}
        found={posting.foundDocuments}
        chosen={chosen}
        userChose={(posting.chosenDocuments?.length ?? 0) > 0}
        questionCount={questions.length}
      />

      {showResearch && (
        <ResearchSection
          postingId={posting.id}
          company={research?.company ?? posting.company}
          isApply={isApply}
          view={view}
          runKey={research ? research.startedAt.toISOString() : "none"}
          kickAt={kickFromApply({ isApply, state: view.state, appliedAt: posting.appliedScore?.appliedAt ?? null }, now)}
          lastDate={research?.researchedAt ? koreaDate(research.researchedAt) : null}
          talent={research?.talent ? { ...research.talent, host: hostOf(research.talent.url) } : null}
          talentSkipped={research?.talentSkipped ?? false}
          postingWantsTalent={wantsTalent(posting)}
          news={(research?.news ?? []).map((item) => ({ ...item, host: hostOf(item.url) }))}
        />
      )}

      {posting.status !== "apply" && (questions.length > 0 || tailored?.content || tailoredCareer?.content) && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {questions.length > 0 && (
            <Link href={`/postings/${posting.id}/application`} className="inline-block text-sm underline">
              자소서 보기 · 문항 {questions.length}개
            </Link>
          )}
          {tailored?.content && (
            <Link href={`/postings/${posting.id}/resume`} className="inline-block text-sm underline">
              이력서 맞춤본 보기
            </Link>
          )}
          {tailoredCareer?.content && (
            <Link href={`/postings/${posting.id}/career`} className="inline-block text-sm underline">
              경력기술서 맞춤본 보기
            </Link>
          )}
        </div>
      )}

      <SubmitPanel
        postingId={posting.id}
        lastNumber={latest?.number ?? 0}
        locked={locked}
        isApply={posting.status === "apply"}
        preview={preview}
        withResume={chosen.includes("resume")}
        withLetter={chosen.includes("cover_letter")}
        withCareer={chosen.includes("career")}
        submissions={submissions.map((item) => ({
          number: item.number,
          dateLabel: koreaDate(item.submittedAt),
          shortLabel: koreaMonthDay(item.submittedAt),
        }))}
      />

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

      <PostingActions
        id={posting.id}
        status={posting.status}
        hasReasons={reasons.length > 0}
        excludeOverride={posting.excludeOverride}
        hasAnalysis={posting.analysis !== null}
        submissionCount={submissions.length}
      />

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
