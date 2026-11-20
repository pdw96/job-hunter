import { notFound } from "next/navigation";
import { db } from "@/db";
import { requireUser } from "@/lib/session";
import { getFact, listFacts } from "@/modules/experiences/facts-repo";
import { listRecordClaims } from "@/modules/experiences/record-claims-repo";
import { FACT_KIND_LABELS, FACT_KINDS, type FactKind } from "@/modules/experiences/record-options";
import { newRecordsOn } from "@/modules/experiences/switch";
import { listTracks } from "@/modules/tracks/repo";
import { FactForm } from "../../../fact-form";
import { cardOf } from "../../../fact-summary";
import { HeadConfirm } from "../../../head-confirm";
import { HeadClaims } from "../../../head-claims";
import { parentOptionsOf } from "../../../parent-options";

export default async function EditFactPage({ params }: { params: Promise<{ kind: string; id: string }> }) {
  if (!newRecordsOn()) notFound();
  const user = await requireUser();
  const { kind: raw, id } = await params;
  if (!(FACT_KINDS as readonly string[]).includes(raw)) notFound();
  const kind = raw as FactKind;
  // 없는 기록과 남의 기록을 구분하지 않고 404로 보낸다
  const fact = await getFact(db, user.id, kind, id);
  if (!fact) notFound();

  const [tracks, facts] = await Promise.all([listTracks(db, user.id), listFacts(db, user.id)]);
  const claims = kind === "job" || kind === "project" ? await listRecordClaims(db, user.id, { kind, id }) : [];
  const trackList = tracks.map(({ id: trackId, name }) => ({ id: trackId, name }));

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="min-w-0 truncate text-2xl font-bold">{cardOf(fact).title}</h1>
        <span className="text-sm text-foreground/60">{FACT_KIND_LABELS[kind]}</span>
      </div>
      <HeadClaims claims={claims} />
      {(kind === "project" || kind === "activity") && !fact.isConfirmed && (
        <div className="space-y-1">
          <p className="text-sm text-foreground/70">내용이 맞으면 눌러 주세요. 고치려면 아래에서 고쳐 저장하세요</p>
          <HeadConfirm kind={kind} id={id} showFix={false} openClaims={claims.filter((c) => c.status === "pending" || c.status === "needs_fix").length} />
        </div>
      )}
      <FactForm
        key={fact.contentVersion}
        kind={kind}
        id={id}
        initial={fact.value as unknown as Record<string, unknown>}
        initialScopes={Object.fromEntries(trackList.map((t) => [t.id, fact.trackScopes[t.id] ?? "use"]))}
        tracks={trackList}
        parentOptions={kind === "project" ? parentOptionsOf(facts).filter((o) => o.value !== `project:${id}`) : []}
      />
    </div>
  );
}
