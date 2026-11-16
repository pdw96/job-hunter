import { db } from "@/db";
import { requireUser } from "@/lib/session";
import { listTracks } from "@/modules/tracks/repo";
import { ExperienceForm } from "../experience-form";

export default async function NewExperiencePage() {
  const user = await requireUser();
  const tracks = await listTracks(db, user.id);

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold">기록 추가</h1>
      <ExperienceForm tracks={tracks.map(({ id, name }) => ({ id, name }))} />
    </div>
  );
}
