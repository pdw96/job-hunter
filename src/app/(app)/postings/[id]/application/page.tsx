import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { requireUser } from "@/lib/session";
import { checkDraft } from "@/modules/applications/check";
import { listQuestions, type Question } from "@/modules/applications/repo";
import { isLocked, latestSubmission } from "@/modules/applications/submission-repo";
import type { PassedReason, PickReason, SourceRef } from "@/modules/applications/types";
import { recordHrefs } from "@/modules/experiences/record-href";
import { listWritingSources, oldRecordIds, type WritingSource } from "@/modules/experiences/sources";
import { getPosting } from "@/modules/postings/repo";
import { koreaDate } from "@/modules/postings/today";
import { AddQuestions } from "./add-questions";
import type { DraftData } from "./draft-view";
import { type CandidateView, QuestionCard, type QuestionView, type SelectionView } from "./question-card";

// 자소서 화면. 검사와 겹침 표시는 지금의 쓸 수 있는 경험으로 여기서 계산해 카드에 넘긴다

// 승인한 경험이 지금 목록에 없거나 버전이 달라졌다
function isStale(approved: SourceRef[] | null | undefined, byId: Map<string, WritingSource>) {
  return (approved ?? []).some((ref) => {
    const current = byId.get(ref.experienceId);
    return !current || current.contentVersion !== ref.contentVersion;
  });
}

function toView(
  question: Question,
  index: number,
  all: Question[],
  sources: WritingSource[],
  byId: Map<string, WritingSource>,
  oldIds: Set<string>,
  hrefs: Map<string, string>,
): QuestionView {
  const candidate = (item: (PickReason | PassedReason) & { whyNot?: string }): CandidateView => {
    const source = byId.get(item.experienceId);
    return {
      experienceId: item.experienceId,
      name: source?.name ?? null,
      href: hrefs.get(item.experienceId) ?? null,
      metricCount: source?.metrics.length ?? 0,
      // 다른 문항에서 승인한 경험이면 몇 번 문항인지 알린다
      alsoIn: all.flatMap((other, i) =>
        i !== index && other.selection?.approved?.some((ref) => ref.experienceId === item.experienceId) ? [i + 1] : [],
      ),
      ...("overlap" in item ? { overlap: item.overlap, role: item.role } : { whyNot: (item as PassedReason).whyNot }),
    };
  };

  let selection: SelectionView | null = null;
  if (question.selection) {
    const s = question.selection;
    selection = {
      selectedAt: s.selectedAt,
      picks: s.picks.map(candidate),
      passed: s.passed.map(candidate),
      noMatch: s.noMatch,
      approvedIds: s.approved?.map((ref) => ref.experienceId) ?? [],
      approvedStale: s.approved !== null && isStale(s.approved, byId),
    };
  }

  let draft: DraftData | null = null;
  if (question.draft) {
    const ids = new Set([...question.draft.basedOn.map((ref) => ref.experienceId), ...question.draft.paragraphs.flatMap((p) => p.sources)]);
    draft = {
      draft: question.draft,
      check: checkDraft(question.draft, question, sources, { oldIds }),
      names: Object.fromEntries([...ids].flatMap((id) => (byId.has(id) ? [[id, byId.get(id)!.name]] : []))),
      limit: question.charLimit,
      countSpaces: question.countSpaces,
    };
  }

  return {
    id: question.id,
    number: index + 1,
    prompt: question.prompt,
    charLimit: question.charLimit,
    countSpaces: question.countSpaces,
    selection,
    draft,
  };
}

export default async function ApplicationPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  // 없는 공고와 남의 공고를 구분하지 않고 404로 보낸다
  const posting = await getPosting(db, user.id, id);
  if (!posting) notFound();

  const [questions, sources, latest, oldIds] = await Promise.all([
    listQuestions(db, user.id, posting.id),
    listWritingSources(db, user.id, posting.trackId),
    latestSubmission(db, user.id, posting.id),
    oldRecordIds(db, user.id),
  ]);
  const locked = isLocked(latest);
  const byId = new Map(sources.map((source) => [source.id, source]));
  // 후보마다 그 기록을 여는 화면(표마다 한 번 읽는다)
  const candidateIds = questions.flatMap((question) => [...(question.selection?.picks ?? []), ...(question.selection?.passed ?? [])].map((item) => item.experienceId));
  const hrefs = await recordHrefs(db, user.id, candidateIds);
  const views = questions.map((question, index) => toView(question, index, questions, sources, byId, oldIds, hrefs));
  const isApply = posting.status === "apply";
  const canAct = isApply && !locked;

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <p className="text-sm text-foreground/60">
          <Link href={`/postings/${posting.id}`} className="underline">
            공고로 돌아가기
          </Link>
        </p>
        <h1 className="text-2xl font-bold">자기소개서</h1>
        <p className="text-foreground/70">
          {posting.company} · {posting.title}
        </p>
      </div>

      {isApply && locked && latest && (
        <div className="space-y-1 rounded-lg bg-foreground/5 p-3 text-sm">
          <p>
            제출 {latest.number}({koreaDate(latest.submittedAt)})을 얼린 뒤라 고칠 수 없습니다. 고치려면 공고 화면에서 새 버전 만들기를 눌러 주세요
          </p>
          <Link href={`/postings/${posting.id}`} className="underline">
            공고 화면으로
          </Link>
        </div>
      )}

      {!isApply && (
        <p className="rounded-lg bg-foreground/5 p-3 text-sm">지원으로 고른 공고에서만 문항을 더하고 쓸 수 있습니다</p>
      )}

      {canAct && <AddQuestions postingId={posting.id} />}

      {views.length === 0 ? (
        <p className="text-sm text-foreground/70">아직 넣은 문항이 없습니다</p>
      ) : (
        <div className="space-y-4">
          {views.map((view) => (
            <QuestionCard key={view.id} question={view} canAct={canAct} />
          ))}
        </div>
      )}
    </div>
  );
}
