import { notFound } from "next/navigation";
import { db } from "@/db";
import { requireUser } from "@/lib/session";
import { getFact, listFacts } from "@/modules/experiences/facts-repo";
import { getInterview, isSceneInterview } from "@/modules/experiences/interview";
import { getScene } from "@/modules/experiences/scenes-repo";
import { newRecordsOn } from "@/modules/experiences/switch";
import { listTracks } from "@/modules/tracks/repo";
import { cardOf } from "../../fact-summary";
import { headOptionsOf } from "../../scenes/heads";
import { SceneInterviewChat } from "../scene-chat";

export default async function SceneInterviewPage({ params }: { params: Promise<{ interviewId: string }> }) {
  if (!newRecordsOn()) notFound();
  const user = await requireUser();
  const { interviewId } = await params;
  // 없는 인터뷰, 남의 인터뷰, 옛 경험 인터뷰를 구분하지 않고 404로 보낸다
  const interview = await getInterview(db, user.id, interviewId);
  if (!interview || !isSceneInterview(interview)) notFound();

  const scene = interview.sceneId ? await getScene(db, user.id, interview.sceneId) : null;
  const ref = scene?.head ?? interview.head;
  if (!ref) notFound();
  const [headFact, facts, tracks] = await Promise.all([getFact(db, user.id, ref.kind, ref.id), listFacts(db, user.id), listTracks(db, user.id)]);
  const trackList = tracks.map((t) => ({ id: t.id, name: t.name }));
  const heads = headOptionsOf(facts);

  return (
    <SceneInterviewChat
      interviewId={interview.id}
      sceneId={scene?.id ?? null}
      headName={headFact ? cardOf(headFact).title : "지워진 곳"}
      initialMessages={interview.messages}
      finished={interview.status === "done"}
      heads={heads}
      tracks={trackList}
      scopes={scene ? Object.fromEntries(trackList.map((t) => [t.id, scene.trackScopes[t.id] ?? "use"])) : undefined}
    />
  );
}
