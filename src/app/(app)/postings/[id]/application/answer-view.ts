import type { Answer } from "@/modules/applications/answers-repo";
import { answerUnused, unansweredKinds, unansweredTopics } from "@/modules/applications/kinds";
import { ANSWER_TOPIC_LABELS, type AnswerTopic, type QuestionKind } from "@/modules/applications/options";
import type { AskItem } from "@/modules/applications/types";
import { type CompanyFact, hostOf } from "@/modules/postings/research";

// 묻기 화면이 쓰는 순수 함수. 화면 모양(서버가 그려 카드에 넘기는 값)과 답 저장에 보낼 값을 만든다

// unused: 쓰기에 보내지 않는 까닭(kind: 문항의 유형에 맞지 않음, company: 다른 회사 공고에서 한 답). 쓰면 null
export type AnswerView = { id: string; topic: AnswerTopic; label: string; text: string; unused: "kind" | "company" | null };

// 문항에 붙인 답(붙인 순서). 지금 없는 답은 빠진다. postingKey는 지금 공고의 회사 이름 정리 값
export function answerViews(ids: string[], answers: Answer[], topics: AnswerTopic[] | null, postingKey: string): AnswerView[] {
  const byId = new Map(answers.map((answer) => [answer.id, answer]));
  return ids.flatMap((id) => {
    const answer = byId.get(id);
    return answer
      ? [{ id, topic: answer.topic, label: ANSWER_TOPIC_LABELS[answer.topic], text: answer.answer, unused: answerUnused(answer, topics, postingKey) }]
      : [];
  });
}

// 고른 경험의 처음 체크. 승인한 적이 있으면(빈 승인 포함) 그 승인 그대로, 승인 전이면 지금 쓸 수 있는 고른 경험
export function initialChecked(selection: { approvedIds: string[] | null; picks: { experienceId: string; name: string | null }[] } | null): string[] {
  if (!selection) return [];
  if (selection.approvedIds !== null) return selection.approvedIds;
  return selection.picks.filter((pick) => pick.name !== null).map((pick) => pick.experienceId);
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

// 경험형이 들어 있는 문항(유형을 정하기 전이면 경험형으로 본다)
export const wantsExperience = (kinds: string[] | null): boolean => kinds === null || kinds.includes("experience");

// 문항 하나의 쓰기 길은 하나다. 경험형 문항은 고른 경험이 있어야 쓰고(고르기 쪽 단추),
// 경험형이 없는 문항은 붙인 답이 있으면 쓴다. 동기포부형·자기소개형이 있으면 유형마다 그 유형의 답이 있어야 한다(서버의 need_answers와 같은 규칙).
// 승인한 경험의 기록이 바뀌었으면(approvedStale) 빈 경험으로 몰래 쓰지 않고 끈다(다시 고르기 안내는 고르기 구역이 보인다).
// 보낼 경험은 고르기 결과가 있을 때만 고른 것(없을 수도 있다), 없으면 []
export function writePlan(input: {
  kinds: QuestionKind[] | null;
  answerTopics: AnswerTopic[]; // 붙인 답의 주제
  checked: string[];
  hasSelection: boolean;
  approvedStale: boolean;
}): { ids: string[]; enabled: boolean } {
  if (input.approvedStale) return { ids: [], enabled: false };
  const ids = input.hasSelection ? input.checked : [];
  const answered = unansweredKinds(input.kinds, input.answerTopics).length === 0;
  if (wantsExperience(input.kinds)) return { ids, enabled: ids.length > 0 && answered };
  return { ids, enabled: input.answerTopics.length > 0 && answered };
}

// 문항의 주제 중 붙인 답이 없는 것을 알리는 한 줄. 모두 답했으면 null
export function missingTopicsText(topics: AnswerTopic[], answerTopics: AnswerTopic[]): string | null {
  const missing = unansweredTopics(topics, answerTopics);
  return missing.length > 0 ? `${missing.map((topic) => ANSWER_TOPIC_LABELS[topic]).join(", ")}에 아직 답이 없습니다` : null;
}

// 회사 정보 id → 근거에 보일 이름("회사 정보: example.com", www.를 뗀 출처 호스트)
export function companyNames(facts: CompanyFact[]): Record<string, string> {
  return Object.fromEntries(facts.map((fact) => [fact.id, `회사 정보: ${hostOf(fact.url)}`]));
}
