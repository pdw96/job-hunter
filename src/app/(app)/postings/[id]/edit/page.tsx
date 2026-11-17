import { notFound } from "next/navigation";
import { db } from "@/db";
import { requireUser } from "@/lib/session";
import { getPosting } from "@/modules/postings/repo";
import { PostingForm } from "../../posting-form";

export default async function EditPostingPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  // 없는 공고와 남의 공고를 구분하지 않고 404로 보낸다
  const posting = await getPosting(db, user.id, id);
  if (!posting) notFound();

  return (
    <PostingForm
      tracks={[]}
      trackId={posting.trackId}
      id={posting.id}
      initial={{
        company: posting.company,
        title: posting.title,
        deadline: posting.deadline,
        isRolling: posting.isRolling,
        locationText: posting.locationText,
        regions: posting.regions,
        careerType: posting.careerType,
        minYears: posting.minYears,
        employmentType: posting.employmentType,
        url: posting.url,
        rawText: posting.rawText,
        companyNote: posting.companyNote,
      }}
    />
  );
}
