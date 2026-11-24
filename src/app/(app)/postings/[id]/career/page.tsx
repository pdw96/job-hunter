import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { requireUser } from "@/lib/session";
import { buildTailoredCareerAction, selectCareerEmphasisAction } from "@/modules/applications/career-actions";
import { getCommonCareer, getTailoredCareer } from "@/modules/applications/career-repo";
import { RESUME_LIMITS } from "@/modules/applications/options";
import { getSubmission, isLocked, latestSubmission } from "@/modules/applications/submission-repo";
import { recordHrefs } from "@/modules/experiences/record-href";
import { listCareerSources } from "@/modules/experiences/sources";
import { getPosting } from "@/modules/postings/repo";
import { koreaDate } from "@/modules/postings/today";
import { AddRecordLink } from "../../../records/_shared/add-record-link";
import { CareerEditor } from "../../../_career/career-editor";
import { careerEditorData } from "../../../_career/editor-data";
import { type EmphasisSelectionView, EmphasisPicker, type OtherView } from "../resume/emphasis-picker";

// 공고의 경력기술서 맞춤본. 지원으로 고른 공고에서만 만들고 고친다. 검사는 그릴 때마다 지금의 확인된 경력과 항목으로 계산한다
export default async function TailoredCareerPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  // 없는 공고와 남의 공고를 구분하지 않고 404로 보낸다
  const posting = await getPosting(db, user.id, id);
  if (!posting) notFound();

  const [common, tailored, sources, latest] = await Promise.all([
    getCommonCareer(db, user.id, posting.trackId),
    getTailoredCareer(db, user.id, posting.id),
    listCareerSources(db, user.id, posting.trackId),
    latestSubmission(db, user.id, posting.id),
  ]);
  const locked = isLocked(latest);
  const isApply = posting.status === "apply";
  const canAct = isApply && !locked;
  const hasCommon = common?.content != null;

  // 항목 id → "회사 · 항목 이름"(지금 그 항목이 딸린 회사로)
  const names = new Map(sources.flatMap((source) => source.items.map((item) => [item.id, `${source.company} · ${item.name}`] as const)));
  const placed = (tailored?.content?.companies ?? []).flatMap((company) => company.items.map((item) => item.experienceId));
  const picks = tailored?.selection?.picks ?? [];
  const hrefs = await recordHrefs(db, user.id, [...names.keys(), ...placed, ...picks.map((pick) => pick.experienceId)]);
  const hrefOf = (id: string) => hrefs.get(id) ?? null;

  let selection: EmphasisSelectionView | null = null;
  if (tailored?.selection) {
    const s = tailored.selection;
    selection = {
      selectedAt: s.selectedAt,
      noMatch: s.noMatch,
      picks: s.picks.map((pick) => ({ experienceId: pick.experienceId, name: names.get(pick.experienceId) ?? null, href: hrefOf(pick.experienceId), why: pick.why })),
    };
  }
  const picked = new Set(picks.map((pick) => pick.experienceId));
  const others: OtherView[] = sources.flatMap((source) =>
    source.items
      .filter((item) => !picked.has(item.id))
      .map((item) => ({ experienceId: item.id, name: `${source.company} · ${item.name}`, href: hrefOf(item.id), summary: item.scope === "summary", fact: false })),
  );

  // 공통본이 없어졌으면 맞춤본이 기억한 공통본 version과 비교해 "공통본을 고친 뒤"를 띄우지 않는다
  const commonVersion = common?.version ?? tailored?.content?.commonVersion ?? 0;
  const data = tailored ? careerEditorData(tailored, sources, commonVersion, hrefs) : null;

  // 맞춤본이 없을 때의 안내. 잠겼으면 마지막 제출본이 무엇으로 냈는지 알린다
  let emptyNote = "아직 만든 맞춤본이 없습니다";
  if (isApply && locked && latest) {
    const last = await getSubmission(db, user.id, posting.id, latest.number);
    emptyNote = last?.content.career?.from === "common" ? "트랙 공통본으로 제출했습니다" : last && !last.content.career ? "경력기술서 없이 제출했습니다" : emptyNote;
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <p className="text-sm text-foreground/60">
          <Link href={`/postings/${posting.id}`} className="underline">
            공고로 돌아가기
          </Link>
        </p>
        <h1 className="text-2xl font-bold">경력기술서 맞춤본</h1>
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

      {!isApply && <p className="rounded-lg bg-foreground/5 p-3 text-sm">지원으로 고른 공고에서만 맞춤본을 만들고 고칠 수 있습니다</p>}

      {canAct && !hasCommon && sources.length === 0 && (
        <div className="space-y-2 rounded-lg bg-foreground/5 p-3">
          <p className="text-sm">경력이 없어 경력기술서를 만들 수 없습니다</p>
          <AddRecordLink href="/records" label="경험 기록으로" />
        </div>
      )}

      {canAct && !hasCommon && sources.length > 0 && (
        <div className="space-y-2 rounded-lg bg-foreground/5 p-3">
          <p className="text-sm">트랙의 경력기술서 공통본을 먼저 만들어 주세요</p>
          <Link href={`/tracks/${posting.trackId}/career`} className="inline-block text-sm underline">
            경력기술서 공통본으로 가기
          </Link>
        </div>
      )}

      {canAct && hasCommon && (
        <EmphasisPicker
          postingId={posting.id}
          selection={selection}
          others={others}
          tailoredVersion={tailored?.version ?? null}
          hasTailored={data !== null}
          select={selectCareerEmphasisAction}
          build={buildTailoredCareerAction}
          noun="항목"
          limit={RESUME_LIMITS.emphasis}
        />
      )}

      {data ? (
        <CareerEditor data={data} readOnly={!canAct} tailored />
      ) : (
        !canAct && <p className="text-sm text-foreground/70">{emptyNote}</p>
      )}
    </div>
  );
}
