import type { SceneInput } from "@/modules/experiences/record-input";

// 장면 폼이 들고 있는 값. 칸은 모두 문자열이고 머리는 `job:<id>` 하나로 든다
export type SceneFormValues = {
  head: string;
  title: string;
  startMonth: string;
  endMonth: string;
  isOngoing: boolean;
  situation: string;
  judgment: string;
  actions: string;
  result: string;
  lessons: string;
  metrics: { text: string; basis: string }[];
  notDone: string;
  bannedPhrases: string[];
  evidenceNote: string;
  tags: string[];
};

export const EMPTY_SCENE: SceneFormValues = {
  head: "",
  title: "",
  startMonth: "",
  endMonth: "",
  isOngoing: false,
  situation: "",
  judgment: "",
  actions: "",
  result: "",
  lessons: "",
  metrics: [],
  notDone: "",
  bannedPhrases: [],
  evidenceNote: "",
  tags: [],
};

export function valuesOfScene(scene: SceneInput): SceneFormValues {
  return {
    head: `${scene.head.kind}:${scene.head.id}`,
    title: scene.title,
    startMonth: scene.startMonth ?? "",
    endMonth: scene.endMonth ?? "",
    isOngoing: scene.isOngoing,
    situation: scene.situation ?? "",
    judgment: scene.judgment ?? "",
    actions: scene.actions ?? "",
    result: scene.result ?? "",
    lessons: scene.lessons ?? "",
    metrics: scene.metrics.map((m) => ({ text: m.text, basis: m.basis ?? "" })),
    notDone: scene.notDone ?? "",
    bannedPhrases: scene.bannedPhrases,
    evidenceNote: scene.evidenceNote ?? "",
    tags: scene.tags,
  };
}

// 서버가 읽는 모양으로. 빈 칸은 서버가 null로 바꾼다
export function inputOfValues(v: SceneFormValues): Record<string, unknown> {
  const [kind, ...rest] = v.head.split(":");
  return {
    head: v.head === "" ? null : { kind, id: rest.join(":") },
    title: v.title,
    startMonth: v.startMonth,
    endMonth: v.isOngoing ? "" : v.endMonth,
    isOngoing: v.isOngoing,
    situation: v.situation,
    judgment: v.judgment,
    actions: v.actions,
    result: v.result,
    lessons: v.lessons,
    metrics: v.metrics,
    notDone: v.notDone,
    bannedPhrases: v.bannedPhrases,
    evidenceNote: v.evidenceNote,
    tags: v.tags,
  };
}
