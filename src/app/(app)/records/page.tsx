import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { requireUser } from "@/lib/session";
import type { Claim } from "@/modules/experiences/claims";
import { listFacts } from "@/modules/experiences/facts-repo";
import { migratedCount, moveBanner, moveSummary, resetBlock } from "@/modules/experiences/move-repo";
import { listRecordClaims } from "@/modules/experiences/record-claims-repo";
import type { FactKind } from "@/modules/experiences/record-options";
import { newRecordsOn } from "@/modules/experiences/switch";
import { FactCard } from "./fact-card";
import { cardOf } from "./fact-summary";
import { ResetMovesButton } from "./reset-moves-button";

const TABS = [
  { id: "basic", label: "기본정보" },
  { id: "school", label: "학력" },
  { id: "job", label: "경력" },
  { id: "credential", label: "자격·어학·수상" },
] as const;
type TabId = (typeof TABS)[number]["id"];

const addLink = "block rounded-lg border border-dashed border-foreground/30 px-4 py-3 text-center text-sm text-foreground/70";

function Section({ title, kind, addLabel, children }: { title?: string; kind: FactKind; addLabel: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      {title && <h2 className="text-lg font-semibold">{title}</h2>}
      {children}
      <Link href={`/records/facts/${kind}/new`} className={addLink}>
        + {addLabel}
      </Link>
    </section>
  );
}

export default async function RecordsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  if (!newRecordsOn()) notFound();
  const user = await requireUser();
  const { tab: tabParam } = await searchParams;
  const tab: TabId = TABS.find((t) => t.id === tabParam)?.id ?? "school";

  const facts = await listFacts(db, user.id);
  const [summary, migrated, block] = await Promise.all([moveSummary(db, user.id), migratedCount(db, user.id), resetBlock(db, user.id)]);
  const banner = moveBanner(summary);
  // 열린 주장은 경력 탭에서만 보인다
  const claims: Record<string, Claim[]> = {};
  if (tab === "job") {
    await Promise.all(
      facts.job
        .filter((fact) => fact.source === "import" || fact.source === "migrate")
        .map(async (fact) => {
          claims[fact.id] = await listRecordClaims(db, user.id, { kind: "job", id: fact.id });
        }),
    );
  }

  // 경력과 공백은 시작 월 최근 순으로 섞어 보인다
  const jobAndGaps = [...facts.job, ...facts.gap].sort((a, b) => {
    const am = (a.value as { startMonth: string | null }).startMonth ?? "";
    const bm = (b.value as { startMonth: string | null }).startMonth ?? "";
    return am < bm ? 1 : am > bm ? -1 : 0;
  });
  const credentials = [...facts.credential].sort((a, b) => {
    const am = a.value.month ?? "";
    const bm = b.value.month ?? "";
    return am < bm ? 1 : am > bm ? -1 : 0;
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-bold">경험 기록</h1>
        <Link href="/records/import" className="ml-auto rounded-lg border border-foreground/20 px-3 py-1.5 text-sm font-medium">
          가져오기
        </Link>
      </div>
      {banner && (
        <Link href="/moving" className="block rounded-lg border border-amber-500/50 bg-amber-500/10 px-4 py-3 text-sm">
          {banner}
        </Link>
      )}
      <nav aria-label="기록 메뉴" className="-mx-4 flex gap-1 overflow-x-auto border-b border-foreground/10 px-4 text-sm">
        {TABS.map((t) => (
          <Link
            key={t.id}
            href={`/records?tab=${t.id}`}
            aria-current={t.id === tab ? "page" : undefined}
            className={`shrink-0 border-b-2 px-3 py-2 ${
              t.id === tab ? "border-foreground font-semibold" : "border-transparent text-foreground/60"
            }`}
          >
            {t.label}
          </Link>
        ))}
        <Link href="/records/scenes" className="shrink-0 border-b-2 border-transparent px-3 py-2 text-foreground/60">
          경험 사례
        </Link>
      </nav>

      {tab === "basic" && (
        <Link href="/settings/contact" className="block space-y-1 rounded-lg border border-foreground/15 p-4">
          <p className="font-medium">이름·연락처·주소·생년월일</p>
          <p className="text-sm text-foreground/70">AI에 보내지 않음. 지원서 파일을 만들 때만 쓰입니다</p>
        </Link>
      )}

      {tab === "school" && (
        <div className="space-y-8">
          <Section title="학교" kind="education" addLabel="학교 추가">
            <ul className="space-y-3">
              {facts.education.map((fact) => (
                <FactCard key={fact.id} card={cardOf(fact)} />
              ))}
            </ul>
          </Section>
          <Section title="교육 과정" kind="course" addLabel="교육 과정 추가">
            <ul className="space-y-3">
              {facts.course.map((fact) => (
                <FactCard key={fact.id} card={cardOf(fact)} />
              ))}
            </ul>
          </Section>
        </div>
      )}

      {tab === "job" && (
        <div className="space-y-3">
          <Section kind="job" addLabel="경력 추가">
            <ul className="space-y-3">
              {jobAndGaps.map((fact) => (
                <FactCard key={fact.id} card={cardOf(fact)} claims={claims[fact.id]} />
              ))}
            </ul>
          </Section>
          <Link href="/records/facts/gap/new" className={addLink}>
            + 공백 추가
          </Link>
        </div>
      )}

      {tab === "credential" && (
        <Section kind="credential" addLabel="자격·어학·수상 추가">
          <ul className="space-y-3">
            {credentials.map((fact) => (
              <FactCard key={fact.id} card={cardOf(fact)} />
            ))}
          </ul>
        </Section>
      )}

      {migrated > 0 && block === null && <ResetMovesButton count={migrated} />}
    </div>
  );
}
