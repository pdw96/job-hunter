import { notFound } from "next/navigation";
import { db } from "@/db";
import { requireUser } from "@/lib/session";
import { getExperience, getTrackScopes, toInput } from "@/modules/experiences/repo";
import { listTracks } from "@/modules/tracks/repo";
import { ExperienceForm } from "../experience-form";
import { RubricPanel } from "../rubric-panel";
import { StateBadge } from "../state-badge";

export default async function ExperiencePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  // 없는 기록과 남의 기록을 구분하지 않고 404로 보낸다
  const experience = await getExperience(db, user.id, id);
  if (!experience) notFound();

  const [tracks, scopes] = await Promise.all([listTracks(db, user.id), getTrackScopes(db, user.id, id)]);
  const { rubric, isConfirmed, state } = experience;
  const input = toInput(experience);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="min-w-0 truncate text-2xl font-bold">{experience.name}</h1>
        <StateBadge state={state} />
      </div>
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <ExperienceForm
          id={id}
          initial={input}
          initialScopes={scopes}
          tracks={tracks.map((track) => ({ id: track.id, name: track.name }))}
        />
        <RubricPanel
          id={id}
          kind={experience.kind}
          rubric={rubric}
          isConfirmed={isConfirmed}
          state={state}
          phraseCandidates={experience.phraseCandidates}
          isJudged={experience.judgedAt !== null}
        />
      </div>
    </div>
  );
}
