import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { requireUser } from "@/lib/session";
import { getCommonResume, getTailoredResume } from "@/modules/applications/resume-repo";
import { getSubmission, isLocked, latestSubmission } from "@/modules/applications/submission-repo";
import { recordHrefs } from "@/modules/experiences/record-href";
import { listResumeSources, oldRecordIds } from "@/modules/experiences/sources";
import { getPosting } from "@/modules/postings/repo";
import { koreaDate } from "@/modules/postings/today";
import { editorData } from "../../../_resume/editor-data";
import { ResumeEditor } from "../../../_resume/resume-editor";
import { type EmphasisSelectionView, EmphasisPicker, type OtherView } from "./emphasis-picker";

// 공고의 이력서 맞춤본. 지원으로 고른 공고에서만 만들고 고친다. 검사는 그릴 때마다 지금의 경험으로 계산한다
export default async function TailoredResumePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  // 없는 공고와 남의 공고를 구분하지 않고 404로 보낸다
  const posting = await getPosting(db, user.id, id);
  if (!posting) notFound();

  const [common, tailored, sources, latest, oldIds] = await Promise.all([
    getCommonResume(db, user.id, posting.trackId),
    getTailoredResume(db, user.id, posting.id),
    listResumeSources(db, user.id, posting.trackId),
    latestSubmission(db, user.id, posting.id),
    oldRecordIds(db, user.id),
  ]);
  const locked = isLocked(latest);
  const isApply = posting.status === "apply";
  const canAct = isApply && !locked;
  const hasCommon = common?.content != null;
  const byId = new Map(sources.map((source) => [source.id, source]));
  const hrefs = await recordHrefs(db, user.id, [...sources.map((source) => source.id), ...(tailored?.selection?.picks.map((pick) => pick.experienceId) ?? [])]);
  const hrefOf = (id: string) => hrefs.get(id) ?? null;

  let selection: EmphasisSelectionView | null = null;
  if (tailored?.selection) {
    const s = tailored.selection;
    selection = {
      selectedAt: s.selectedAt,
      noMatch: s.noMatch,
      picks: s.picks.map((pick) => ({ experienceId: pick.experienceId, name: byId.get(pick.experienceId)?.name ?? null, href: hrefOf(pick.experienceId), why: pick.why })),
    };
  }
  const picked = new Set(selection?.picks.map((pick) => pick.experienceId) ?? []);
  const others: OtherView[] = sources
    .filter((source) => !picked.has(source.id))
    .map((source) => ({ experienceId: source.id, name: source.name, href: hrefOf(source.id), summary: source.scope === "summary", fact: source.codeLines !== undefined }));

  // 공통본이 없어졌으면 맞춤본이 기억한 공통본 version과 비교해 "공통본을 고친 뒤"를 띄우지 않는다
  const commonVersion = common?.version ?? tailored?.content?.commonVersion ?? 0;
  const data = tailored ? editorData(tailored, sources, commonVersion, oldIds) : null;

  // 맞춤본이 없을 때의 안내. 잠겼으면 마지막 제출본이 무엇으로 냈는지 알린다
  let emptyNote = "아직 만든 맞춤본이 없습니다";
  if (isApply && locked && latest) {
    const last = await getSubmission(db, user.id, posting.id, latest.number);
    emptyNote = last?.content.resume?.from === "common" ? "트랙 공통본으로 제출했습니다" : last && !last.content.resume ? "이력서 없이 제출했습니다" : emptyNote;
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <p className="text-sm text-foreground/60">
          <Link href={`/postings/${posting.id}`} className="underline">
            공고로 돌아가기
          </Link>
        </p>
        <h1 className="text-2xl font-bold">이력서 맞춤본</h1>
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

      {canAct && !hasCommon && (
        <div className="space-y-2 rounded-lg bg-foreground/5 p-3">
          <p className="text-sm">트랙의 이력서 공통본을 먼저 만들어 주세요</p>
          <Link href={`/tracks/${posting.trackId}/resume`} className="inline-block text-sm underline">
            이력서 공통본으로 가기
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
        />
      )}

      {data ? (
        <ResumeEditor data={data} readOnly={!canAct} tailored />
      ) : (
        !canAct && <p className="text-sm text-foreground/70">{emptyNote}</p>
      )}
    </div>
  );
}
