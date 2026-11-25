import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { db } from "@/db";
import { requireUser } from "@/lib/session";
import type { Claim } from "@/modules/experiences/claims";
import { listFacts } from "@/modules/experiences/facts-repo";
import { migratedCount, moveBanner, moveSummary, resetBlock } from "@/modules/experiences/move-repo";
import { listRecordClaims } from "@/modules/experiences/record-claims-repo";
import type { FactKind } from "@/modules/experiences/record-options";
import { listScenes } from "@/modules/experiences/scenes-repo";
import { newRecordsOn } from "@/modules/experiences/switch";
import { FactCard } from "./fact-card";
import { cardOf, periodText } from "./fact-summary";
import { RecordTabs } from "./record-tabs";
import { buildRecordTree, type OrgNode, type ProjectNode, SECTIONS, type SectionId } from "./record-tree";
import { ResetMovesButton } from "./reset-moves-button";
import { SectionNav } from "./section-nav";

// 옛 탭 주소(?tab=school 등)는 이력 탭의 그 대분류 자리로 보낸다
const OLD_TABS = ["school", "job", "credential"] as const;

// 대분류 끝의 추가 단추
const ADD_BUTTONS: Record<SectionId, { kind: FactKind; label: string }[]> = {
  job: [
    { kind: "job", label: "경력 추가" },
    { kind: "gap", label: "공백 추가" },
  ],
  school: [{ kind: "education", label: "학교 추가" }],
  course: [{ kind: "course", label: "교육 과정 추가" }],
  activity: [{ kind: "activity", label: "활동 추가" }],
  personal: [{ kind: "project", label: "프로젝트 추가" }],
  credential: [{ kind: "credential", label: "자격·어학·수상 추가" }],
};

const addLink = "block rounded-lg border border-dashed border-foreground/30 px-4 py-3 text-center text-sm text-foreground/70";

function ConfirmBadge({ confirmed }: { confirmed: boolean }) {
  return (
    <span
      className={`shrink-0 rounded-full border px-2 py-0.5 text-xs ${
        confirmed ? "border-emerald-600/50 text-emerald-700 dark:text-emerald-400" : "border-amber-600/50 text-amber-700 dark:text-amber-400"
      }`}
    >
      {confirmed ? "확인됨" : "미확인"}
    </span>
  );
}

// 프로젝트 한 줄: 이름·기간·사례 수·확인 표시. 누르면 프로젝트 화면
function ProjectRow({ node }: { node: ProjectNode }) {
  const { fact, scenes } = node;
  const meta = [periodText(fact.value.startMonth, fact.value.endMonth, fact.value.isOngoing), scenes.length > 0 ? `사례 ${scenes.length}개` : null]
    .filter(Boolean)
    .join(" · ");
  return (
    <Link
      href={`/records/facts/project/${fact.id}`}
      className="flex items-center gap-2 rounded-lg border border-foreground/10 px-3 py-2 hover:bg-foreground/5"
    >
      <span className="min-w-0 flex-1">
        <span className="block break-words text-sm font-medium">
          <span className="mr-1.5 text-xs font-normal text-foreground/50">프로젝트</span>
          {fact.value.name}
        </span>
        {meta && <span className="block text-xs text-foreground/60">{meta}</span>}
      </span>
      <ConfirmBadge confirmed={fact.isConfirmed} />
    </Link>
  );
}

// 기관 카드 아래 들여 쓴 프로젝트 줄과 `+ 프로젝트`. 공백에는 프로젝트가 딸리지 않는다
function OrgProjects({ org }: { org: OrgNode }) {
  if (org.fact.kind === "gap") return null;
  return (
    <div className="ml-3 space-y-2 border-l-2 border-foreground/10 pl-3">
      {org.projects.length > 0 && (
        <ul className="space-y-2">
          {org.projects.map((project) => (
            <li key={project.fact.id}>
              <ProjectRow node={project} />
            </li>
          ))}
        </ul>
      )}
      <Link
        href={`/records/facts/project/new?parent=${org.fact.kind}:${org.fact.id}`}
        className="inline-block rounded-lg px-2 py-1 text-sm text-foreground/60 hover:bg-foreground/5"
      >
        + 프로젝트
      </Link>
    </div>
  );
}

