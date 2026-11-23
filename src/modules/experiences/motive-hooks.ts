import type { Db } from "@/db/types";
import { ownsTrack } from "@/modules/tracks/repo";
import { type Fact, listFacts } from "./facts-repo";
import { CREDENTIAL_TYPE_LABELS } from "./record-options";
import { listSceneWritingSources } from "./record-sources";

// 묻기(지원동기·포부 같은 질문 만들기)에서 공고와 맞대 볼 확인된 기록. 질문 거리로만 쓰고 글의 재료로는 쓰지 않는다.
// 그 트랙에서 쓸 수 있는 것만: 사례는 자소서 원천과 같은 거르기(listSceneWritingSources),
// 학력·교육 과정·자격은 확인됨이고 그 트랙에서 제외가 아닌 것. 학점·점수·증빙 메모·연락처는 담지 않는다

export type MotiveHook = { kind: "scene" | "education" | "course" | "credential"; label: string; detail: string };

const MAX_HOOKS = 20;
const SCENE_DETAIL = 300;

const joined = (parts: (string | null)[], separator: string) => parts.filter((part): part is string => !!part && part.trim() !== "").join(separator);
const cut = (text: string, max: number) => [...text].slice(0, max).join("");

export async function listMotiveHooks(db: Db, userId: string, trackId: string): Promise<MotiveHook[]> {
  if (!(await ownsTrack(db, userId, trackId))) return [];
  const [sources, facts] = await Promise.all([listSceneWritingSources(db, userId, trackId), listFacts(db, userId)]);
  const usable = <T extends Fact>(list: T[]) => list.filter((fact) => fact.isConfirmed && (fact.trackScopes[trackId] ?? "use") !== "exclude");

  const scenes: MotiveHook[] = sources.map((s) => ({
    kind: "scene",
    label: s.name,
    detail: cut(joined([s.situation, s.actions, s.result], " / "), SCENE_DETAIL),
  }));
  const education: MotiveHook[] = usable(facts.education).map((fact) => ({
    kind: "education",
    label: fact.value.schoolName,
    detail: joined([fact.value.schoolName, fact.value.major], " · "),
  }));
  const courses: MotiveHook[] = usable(facts.course).map((fact) => ({
    kind: "course",
    label: fact.value.name,
    detail: joined([fact.value.name, fact.value.institution, fact.value.learned], " · "),
  }));
  const credentials: MotiveHook[] = usable(facts.credential).map((fact) => ({
    kind: "credential",
    label: fact.value.name,
    detail: joined([fact.value.name, CREDENTIAL_TYPE_LABELS[fact.value.type]], " · "),
  }));
  return [...scenes, ...education, ...courses, ...credentials].slice(0, MAX_HOOKS);
}
