import type { Answer } from "@/modules/applications/answers-repo";
import { ANSWER_TOPIC_LABELS, type AnswerTopic } from "@/modules/applications/options";
import type { AskItem } from "@/modules/applications/types";

// 묻기 화면이 쓰는 순수 함수. 화면 모양(서버가 그려 카드에 넘기는 값)과 답 저장에 보낼 값을 만든다

export type AnswerView = { id: string; topic: AnswerTopic; label: string; text: string };

// 문항에 붙인 답(붙인 순서). 지금 없는 답은 빠진다
export function answerViews(ids: string[], answers: Answer[]): AnswerView[] {
  const byId = new Map(answers.map((answer) => [answer.id, answer]));
  return ids.flatMap((id) => {
    const answer = byId.get(id);
    return answer ? [{ id, topic: answer.topic, label: ANSWER_TOPIC_LABELS[answer.topic], text: answer.answer }] : [];
  });
}

// 답 id → 근거에 보일 이름("내 답: 지원동기")
export function answerNames(answers: Answer[]): Record<string, string> {
  return Object.fromEntries(answers.map((answer) => [answer.id, `내 답: ${ANSWER_TOPIC_LABELS[answer.topic]}`]));
}

export type AskPick = { options: number[]; previous: number[]; note: string };
export type AskPicks = Record<string, AskPick>; // 질문 id → 고른 것

export const emptyPick: AskPick = { options: [], previous: [], note: "" };

// 번호를 켜거나 끈다(번호 순서를 지킨다)
export function toggled(list: number[], index: number, on: boolean): number[] {
  const rest = list.filter((value) => value !== index);
  return (on ? [...rest, index] : rest).sort((a, b) => a - b);
}

// 답 저장에 보낼 값. 아무것도 고르지 않은 질문은 뺀다. 기타는 앞뒤 공백을 뗀다
export function picksToSend(items: AskItem[], picks: AskPicks): { id: string; options: number[]; previous: number[]; note: string }[] {
  return items.flatMap((item) => {
    const pick = picks[item.id] ?? emptyPick;
    const note = pick.note.trim();
    if (pick.options.length === 0 && pick.previous.length === 0 && note === "") return [];
    return [{ id: item.id, options: pick.options, previous: pick.previous, note }];
  });
}

// 쓰기 단추가 고르기 없이 켜지는 문항(경험형이 없는 문항)
export const writesWithoutExperience = (kinds: string[] | null): boolean => kinds !== null && !kinds.includes("experience");
