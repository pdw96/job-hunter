import Link from "next/link";
import { db } from "@/db";
import { requireUser } from "@/lib/session";
import { listTracks } from "@/modules/tracks/repo";
import { PostingForm } from "../posting-form";

export default async function NewPostingPage({ searchParams }: { searchParams: Promise<{ track?: string }> }) {
  const user = await requireUser();
  const [{ track }, tracks] = await Promise.all([searchParams, listTracks(db, user.id)]);

  if (tracks.length === 0) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">공고 넣기</h1>
        <p className="text-sm text-foreground/70">공고는 트랙에 넣습니다. 먼저 트랙을 만들어 주세요</p>
        <Link href="/" className="underline">
          트랙 만들기
        </Link>
      </div>
    );
  }

  return (
    <PostingForm
      tracks={tracks.map((item) => ({ id: item.id, name: item.name }))}
      trackId={tracks.some((item) => item.id === track) ? track! : tracks[0].id}
    />
  );
}