export default async function RecordsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  if (!newRecordsOn()) notFound();
  const user = await requireUser();
  const { tab } = await searchParams;
  const old = OLD_TABS.find((id) => id === tab);
  if (old) redirect(`/records#sec-${old}`);

  const title = (
    <div className="flex items-center gap-3">
      <h1 className="text-2xl font-bold">경험 기록</h1>
      <Link href="/records/import" className="ml-auto rounded-lg border border-foreground/20 px-3 py-1.5 text-sm font-medium">
        가져오기
      </Link>
    </div>
  );

  if (tab === "basic") {
    return (
      <div className="space-y-6">
        {title}
        <RecordTabs current="basic" />
        <Link href="/settings/contact" className="block space-y-1 rounded-lg border border-foreground/15 p-4">
          <p className="font-medium">이름·연락처·주소·생년월일</p>
          <p className="text-sm text-foreground/70">AI에 보내지 않음. 지원서 파일을 만들 때만 쓰입니다</p>
        </Link>
      </div>
    );
  }

  const [facts, scenes, summary, migrated, block] = await Promise.all([
    listFacts(db, user.id),
    listScenes(db, user.id),
    moveSummary(db, user.id),
    migratedCount(db, user.id),
    resetBlock(db, user.id),
  ]);
  const banner = moveBanner(summary);
  // 가져오거나 옮겨 온 경력의 열린 주장은 경력 묶음에서 확인한다
  const claims: Record<string, Claim[]> = {};
  await Promise.all(
    facts.job
      .filter((fact) => fact.source === "import" || fact.source === "migrate")
      .map(async (fact) => {
        claims[fact.id] = await listRecordClaims(db, user.id, { kind: "job", id: fact.id });
      }),
  );
  const tree = buildRecordTree(facts, scenes);

  return (
    <div className="space-y-6">
      {title}
      {banner && (
        <Link href="/moving" className="block rounded-lg border border-amber-500/50 bg-amber-500/10 px-4 py-3 text-sm">
          {banner}
        </Link>
      )}
      <RecordTabs current="history" />

      <div className="relative">
        <SectionNav sections={SECTIONS} />
        <div className="space-y-10 pt-6 xl:pt-0">
          {tree.map((section) => {
            const adds = ADD_BUTTONS[section.id];
            return (
              <section key={section.id} id={`sec-${section.id}`} className="scroll-mt-16 space-y-3 xl:scroll-mt-8">
                <h2 className="text-lg font-semibold">{section.label}</h2>
                {section.orgs.length > 0 && (
                  <ul className="space-y-4">
                    {section.orgs.map((org) => (
                      <FactCard
                        key={org.fact.id}
                        card={cardOf(org.fact)}
                        claims={claims[org.fact.id]}
                        sceneCount={org.scenes.length}
                        below={<OrgProjects org={org} />}
                      />
                    ))}
                  </ul>
                )}
                {section.projects.length > 0 && (
                  <ul className="space-y-2">
                    {section.projects.map((project) => (
                      <li key={project.fact.id}>
                        <ProjectRow node={project} />
                      </li>
                    ))}
                  </ul>
                )}
                {section.credentials.length > 0 && (
                  <ul className="space-y-3">
                    {section.credentials.map((fact) => (
                      <FactCard key={fact.id} card={cardOf(fact)} />
                    ))}
                  </ul>
                )}
                <div className={adds.length > 1 ? "grid grid-cols-2 gap-3" : ""}>
                  {adds.map((add) => (
                    <Link key={add.kind} href={`/records/facts/${add.kind}/new`} className={addLink}>
                      + {add.label}
                    </Link>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      </div>

      {migrated > 0 && block === null && <ResetMovesButton count={migrated} />}
    </div>
  );
}
