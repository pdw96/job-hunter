import Link from "next/link";
import { db } from "@/db";
import { requireUser } from "@/lib/session";
import { monthlyCostMicroUsd, monthlyLimitMicroUsd } from "@/modules/ai/usage";
import { countOpenClaims } from "@/modules/experiences/claims-repo";
import { listEvidenceTodos } from "@/modules/experiences/judge";
import { KIND_LABELS } from "@/modules/experiences/options";
import { listExperiences } from "@/modules/experiences/repo";
import { listTracks } from "@/modules/tracks/repo";
import { formatPeriod } from "./period";
import { StartInterview } from "./start-interview";
import { StateBadge } from "./state-badge";

export default async function ExperiencesPage() {
  const user = await requireUser();
  const [list, todos, tracks, spent, openClaims] = await Promise.all([
    listExperiences(db, user.id),
    listEvidenceTodos(db, user.id),
    listTracks(db, user.id),
    monthlyCostMicroUsd(db, user.id, new Date()),
    countOpenClaims(db, user.id),
  ]);
  const usd = (microUsd: number) => `$${(microUsd / 1_000_000).toFixed(2)}`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold">경험 기록</h1>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <StartInterview tracks={tracks.map((track) => ({ id: track.id, name: track.name }))} />
          <Link href="/experiences/import" className="rounded-lg border border-foreground/20 px-4 py-2 text-sm font-medium">
            가져오기
          </Link>
          <Link href="/experiences/new" className="rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background">
            기록 추가
          </Link>
        </div>
      </div>

      {todos.length > 0 && (
        <section className="space-y-2 rounded-lg border border-amber-600/40 p-4" aria-label="증빙 할 일">
          <h2 className="font-semibold">증빙 할 일 {todos.length}건</h2>
          <ul className="space-y-1 text-sm">
            {todos.map((todo) => (
              <li key={todo.id}>
                <Link href={`/experiences/${todo.id}`} className="underline">
                  {todo.name}
                </Link>
                {todo.note && <span className="text-foreground/70"> · {todo.note}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {list.length === 0 ? (
        <p className="text-foreground/70">아직 기록이 없습니다. 첫 기록을 추가해 보세요</p>
      ) : (
        <ul className="divide-y divide-foreground/10 border-y border-foreground/10">
          {list.map((item) => (
            <li key={item.id}>
              <Link href={`/experiences/${item.id}`} className="flex items-center gap-3 py-3 hover:bg-foreground/5">
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="truncate font-medium">{item.name}</p>
                  <p className="truncate text-sm text-foreground/60">
                    {[
                      KIND_LABELS[item.kind],
                      item.organization,
                      formatPeriod(item.kind, item.startMonth, item.endMonth, item.isOngoing),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                {openClaims[item.id] > 0 && (
                  <span className="shrink-0 text-xs text-amber-700 dark:text-amber-400">
                    확인할 주장 {openClaims[item.id]}개
                  </span>
                )}
                <StateBadge state={item.state} />
              </Link>
            </li>
          ))}
        </ul>
      )}

      <p className="text-xs text-foreground/60">
        이번 달 AI 사용: {usd(spent)} / {usd(monthlyLimitMicroUsd())}
      </p>
    </div>
  );
}
