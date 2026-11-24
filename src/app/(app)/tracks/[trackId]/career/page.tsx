import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { requireUser } from "@/lib/session";
import { getCommonCareer } from "@/modules/applications/career-repo";
import { CAREER_LIMITS } from "@/modules/applications/options";
import { recordHrefs } from "@/modules/experiences/record-href";
import { listCareerSources } from "@/modules/experiences/sources";
import { getTrack } from "@/modules/tracks/repo";
import { AddRecordLink } from "../../../records/_shared/add-record-link";
import { careerEditorData } from "../../../_career/editor-data";
import { CareerEditor } from "../../../_career/career-editor";
import { StartCareer } from "./start-career";

// 트랙의 경력기술서 공통본. 검사는 그릴 때마다 지금의 확인된 경력과 항목으로 계산한다
export default async function CommonCareerPage({ params }: { params: Promise<{ trackId: string }> }) {
  const user = await requireUser();
  const { trackId } = await params;
  // 없는 트랙과 남의 트랙을 구분하지 않고 404로 보낸다
  const track = await getTrack(db, user.id, trackId);
  if (!track) notFound();

  const [career, sources] = await Promise.all([getCommonCareer(db, user.id, track.id), listCareerSources(db, user.id, track.id)]);
  const itemIds = (career?.content?.companies ?? []).flatMap((company) => company.items.map((item) => item.experienceId));
  const hrefs = await recordHrefs(db, user.id, itemIds);
  const data = career ? careerEditorData(career, sources, null, hrefs) : null;
  // 처음 만들 때 항목은 회사 순서대로 한도까지만 넣는다
  const items = Math.min(
    sources.reduce((sum, source) => sum + source.items.length, 0),
    CAREER_LIMITS.items,
  );

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <p className="text-sm text-foreground/60">
          <Link href="/" className="underline">
            홈으로
          </Link>
        </p>
        <h1 className="text-2xl font-bold">{track.name} · 경력기술서 공통본</h1>
        <p className="text-sm text-foreground/70">확인된 경력과 그 아래 프로젝트·업무로 씁니다. 회사 정보는 기록에서 그대로 가져옵니다</p>
      </div>

      {data ? (
        <CareerEditor data={data} readOnly={false} tailored={false} />
      ) : sources.length === 0 ? (
        <div className="space-y-2 rounded-lg bg-foreground/5 p-3">
          <p className="text-sm">경력이 없어 경력기술서를 만들 수 없습니다</p>
          <AddRecordLink href="/records" label="경험 기록으로" />
        </div>
      ) : (
        <StartCareer trackId={track.id} jobs={sources.length} items={items} />
      )}
    </div>
  );
}
