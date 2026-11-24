import Link from "next/link";
import { db } from "@/db";
import { requireUser } from "@/lib/session";
import { countRecords } from "@/modules/experiences/facts-repo";
import { listMajors } from "@/modules/ncs/repo";
import { listTracks } from "@/modules/tracks/repo";
import { SurveyForm } from "./tracks/survey-form";

const dateFormat = new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeZone: "Asia/Seoul" });

export default async function HomePage() {
  const user = await requireUser();
  const [tracks, recordCount] = await Promise.all([listTracks(db, user.id), countRecords(db, user.id)]);
  // 처음 로그인하면 설문부터 한다. 다른 주소로 보내지 않고 여기서 바로 보여 준다
  // (보내는 방식은 브라우저가 "홈 → 설문" 이동을 기억해, 트랙을 만든 뒤에도 설문으로 되돌아갔다)
  if (tracks.length === 0) return <SurveyForm majors={await listMajors(db)} isFirst />;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold">내 트랙</h1>
        <Link
          href="/tracks/new"
          className="ml-auto rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background"
        >
          트랙 추가
        </Link>
      </div>

      <ul className="space-y-3">
        {tracks.map((track) => (
          <li key={track.id} className="space-y-2 rounded-lg border border-foreground/10 p-4">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h2 className="text-lg font-semibold">{track.name}</h2>
              <span className="text-sm text-foreground/60">{dateFormat.format(track.createdAt)}</span>
              <Link href={`/tracks/${track.id}/edit`} className="ml-auto text-sm underline">
                설문 다시 하기
              </Link>
            </div>
            <p className="text-sm text-foreground/70">{track.jobNames.join(", ")}</p>
            <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
              <Link href="/records" className="underline">
                경험 기록 {recordCount}건
              </Link>
              <Link href={`/tracks/${track.id}/resume`} className="underline">
                이력서 공통본
              </Link>
              <Link href={`/tracks/${track.id}/career`} className="underline">
                경력기술서 공통본
              </Link>
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
