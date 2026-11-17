import { notFound } from "next/navigation";
import { db } from "@/db";
import { requireUser } from "@/lib/session";
import { getInterview } from "@/modules/experiences/interview";
import { getTrackScopes } from "@/modules/experiences/repo";
import { listTracks } from "@/modules/tracks/repo";
import { InterviewChat } from "../chat";

export default async function InterviewPage({ params }: { params: Promise<{ interviewId: string }> }) {
  const user = await requireUser();
  const { interviewId } = await params;
  // 없는 인터뷰와 남의 인터뷰를 구분하지 않고 404로 보낸다
  const interview = await getInterview(db, user.id, interviewId);
  if (!interview) notFound();

  const [tracks, scopes] = await Promise.all([
    listTracks(db, user.id),
    interview.experienceId ? getTrackScopes(db, user.id, interview.experienceId) : undefined,
  ]);

  return (
    <InterviewChat
      interviewId={interview.id}
      experienceId={interview.experienceId}
      initialMessages={interview.messages}
      finished={interview.status === "done"}
      tracks={tracks.map((track) => ({ id: track.id, name: track.name }))}
      scopes={scopes}
    />
  );
}
