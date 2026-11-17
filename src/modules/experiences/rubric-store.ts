import { sql } from "drizzle-orm";
import { type Kind, RUBRIC_ITEMS } from "./options";
import { experiences, type StoredRubric } from "./schema";
import { type Rubric, rubricAfterContentEdit } from "./verification";

// 저장된 루브릭(상태와 메모)을 다루는 도우미. repo와 claims-repo가 함께 쓴다.

export const statuses = (rubric: StoredRubric): Rubric =>
  Object.fromEntries(RUBRIC_ITEMS.map((item) => [item, rubric[item].status])) as Rubric;

// 상태만 바꾸고, 상태가 그대로인 항목의 보완 방안(note)은 유지한다
export function withStatuses(next: Rubric, previous?: StoredRubric): StoredRubric {
  return Object.fromEntries(
    RUBRIC_ITEMS.map((item) => [
      item,
      { status: next[item], note: previous && previous[item].status === next[item] ? previous[item].note : null },
    ]),
  ) as StoredRubric;
}

// 내용이 바뀌었을 때 함께 바꿀 칸. 본인 확인을 풀고, 예전 내용에 대한 판정과 후보를 지운다
export function contentResetFields(kind: Kind, rubric: StoredRubric, period: "met" | "unmet") {
  return {
    confirmedAt: null,
    contentVersion: sql`${experiences.contentVersion} + 1`,
    phraseCandidates: [],
    judgedAt: null,
    rubric: withStatuses(rubricAfterContentEdit(kind, statuses(rubric), period), rubric),
  };
}
