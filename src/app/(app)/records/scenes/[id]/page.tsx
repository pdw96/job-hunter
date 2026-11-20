import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { requireUser } from "@/lib/session";
import { blocksConfirmation } from "@/modules/experiences/claims";
import { getFact, listFacts } from "@/modules/experiences/facts-repo";
import { listRecordClaims } from "@/modules/experiences/record-claims-repo";
import {
  answerSceneClaimAction,
  decideScenePhraseAction,
  judgeSceneAction,
  setSceneConfirmedAction,
  setSceneRubricClosedAction,
  startSceneSupplementAction,
} from "@/modules/experiences/record-actions";
import { getScene } from "@/modules/experiences/scenes-repo";
import { newRecordsOn } from "@/modules/experiences/switch";
import { listTracks } from "@/modules/tracks/repo";
import { ClaimsPanel } from "../../../experiences/claims-panel";
import { RubricPanel } from "../../../experiences/rubric-panel";
import { StateBadge } from "../../../experiences/state-badge";
import { cardOf } from "../../fact-summary";
import { HEAD_NOUN, headOptionsOf } from "../heads";
import { ConfirmScene } from "../confirm-scene";
import { SceneForm } from "../scene-form";
import { valuesOfScene } from "../scene-values";

export default async function ScenePage({ params }: { params: Promise<{ id: string }> }) {
  if (!newRecordsOn()) notFound();
  const user = await requireUser();
  const { id } = await params;
  // 없는 장면과 남의 장면을 구분하지 않고 404로 보낸다
  const scene = await getScene(db, user.id, id);
  if (!scene) notFound();

  const { head } = scene;
  const [headFact, facts, tracks, claims, headClaims] = await Promise.all([
    getFact(db, user.id, head.kind, head.id),
    listFacts(db, user.id),
    listTracks(db, user.id),
    listRecordClaims(db, user.id, { kind: "scene", id }),
    head.kind === "activity" ? Promise.resolve([]) : listRecordClaims(db, user.id, { kind: head.kind, id: head.id }),
  ]);
  if (!headFact) notFound();
  const card = cardOf(headFact);
  const noun = HEAD_NOUN[head.kind];
  const trackList = tracks.map((t) => ({ id: t.id, name: t.name }));
  const headHref = `/records/facts/${head.kind}/${head.id}`;
  const claimsOpen = blocksConfirmation(claims);

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Link href="/records/scenes" className="text-sm text-foreground/60 underline">
          경험 사례
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="min-w-0 truncate text-2xl font-bold">{scene.title}</h1>
          <StateBadge state={scene.state} />
        </div>
        <Link href={headHref} className="flex flex-wrap items-center gap-2 text-sm text-foreground/70">
          <span>{card.title}</span>
          <span
            className={`rounded-full border px-2 py-0.5 text-xs ${
              headFact.isConfirmed ? "border-emerald-600/50 text-emerald-700 dark:text-emerald-400" : "border-amber-600/50 text-amber-700 dark:text-amber-400"
            }`}
          >
            {headFact.isConfirmed ? "확인됨" : `${noun} 정보 미확인`}
          </span>
        </Link>
      </div>

      <ClaimsPanel experienceId={id} claims={claims} actions={{ answer: answerSceneClaimAction, startInterview: startSceneSupplementAction }} />
      {/* 확인은 긴 폼 위에 둔다. 폰에서 폼 끝까지 내리지 않아도 보이게 한다 */}
      {!scene.isConfirmed && (
        <section aria-label="사례 확인" className="space-y-3 rounded-lg border border-foreground/15 p-4">
          <div className="space-y-1">
            <p className="font-medium">이 사례가 맞는지 확인해 주세요</p>
            <p className="text-xs text-foreground/60">
              확인한 사례만 자소서에 쓰입니다.{!headFact.isConfirmed && ` ${noun} 정보도 함께 확인합니다.`}
            </p>
          </div>
          <ConfirmScene
            sceneId={id}
            headConfirmed={headFact.isConfirmed}
            headNoun={noun}
            headName={card.title}
            headLines={card.lines}
            headHref={headHref}
            claimsOpen={claimsOpen}
            headClaimsOpen={blocksConfirmation(headClaims)}
          />
        </section>
      )}
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <SceneForm
          key={scene.contentVersion}
          id={id}
          heads={headOptionsOf(facts)}
          initial={valuesOfScene(scene)}
          initialScopes={Object.fromEntries(trackList.map((t) => [t.id, scene.trackScopes[t.id] ?? "use"]))}
          tracks={trackList}
        />
        <RubricPanel
          actions={{
            judge: judgeSceneAction,
            setClosed: setSceneRubricClosedAction,
            decidePhrase: decideScenePhraseAction,
            setConfirmed: setSceneConfirmedAction,
            startInterview: startSceneSupplementAction,
          }}
          confirmSlot={<p className="text-xs text-foreground/60">위의 사례 확인 칸에서 확인합니다</p>}
          id={id}
          kind="project"
          rubric={scene.rubric}
          isConfirmed={scene.isConfirmed}
          state={scene.state}
          phraseCandidates={scene.phraseCandidates}
          isJudged={scene.judgedAt !== null}
          claimsOpen={claimsOpen}
        />
      </div>
    </div>
  );
}
