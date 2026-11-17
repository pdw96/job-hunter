import Link from "next/link";
import { db } from "@/db";
import { requireUser } from "@/lib/session";
import { daysLeft, EXCLUSION_LABELS, exclusionReasons } from "@/modules/postings/exclusion";
import { POSTING_STATUS_LABELS } from "@/modules/postings/options";
import { countPostings, listPostings } from "@/modules/postings/repo";
import { todayInKorea } from "@/modules/postings/today";
import { getTrack, listTracks } from "@/modules/tracks/repo";
import { deadlineLabel } from "./deadline";

export default async function PostingsPage({ searchParams }: { searchParams: Promise<{ track?: string }> }) {
  const user = await requireUser();
  const [{ track: wanted }, tracks, counts] = await Promise.all([searchParams, listTracks(db, user.id), countPostings(db, user.id)]);

  if (tracks.length === 0) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">공고</h1>
        <p className="text-sm text-foreground/70">공고는 트랙에 넣습니다. 먼저 트랙을 만들어 주세요</p>
        <Link href="/" className="underline">
          트랙 만들기
        </Link>
      </div>
    );
  }

  const today = todayInKorea();
  const current = tracks.find((track) => track.id === wanted) ?? tracks[0];
  const [track, postings] = await Promise.all([getTrack(db, user.id, current.id), listPostings(db, user.id, current.id, today)]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold">공고</h1>
        <Link
          href={`/postings/new?track=${current.id}`}
          className="ml-auto rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background"
        >
          공고 넣기
        </Link>
      </div>

      {tracks.length > 1 && (
        <nav className="flex flex-wrap gap-2 text-sm" aria-label="트랙">
          {tracks.map((item) => (
            <Link
              key={item.id}
              href={`/postings?track=${item.id}`}
              aria-current={item.id === current.id ? "page" : undefined}
              className={`rounded-full border px-3 py-1 ${
                item.id === current.id ? "border-foreground bg-foreground text-background" : "border-foreground/20"
              }`}
            >
              {item.name} {counts[item.id] ?? 0}
            </Link>
          ))}
        </nav>
      )}

      {postings.length === 0 ? (
        <p className="text-sm text-foreground/70">
          아직 넣은 공고가 없습니다. 채용 사이트에서 공고 글을 복사해 넣으면, 회사명과 마감일 같은 값을 뽑아 정리합니다
        </p>
      ) : (
        <ul className="divide-y divide-foreground/10 border-y border-foreground/10">
          {postings.map((posting) => {
            const reasons = track ? exclusionReasons(posting, track, today) : [];
            const left = daysLeft(posting.deadline, today);
            return (
              <li key={posting.id}>
                <Link href={`/postings/${posting.id}`} className="block space-y-1 py-3">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="font-medium">{posting.company}</span>
                    <span className="min-w-0 flex-1 truncate text-sm text-foreground/70">{posting.title}</span>
                    <span className={`text-sm ${left !== null && left < 0 ? "text-foreground/50" : ""}`}>
                      {deadlineLabel(posting.deadline, posting.isRolling, today)}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2 text-xs">
                    {posting.status !== "interest" && (
                      <span className="rounded-full border border-foreground/20 px-2 py-0.5">
                        {POSTING_STATUS_LABELS[posting.status]}
                      </span>
                    )}
                    {reasons.map((reason) => (
                      <span
                        key={reason}
                        className={`rounded-full px-2 py-0.5 ${
                          posting.excludeOverride ? "border border-foreground/20 text-foreground/60" : "bg-amber-600/15 text-amber-700 dark:text-amber-400"
                        }`}
                      >
                        {EXCLUSION_LABELS[reason]}
                      </span>
                    ))}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
