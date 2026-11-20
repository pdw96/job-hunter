import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { requireUser } from "@/lib/session";
import { getCommonResume } from "@/modules/applications/resume-repo";
import { listResumeSources, oldRecordIds } from "@/modules/experiences/sources";
import { getTrack } from "@/modules/tracks/repo";
import { StartInterview } from "../../../experiences/start-interview";
import { editorData } from "../../../_resume/editor-data";
import { ResumeEditor } from "../../../_resume/resume-editor";
import { StartCommon } from "./start-common";

// 트랙의 이력서 공통본. 검사는 그릴 때마다 지금의 쓸 수 있는 경험으로 계산한다
export default async function CommonResumePage({ params }: { params: Promise<{ trackId: string }> }) {
  const user = await requireUser();
  const { trackId } = await params;
  // 없는 트랙과 남의 트랙을 구분하지 않고 404로 보낸다
  const track = await getTrack(db, user.id, trackId);
  if (!track) notFound();

  const [resume, sources, oldIds] = await Promise.all([
    getCommonResume(db, user.id, track.id),
    listResumeSources(db, user.id, track.id),
    oldRecordIds(db, user.id),
  ]);
  const data = resume ? editorData(resume, sources, null, oldIds) : null;

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <p className="text-sm text-foreground/60">
          <Link href="/" className="underline">
            홈으로
          </Link>
        </p>
        <h1 className="text-2xl font-bold">{track.name} · 이력서 공통본</h1>
        <p className="text-sm text-foreground/70">
          {"확인된 경험 중 이 트랙에서 '사용'은 자세히, '요약만'은 한두 줄로 씁니다. 연락처는 내려받을 때 넣습니다"}
        </p>
      </div>

      {data ? (
        <ResumeEditor data={data} readOnly={false} tailored={false} />
      ) : sources.length === 0 ? (
        <div className="space-y-2 rounded-lg bg-foreground/5 p-3">
          <p className="text-sm">이 트랙에 쓸 수 있는 확인된 기록이 없습니다</p>
          <StartInterview tracks={[{ id: track.id, name: track.name }]} />
        </div>
      ) : (
        <StartCommon trackId={track.id} count={sources.length} />
      )}
    </div>
  );
}
