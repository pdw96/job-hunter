import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { requireUser } from "@/lib/session";
import { listFacts } from "@/modules/experiences/facts-repo";
import { newRecordsOn } from "@/modules/experiences/switch";
import { listTracks } from "@/modules/tracks/repo";
import { headOptionsOf } from "../heads";
import { SceneForm } from "../scene-form";

export default async function NewScenePage({ searchParams }: { searchParams: Promise<{ head?: string }> }) {
  if (!newRecordsOn()) notFound();
  const user = await requireUser();
  const { head } = await searchParams;
  const [facts, tracks] = await Promise.all([listFacts(db, user.id), listTracks(db, user.id)]);
  const heads = headOptionsOf(facts);

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold">사례 추가</h1>
      {heads.length === 0 ? (
        <p className="text-sm text-foreground/70">
          사례는 경력, 학교, 교육 과정, 활동, 프로젝트에 붙입니다. 먼저{" "}
          <Link href="/records" className="underline">
            이력
          </Link>
          에서 만들어 주세요
        </p>
      ) : (
        <SceneForm
          heads={heads}
          initial={{ head: heads.some((o) => o.value === head) ? head : "" }}
          tracks={tracks.map((t) => ({ id: t.id, name: t.name }))}
        />
      )}
    </div>
  );
}
