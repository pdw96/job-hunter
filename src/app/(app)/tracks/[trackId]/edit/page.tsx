import { notFound } from "next/navigation";
import { db } from "@/db";
import { requireUser } from "@/lib/session";
import { getJobs, listMajors } from "@/modules/ncs/repo";
import { getTrack } from "@/modules/tracks/repo";
import { SurveyForm } from "../../survey-form";

export default async function EditTrackPage({ params }: { params: Promise<{ trackId: string }> }) {
  const user = await requireUser();
  const { trackId } = await params;
  // 없는 트랙과 남의 트랙을 구분하지 않고 404로 보낸다
  const track = await getTrack(db, user.id, trackId);
  if (!track) notFound();

  const [majors, ncsJobs] = await Promise.all([
    listMajors(db),
    getJobs(db, track.jobs.flatMap((job) => job.ncsCode ?? [])),
  ]);
  const names = new Map(ncsJobs.map((job) => [job.code, job.name]));

  return (
    <SurveyForm
      majors={majors}
      trackId={track.id}
      initial={{
        name: track.name,
        majorCode: track.majorCode,
        applicantType: track.applicantType,
        experienceMonths: track.experienceMonths,
        regions: track.regions,
        salaryMin: track.salaryMin,
        employmentTypes: track.employmentTypes,
        importanceOrder: track.importanceOrder,
        extraAnswers: track.extraAnswers,
        jobs: track.jobs.map((job) => ({
          ncsCode: job.ncsCode,
          customName: job.customName,
          label: job.customName ?? names.get(job.ncsCode ?? "") ?? "",
          majorCode: job.ncsCode ? job.ncsCode.slice(0, 2) : null,
        })),
      }}
    />
  );
}
