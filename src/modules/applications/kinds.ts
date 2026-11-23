import {
  ANSWER_TOPICS,
  type AnswerTopic,
  APPLICATION_LIMITS,
  FREEFORM_ITEMS,
  type QuestionKind,
  TOPIC_KIND,
} from "./options";
import type { NewQuestion } from "./repo";

// 문항 유형과 주제, 자유양식 항목. 화면과 DB를 모르는 순수 함수

// 켜진 유형에 맞는 주제만 남기고, 주제가 하나도 없는 유형(경험형 제외)에는 기본 주제를 더한다
export function topicsFor(kinds: QuestionKind[], previous: AnswerTopic[]): AnswerTopic[] {
  const kept = ANSWER_TOPICS.filter((topic) => previous.includes(topic) && kinds.includes(TOPIC_KIND[topic]));
  const result = [...kept];
  if (kinds.includes("motive") && !kept.some((t) => TOPIC_KIND[t] === "motive")) result.push("motive");
  if (kinds.includes("self") && !kept.some((t) => TOPIC_KIND[t] === "self")) result.push("other");
  return result;
}

export function needsAnswers(kinds: QuestionKind[] | null): boolean {
  return !!kinds && (kinds.includes("motive") || kinds.includes("self"));
}

// 고른 자유양식 항목과 직접 더한 항목을 문항으로 바꾼다. 항목마다 글자 수는 같다
export function freeformQuestions(
  itemIds: string[],
  custom: string[],
  charLimit: number,
): { ok: true; value: NewQuestion[] } | { ok: false; message: string } {
  if (!Number.isInteger(charLimit) || charLimit < APPLICATION_LIMITS.charLimitMin || charLimit > APPLICATION_LIMITS.charLimitMax) {
    return { ok: false, message: `글자 수는 ${APPLICATION_LIMITS.charLimitMin}~${APPLICATION_LIMITS.charLimitMax}자로 적어 주세요` };
  }
  const value: NewQuestion[] = [];
  for (const id of itemIds) {
    const item = FREEFORM_ITEMS.find((x) => x.id === id);
    if (!item) return { ok: false, message: "알 수 없는 항목입니다" };
    value.push({ prompt: item.label, charLimit, countSpaces: true, kinds: [...item.kinds], topics: [...item.topics], freeformItem: item.id });
  }
  for (const raw of custom) {
    const text = raw.trim();
    if (text === "") continue;
    if (text.length > APPLICATION_LIMITS.customItem) return { ok: false, message: `직접 추가한 항목은 ${APPLICATION_LIMITS.customItem}자까지 적을 수 있습니다` };
    value.push({ prompt: text, charLimit, countSpaces: true, kinds: null, topics: null, freeformItem: "custom" });
  }
  if (value.length === 0) return { ok: false, message: "넣을 항목을 골라 주세요" };
  return { ok: true, value };
}
