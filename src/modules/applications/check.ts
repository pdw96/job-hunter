import { numbersIn } from "@/modules/experiences/grounding";
import type { WritingSource } from "@/modules/experiences/writing";
import type { Question } from "./repo";
import type { Draft } from "./types";

// 쓴 답을 코드로 검사한다. 어긴 곳을 표시할 뿐 저장과 복사는 막지 않는다. 화면과 DB를 모르는 순수 함수

// 글자 수. 공백 포함 = 줄바꿈까지 모든 글자(코드 포인트), 공백 제외 = 모든 공백 문자를 뺀 글자
export function countChars(text: string, countSpaces: boolean): number {
  return [...(countSpaces ? text : text.replace(/\s/gu, ""))].length;
}

// 답 전체는 문단을 줄바꿈 하나로 이어 센다
export function answerText(draft: Draft): string {
  return draft.paragraphs.map((paragraph) => paragraph.text).join("\n");
}

export type ParagraphCheck = { banned: string[]; ungrounded: string[]; noSource: boolean; staleSource: boolean };
export type DraftCheck = {
  length: { count: number; limit: number | null; over: boolean };
  paragraphs: ParagraphCheck[];
  questionChanged: boolean;
};

const squash = (text: string) => text.replace(/\s+/g, "").toLowerCase();

// 경험의 글 칸과 수치에서 나온 숫자. 기간은 연도와 월로 나눠 본다
function knownNumbers(source: WritingSource): string[] {
  return [
    source.name,
    source.organization,
    source.role,
    source.startMonth?.replace("-", " ") ?? null,
    source.endMonth?.replace("-", " ") ?? null,
    source.situation,
    source.actions,
    source.result,
    ...source.metrics.flatMap((metric) => [metric.text, metric.basis]),
  ].flatMap(numbersIn);
}

export function checkDraft(
  draft: Draft,
  question: Pick<Question, "prompt" | "charLimit" | "countSpaces" | "version">,
  sources: WritingSource[],
): DraftCheck {
  const byId = new Map(sources.map((source) => [source.id, source]));
  const approved = new Set(draft.basedOn.map((ref) => ref.experienceId));
  const basedVersion = new Map(draft.basedOn.map((ref) => [ref.experienceId, ref.contentVersion]));

  const bannedPhrases = draft.basedOn.flatMap((ref) => byId.get(ref.experienceId)?.bannedPhrases ?? []);
  const promptNumbers = numbersIn(question.prompt);

  const count = countChars(answerText(draft), question.countSpaces);
  const limit = question.charLimit;

  const paragraphs = draft.paragraphs.map((paragraph): ParagraphCheck => {
    const squashed = squash(paragraph.text);
    const banned = [...new Set(bannedPhrases)].filter((phrase) => squash(phrase) !== "" && squashed.includes(squash(phrase)));

    const staleSource = paragraph.sources.some((id) => {
      const current = byId.get(id);
      if (!current) return true;
      const based = basedVersion.get(id);
      return based !== undefined && based !== current.contentVersion;
    });

    if (paragraph.edited) return { banned, ungrounded: [], noSource: false, staleSource };

    const known = new Set([
      ...promptNumbers,
      ...paragraph.sources.flatMap((id) => {
        const current = byId.get(id);
        return current ? knownNumbers(current) : [];
      }),
    ]);
    const ungrounded = [...new Set(numbersIn(paragraph.text).filter((n) => !known.has(n)))];
    const noSource = !paragraph.sources.some((id) => approved.has(id));
    return { banned, ungrounded, noSource, staleSource };
  });

  return {
    length: { count, limit, over: limit !== null && count > limit },
    paragraphs,
    questionChanged: draft.questionVersion !== question.version,
  };
}
