import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { requireUser } from "@/lib/session";
import { type Fact, listFacts } from "@/modules/experiences/facts-repo";
import { countOpenRecordClaims } from "@/modules/experiences/record-claims-repo";
import type { CourseInput, EducationInput } from "@/modules/experiences/record-input";
import type { HeadKind } from "@/modules/experiences/record-options";
import { coursePeriod, educationPeriod } from "@/modules/experiences/scene-head";
import { listScenes, type SceneSummary } from "@/modules/experiences/scenes-repo";
import { newRecordsOn } from "@/modules/experiences/switch";
import { ConfirmBadge } from "../confirm-badge";
import { cardOf, periodText } from "../fact-summary";
import { HeadConfirm } from "../head-confirm";
import { RecordTabs } from "../record-tabs";
import { buildRecordTree, type OrgNode, SECTIONS } from "../record-tree";
import { SectionNav } from "../section-nav";
import { StateBadge } from "../_shared/state-badge";
import { HEAD_NOUN } from "./heads";
import { StartSceneInterview } from "./start-scene-interview";

// 경험 사례 탭에는 자격·어학·수상이 없다(사례가 딸리지 않는다)
const SCENE_SECTIONS = SECTIONS.filter((s) => s.id !== "credential");

type HeadFact = Fact<HeadKind>;

// 머리 줄의 기간. 학교·교육 과정은 머리 읽기와 같은 규칙(scene-head), 나머지는 isOngoing 칸
function headPeriod(fact: HeadFact): string | null {
  const v = fact.value as { startMonth?: string | null; endMonth?: string | null; isOngoing?: boolean };
  const p =
    fact.kind === "education"
      ? educationPeriod(fact.value as EducationInput)
      : fact.kind === "course"
        ? coursePeriod(fact.value as CourseInput)
        : { startMonth: v.startMonth ?? null, endMonth: v.endMonth ?? null, isOngoing: Boolean(v.isOngoing) };
  return periodText(p.startMonth, p.endMonth, p.isOngoing);
}

// 머리 하나의 묶음: 머리 줄·확인 표시·미확인이면 맞음(경력은 이력 탭에서)·사례 목록·`+ 사례 추가`.
// nested: 기관 상자 안에 들여 쓴 프로젝트 묶음
function HeadGroup({
  fact,
  scenes,
  openClaims,
  nested = false,
}: {
  fact: HeadFact;
  scenes: SceneSummary[];
  openClaims: Record<string, number>;
  nested?: boolean;
}) {
  const noun = HEAD_NOUN[fact.kind];
  const head = `${fact.kind}:${fact.id}`;
  const pad = nested ? "px-3" : "px-4";
  return (
    <div>
      <div className={`space-y-2 py-3 ${pad} ${nested ? "" : "bg-foreground/5"}`}>
        <Link href={`/records/facts/${fact.kind}/${fact.id}`} className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {nested && <span className="text-xs text-foreground/50">프로젝트</span>}
          <span className={`min-w-0 break-words ${nested ? "text-sm font-medium" : "font-semibold"}`}>{cardOf(fact).title}</span>
          <span className="text-xs text-foreground/60">{[headPeriod(fact), `사례 ${scenes.length}개`].filter(Boolean).join(" · ")}</span>
          <span className="ml-auto">
            <ConfirmBadge confirmed={fact.isConfirmed} pendingLabel={`${noun} 정보 미확인`} />
          </span>
        </Link>
        {!fact.isConfirmed && fact.kind !== "job" && <HeadConfirm kind={fact.kind} id={fact.id} openClaims={openClaims[fact.id] ?? 0} />}
      </div>
      {scenes.length > 0 && (
        <ul className="divide-y divide-foreground/10 border-t border-foreground/10">
          {scenes.map((scene) => {
            const open = openClaims[scene.id] ?? 0;
            return (
              <li key={scene.id}>
                <Link href={`/records/scenes/${scene.id}`} className={`flex items-start gap-2 py-3 ${pad}`}>
                  <span aria-hidden className="mt-1.5 size-1.5 shrink-0 rounded-full bg-foreground/40" />
                  <span className="min-w-0 flex-1 space-y-0.5">
                    <span className="block break-words font-medium">{scene.title}</span>
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
      )}
      <div className={`flex flex-wrap items-center gap-2 border-t border-foreground/10 py-3 ${pad}`}>
        <span className="mr-auto text-sm text-foreground/70">+ 사례 추가</span>
        <StartSceneInterview head={head} />
        <Link href={`/records/scenes/new?head=${head}`} className="rounded-lg border border-foreground/20 px-3 py-1.5 text-sm font-medium">
          직접 쓰기
        </Link>
      </div>
    </div>
  );
}

// 기관 상자: 기관 묶음, 그 아래 프로젝트마다 들여 쓴 묶음
function OrgBox({ org, openClaims }: { org: OrgNode & { fact: HeadFact }; openClaims: Record<string, number> }) {
  return (
    <li className="overflow-hidden rounded-lg border border-foreground/15">
      <HeadGroup fact={org.fact} scenes={org.scenes} openClaims={openClaims} />
      {org.projects.length > 0 && (
        <ul className="space-y-3 border-t border-foreground/10 py-3 pr-3 pl-4">
          {org.projects.map((project) => (
            <li key={project.fact.id} className="ml-1 rounded-lg border border-foreground/10 border-l-2 border-l-foreground/20">
              <HeadGroup fact={project.fact} scenes={project.scenes} openClaims={openClaims} nested />
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

const isHeadOrg = (org: OrgNode): org is OrgNode & { fact: HeadFact } => org.fact.kind !== "gap";

export default async function ScenesPage() {
  if (!newRecordsOn()) notFound();
  const user = await requireUser();
  const [facts, scenes, openClaims] = await Promise.all([
    listFacts(db, user.id),
    listScenes(db, user.id),
    countOpenRecordClaims(db, user.id),
  ]);
  const tree = buildRecordTree(facts, scenes).filter((section) => section.id !== "credential");

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">경험 사례</h1>
      <RecordTabs current="scenes" />

      <div className="relative">
        <SectionNav sections={SCENE_SECTIONS} />
        <div className="space-y-10 pt-6 xl:pt-0">
          <p className="text-sm text-foreground/70">회사·학교·과정·활동·프로젝트마다 겪은 일을 사례로 적습니다. 사례까지 확인돼야 자소서에 쓰입니다.</p>
          {tree.map((section) => {
            // 공백에는 사례가 딸리지 않아 상자를 만들지 않는다
            const orgs = section.orgs.filter(isHeadOrg);
            const empty = orgs.length === 0 && section.projects.length === 0;
            return (
              <section key={section.id} id={`sec-${section.id}`} className="scroll-mt-16 space-y-3 xl:scroll-mt-8">
                <h2 className="text-lg font-semibold">{section.label}</h2>
                {empty && (
                  <p className="text-sm text-foreground/60">
                    아직 없습니다.{" "}
                    <Link href={`/records#sec-${section.id}`} className="underline">
                      이력
                    </Link>
                    에서 만들어 주세요
                  </p>
                )}
                {orgs.length > 0 && (
                  <ul className="space-y-4">
                    {orgs.map((org) => (
                      <OrgBox key={org.fact.id} org={org} openClaims={openClaims} />
                    ))}
                  </ul>
                )}
                {section.projects.length > 0 && (
                  <ul className="space-y-4">
                    {section.projects.map((project) => (
                      <li key={project.fact.id} className="overflow-hidden rounded-lg border border-foreground/15">
                        <HeadGroup fact={project.fact} scenes={project.scenes} openClaims={openClaims} />
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}
