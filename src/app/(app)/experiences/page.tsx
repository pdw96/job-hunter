import Link from "next/link";
import { db } from "@/db";
import { requireUser } from "@/lib/session";
import { KIND_LABELS } from "@/modules/experiences/options";
import { listExperiences } from "@/modules/experiences/repo";
import { formatPeriod } from "./period";
import { StateBadge } from "./state-badge";

export default async function ExperiencesPage() {
  const user = await requireUser();
  const list = await listExperiences(db, user.id);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold">경험 기록</h1>
        <Link
          href="/experiences/new"
          className="ml-auto rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background"
        >
          기록 추가
        </Link>
      </div>

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
                <StateBadge state={item.state} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
