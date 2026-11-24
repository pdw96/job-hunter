import { numbersIn } from "@/modules/experiences/grounding";
import type { WritingSource } from "@/modules/experiences/sources";
import { factNumbers } from "@/modules/postings/research";
import type { Answer } from "./answers-repo";
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

// structureChanged: 근거가 옛 표(바꾸기 전 경험 기록)의 id라 새 구조로 다시 만들어야 한다
export type ParagraphCheck = { banned: string[]; ungrounded: string[]; noSource: boolean; staleSource: boolean; structureChanged: boolean };
// oldIds: 옛 표의 기록 id(oldRecordIds). 없으면 옛 기록 표시를 하지 않는다
// answers: 지금 있는 지원자의 답(답에 쓰인 id로 읽은 것). 없으면 답 근거는 모두 없어진 것으로 본다
// companyFactIds: 지금 쓸 수 있는 회사 정보 id(맞음 인재상·체크한 소식). 없으면 회사 정보 근거는 모두 쓸 수 없게 된 것으로 본다
export type CheckOptions = { oldIds?: Set<string>; answers?: Answer[]; companyFactIds?: Set<string> };
export type DraftCheck = {
  length: { count: number; limit: number | null; over: boolean };
  paragraphs: ParagraphCheck[];
  questionChanged: boolean;
};

const squash = (text: string) => text.replace(/\s+/g, "").toLowerCase();

// 경험의 글 칸과 수치에서 나온 숫자. 기간은 연도와 월로 나눠 본다
export function knownNumbers(source: WritingSource): string[] {
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
  options: CheckOptions = {},
): DraftCheck {
  const oldIds = options.oldIds ?? new Set<string>();
  const byId = new Map(sources.map((source) => [source.id, source]));
  const approved = new Set(draft.basedOn.map((ref) => ref.experienceId));
  const basedVersion = new Map(draft.basedOn.map((ref) => [ref.experienceId, ref.contentVersion]));
  // 쓸 때 보낸(draft.answers) 답 중 지금 있는 것만 근거로 친다. 옛 답에는 answers가 없다
  const sent = new Set(draft.answers ?? []);
  const answerById = new Map((options.answers ?? []).map((answer) => [answer.id, answer]));
  // 회사 정보는 쓸 때 보낸 복사본(draft.companyFacts)의 글로 숫자를 본다. 옛 답에는 둘 다 없다
  const companyIds = options.companyFactIds ?? new Set<string>();
  const factById = new Map((draft.companyFacts ?? []).map((fact) => [fact.id, fact]));

  const bannedPhrases = draft.basedOn.flatMap((ref) => byId.get(ref.experienceId)?.bannedPhrases ?? []);
  const promptNumbers = numbersIn(question.prompt);

  const count = countChars(answerText(draft), question.countSpaces);
  const limit = question.charLimit;

  const paragraphs = draft.paragraphs.map((paragraph): ParagraphCheck => {
    const squashed = squash(paragraph.text);
    const banned = [...new Set(bannedPhrases)].filter((phrase) => squash(phrase) !== "" && squashed.includes(squash(phrase)));

    // 옛 기록을 가리키는 문단은 다시 만들어야 하므로 바뀜·숫자 표시를 따로 하지 않는다
    if (paragraph.sources.some((id) => oldIds.has(id))) {
      return { banned, ungrounded: [], noSource: false, staleSource: false, structureChanged: true };
    }

    const answerIds = paragraph.answers ?? [];
    const factIds = paragraph.company ?? [];
    // 다시 조사했거나 체크를 풀어 지금 쓸 수 없는 회사 정보를 가리키면 바뀜으로 본다
    const staleSource =
      paragraph.sources.some((id) => {
        const current = byId.get(id);
        if (!current) return true;
        const based = basedVersion.get(id);
        return based !== undefined && based !== current.contentVersion;
      }) ||
      answerIds.some((id) => !answerById.has(id)) ||
      factIds.some((id) => !companyIds.has(id));
    const groundingAnswers = answerIds.flatMap((id) => (sent.has(id) ? (answerById.get(id) ?? []) : []));

    if (paragraph.edited) return { banned, ungrounded: [], noSource: false, staleSource, structureChanged: false };

    const known = new Set([
      ...promptNumbers,
      // 승인한(basedOn) 경험의 숫자만 근거로 친다
      ...paragraph.sources.flatMap((id) => {
        const current = byId.get(id);
        return current && approved.has(id) ? knownNumbers(current) : [];
      }),
      // 근거로 친 답 글의 숫자도 허용한다(공고 글의 숫자는 허용하지 않는다)
      ...groundingAnswers.flatMap((answer) => numbersIn(answer.answer)),
      // 이 문단이 단 회사 정보의 숫자만 허용한다(복사본에 있는 것만)
      ...factIds.flatMap((id) => {
        const fact = factById.get(id);
        return fact ? factNumbers(fact) : [];
      }),
    ]);
    const ungrounded = [...new Set(numbersIn(paragraph.text).filter((n) => !known.has(n)))];
    // 회사 정보는 지원자의 이야기가 아니므로 근거로 치지 않는다(회사 정보만 단 문단은 근거 없음)
    const noSource = !paragraph.sources.some((id) => approved.has(id)) && groundingAnswers.length === 0;
    return { banned, ungrounded, noSource, staleSource, structureChanged: false };
  });

  return {
    length: { count, limit, over: limit !== null && count > limit },
    paragraphs,
    questionChanged: draft.questionVersion !== question.version,
  };
}
