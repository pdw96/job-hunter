import { notFound } from "next/navigation";
import { db } from "@/db";
import { requireUser } from "@/lib/session";
import { listFacts } from "@/modules/experiences/facts-repo";
import { FACT_KIND_LABELS, FACT_KINDS, type FactKind } from "@/modules/experiences/record-options";
import { newRecordsOn } from "@/modules/experiences/switch";
import { listTracks } from "@/modules/tracks/repo";
import { FactForm } from "../../../fact-form";
import { parentOptionsOf } from "../../../parent-options";

export default async function NewFactPage({ params }: { params: Promise<{ kind: string }> }) {
  if (!newRecordsOn()) notFound();
  const user = await requireUser();
  const { kind: raw } = await params;
  if (!(FACT_KINDS as readonly string[]).includes(raw)) notFound();
  const kind = raw as FactKind;
  const [tracks, facts] = await Promise.all([listTracks(db, user.id), listFacts(db, user.id)]);

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold">{FACT_KIND_LABELS[kind]} 추가</h1>
      <FactForm
        kind={kind}
        tracks={tracks.map(({ id, name }) => ({ id, name }))}
        parentOptions={kind === "project" ? parentOptionsOf(facts) : []}
      />
    </div>
  );
}
