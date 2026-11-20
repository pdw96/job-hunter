import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { requireUser } from "@/lib/session";
import { listFacts } from "@/modules/experiences/facts-repo";
import { countOpenRecordClaims } from "@/modules/experiences/record-claims-repo";
import { FACT_KIND_LABELS, type HeadKind } from "@/modules/experiences/record-options";
import { listScenes } from "@/modules/experiences/scenes-repo";
import { newRecordsOn } from "@/modules/experiences/switch";
import { StateBadge } from "../../experiences/state-badge";
import { periodText } from "../fact-summary";
import { HEAD_NOUN } from "./heads";

const addLink = "block rounded-lg border border-dashed border-foreground/30 px-4 py-3 text-center text-sm text-foreground/70";

type Group = {
  kind: HeadKind;
  id: string;
  name: string;
  period: string | null;
  confirmed: boolean;
};

export default async function ScenesPage() {
  if (!newRecordsOn()) notFound();
  const user = await requireUser();
  const [facts, scenes, openClaims] = await Promise.all([
    listFacts(db, user.id),
    listScenes(db, user.id),
    countOpenRecordClaims(db, user.id),
  ]);

  const groups: Group[] = [
    ...facts.job.map((f) => ({ kind: "job" as const, id: f.id, name: f.value.company, period: periodText(f.value.startMonth, f.value.endMonth, f.value.isOngoing), confirmed: f.isConfirmed })),
    ...facts.project.map((f) => ({ kind: "project" as const, id: f.id, name: f.value.name, period: periodText(f.value.startMonth, f.value.endMonth, f.value.isOngoing), confirmed: f.isConfirmed })),
    ...facts.activity.map((f) => ({ kind: "activity" as const, id: f.id, name: f.value.name, period: periodText(f.value.startMonth, f.value.endMonth, f.value.isOngoing), confirmed: f.isConfirmed })),
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">경험 사례</h1>
      <nav aria-label="기록 메뉴" className="-mx-4 flex gap-1 overflow-x-auto border-b border-foreground/10 px-4 text-sm">
        {[
          ["basic", "기본정보"],
          ["school", "학력"],
          ["job", "경력"],
          ["credential", "자격·어학·수상"],
        ].map(([id, label]) => (
          <Link key={id} href={`/records?tab=${id}`} className="shrink-0 border-b-2 border-transparent px-3 py-2 text-foreground/60">
            {label}
          </Link>
        ))}
        <span aria-current="page" className="shrink-0 border-b-2 border-foreground px-3 py-2 font-semibold">
          경험 사례
        </span>
      </nav>

      <p className="text-sm text-foreground/70">회사·프로젝트·활동마다 겪은 일을 장면으로 적습니다. 장면까지 확인돼야 자소서에 쓰입니다.</p>

      {groups.length === 0 && <p className="text-sm text-foreground/60">아직 경력, 프로젝트, 활동이 없습니다. 경력은 경력 탭에서 만들 수 있습니다.</p>}

      <div className="space-y-5">
        {groups.map((group) => {
          const mine = scenes.filter((s) => s.head.kind === group.kind && s.head.id === group.id);
          const noun = HEAD_NOUN[group.kind];
          return (
            <section key={`${group.kind}:${group.id}`} className="overflow-hidden rounded-lg border border-foreground/15">
              <Link
                href={`/records/facts/${group.kind}/${group.id}`}
                className="flex flex-wrap items-center gap-x-2 gap-y-1 bg-foreground/5 px-4 py-3"
              >
                <span className="min-w-0 truncate font-semibold">{group.name}</span>
                <span className="text-xs text-foreground/60">
                  {[FACT_KIND_LABELS[group.kind], group.period, `장면 ${mine.length}개`].filter(Boolean).join(" · ")}
                </span>
                <span
                  className={`ml-auto shrink-0 rounded-full border px-2 py-0.5 text-xs ${
                    group.confirmed ? "border-emerald-600/50 text-emerald-700 dark:text-emerald-400" : "border-amber-600/50 text-amber-700 dark:text-amber-400"
                  }`}
                >
                  {group.confirmed ? "확인됨" : `${noun} 정보 미확인`}
                </span>
              </Link>
              <ul className="divide-y divide-foreground/10">
                {mine.map((scene) => {
                  const open = openClaims[scene.id] ?? 0;
                  return (
                    <li key={scene.id}>
                      <Link href={`/records/scenes/${scene.id}`} className="flex items-start gap-2 px-4 py-3">
                        <span aria-hidden className="mt-1.5 size-1.5 shrink-0 rounded-full bg-foreground/40" />
                        <span className="min-w-0 flex-1 space-y-0.5">
                          <span className="block font-medium">{scene.title}</span>
                          <span className="block text-xs text-foreground/60">
                            {periodText(scene.startMonth, scene.endMonth, scene.isOngoing) ?? `기간은 ${noun} 기간을 씀`}
                            {open > 0 && ` · 주장 ${open}개 남음`}
                          </span>
                        </span>
                        <StateBadge state={scene.state} />
                      </Link>
                    </li>
                  );
                })}
              </ul>
              <div className="border-t border-foreground/10 px-4 py-3">
                <Link href={`/records/scenes/new?head=${group.kind}:${group.id}`} className="text-sm text-foreground/70 underline">
                  + 장면 추가 (AI 인터뷰 또는 직접 쓰기)
                </Link>
              </div>
            </section>
          );
        })}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Link href="/records/facts/project/new" className={addLink}>
          + 프로젝트
        </Link>
        <Link href="/records/facts/activity/new" className={addLink}>
          + 활동
        </Link>
      </div>
    </div>
  );
}
