"use client";

import type { Scope } from "@/modules/experiences/options";
import { answerSceneInterviewAction, draftSceneAction } from "@/modules/experiences/record-actions";
import type { SceneInput } from "@/modules/experiences/record-input";
import type { InterviewMessage } from "@/modules/experiences/schema";
import { Chat, DraftNotice } from "../../experiences/interview/chat";
import { SceneForm } from "../scenes/scene-form";
import { valuesOfScene } from "../scenes/scene-values";

type Props = {
  interviewId: string;
  sceneId: string | null; // 있으면 이미 있는 사례를 보완하는 인터뷰
  headName: string;
  initialMessages: InterviewMessage[];
  finished: boolean;
  heads: { value: string; label: string }[];
  tracks: { id: string; name: string }[];
  scopes?: Record<string, Scope>;
};

// 사례 인터뷰. 옛 인터뷰의 대화 화면을 그대로 쓰고, 정리하면 사례 폼을 띄운다
export function SceneInterviewChat({ interviewId, sceneId, headName, initialMessages, finished, heads, tracks, scopes }: Props) {
  return (
    <Chat<SceneInput>
      interviewId={interviewId}
      initialMessages={initialMessages}
      finished={finished}
      title={sceneId ? `사례 보완 인터뷰 · ${headName}` : `사례 인터뷰 · ${headName}`}
      draftLabel="사례로 정리하기"
      exitHref={sceneId ? `/records/scenes/${sceneId}` : "/records/scenes"}
      doneHref="/records/scenes"
      doneLabel="경험 사례로 돌아가기"
      answer={answerSceneInterviewAction}
      draft={draftSceneAction}
      renderDraft={(draft, back) => (
        <div className="max-w-2xl space-y-6">
          <DraftNotice warned={Object.keys(draft.warnings).length > 0} where="사례 화면" onBack={back} />
          <SceneForm
            id={sceneId ?? undefined}
            heads={heads}
            initial={valuesOfScene(draft.draft)}
            initialScopes={scopes}
            tracks={tracks}
            interviewId={interviewId}
            warnings={draft.warnings}
          />
        </div>
      )}
    />
  );
}
