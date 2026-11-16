import { db } from "@/db";
import { requireUser } from "@/lib/session";
import { listMajors } from "@/modules/ncs/repo";
import { countTracks } from "@/modules/tracks/repo";
import { SurveyForm } from "../survey-form";

export default async function NewTrackPage() {
  const user = await requireUser();
  const [majors, trackCount] = await Promise.all([listMajors(db), countTracks(db, user.id)]);

  return <SurveyForm majors={majors} isFirst={trackCount === 0} />;
}
