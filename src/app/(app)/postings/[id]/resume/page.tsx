import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { requireUser } from "@/lib/session";
import { getCommonResume, getTailoredResume } from "@/modules/applications/resume-repo";
import { listResumeSources } from "@/modules/experiences/writing";
import { getPosting } from "@/modules/postings/repo";
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

  const [common, tailored, sources] = await Promise.all([
    getCommonResume(db, user.id, posting.trackId),
    getTailoredResume(db, user.id, posting.id),
    listResumeSources(db, user.id, posting.trackId),
  ]);
  const canAct = posting.status === "apply";
  const hasCommon = common?.content != null;
  const byId = new Map(sources.map((source) => [source.id, source]));

  let selection: EmphasisSelectionView | null = null;
  if (tailored?.selection) {
    const s = tailored.selection;
    selection = {
      selectedAt: s.selectedAt,
      noMatch: s.noMatch,
      picks: s.picks.map((pick) => ({ experienceId: pick.experienceId, name: byId.get(pick.experienceId)?.name ?? null, why: pick.why })),
    };
  }
  const picked = new Set(selection?.picks.map((pick) => pick.experienceId) ?? []);
  const others: OtherView[] = sources
    .filter((source) => !picked.has(source.id))
    .map((source) => ({ experienceId: source.id, name: source.name, summary: source.scope === "summary" }));

  // 공통본이 없어졌으면 맞춤본이 기억한 공통본 version과 비교해 "공통본을 고친 뒤"를 띄우지 않는다
  const commonVersion = common?.version ?? tailored?.content?.commonVersion ?? 0;
  const data = tailored ? editorData(tailored, sources, commonVersion) : null;

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

      {!canAct && <p className="rounded-lg bg-foreground/5 p-3 text-sm">지원으로 고른 공고에서만 맞춤본을 만들고 고칠 수 있습니다</p>}

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
        !canAct && <p className="text-sm text-foreground/70">아직 만든 맞춤본이 없습니다</p>
      )}
    </div>
  );
}
