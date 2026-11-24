import type { Db } from "@/db/types";
import { listCareerSources, listResumeSources, listWritingSources, oldRecordIds, sourceNames } from "@/modules/experiences/sources";
import { chosenDocuments } from "@/modules/postings/documents";
import { getPosting, type Posting } from "@/modules/postings/repo";
import { hostOf } from "@/modules/postings/research";
import { type Answer, listAnswersByIds } from "./answers-repo";
import { checkCareer } from "./career-check";
import { getCommonCareer, getTailoredCareer } from "./career-repo";
import { checkDraft } from "./check";
import { ANSWER_TOPIC_LABELS } from "./options";
import { listQuestions, type Question } from "./repo";
import { checkResume } from "./resume-check";
import { getCommonResume, getTailoredResume } from "./resume-repo";
import { insertSubmission, reopenSubmission, withPostingLock } from "./submission-repo";
import type { Draft, SubmissionContent, SubmittedCareer, SubmittedResume } from "./types";
import { usableCompanyFacts } from "./write";

// 제출본 얼리기. 공고의 원문, 이력서, 경력기술서, 자소서 답을 그 순간의 복사본으로 저장한다. 연락처는 담지 않는다

const DELETED = "지운 경험";
const DELETED_ANSWER = "지운 답";
const DELETED_FACT = "지운 회사 정보";

// 회사 정보 근거의 이름. 답의 복사본(쓸 때 보낸 것)에서 찾고, 없으면 "지운 회사 정보"
function factName(draft: Draft | null, id: string): string {
  const fact = (draft?.companyFacts ?? []).find((f) => f.id === id);
  return fact ? `회사 정보: ${hostOf(fact.url)}` : DELETED_FACT;
}

// 답에 쓰인 지원자의 답 id(쓸 때 보낸 것과 문단의 근거). 같은 id는 한 번
function draftAnswerIds(questions: Question[]): string[] {
  const ids = questions.flatMap((q) => [...(q.draft?.answers ?? []), ...(q.draft?.paragraphs ?? []).flatMap((p) => p.answers ?? [])]);
  return [...new Set(ids)];
}

const answerLabel = (answer: Answer) => `내 답: ${ANSWER_TOPIC_LABELS[answer.topic]}`;

// 순수 함수. names는 경험 id → 지금 이름(지운 경험은 없음 → "지운 경험"), answerNames는 답 id → "내 답: (주제)"(없으면 "지운 답").
// 답 근거와 회사 정보 근거("회사 정보: 호스트", 답의 복사본에서 찾는다)는 경험 근거 뒤에 같은 목록으로 얼린다
// 고르지 않은 서류는 얼리지 않는다: 자기소개서를 고르지 않았으면 answers가 빈 배열, 이력서는 resume이, 경력기술서는 career가 null(호출하는 쪽이 정한다)
export function freeze(
  posting: Posting,
  questions: Question[],
  resume: SubmittedResume | null,
  names: Map<string, string>,
  answerNames: Map<string, string> = new Map(),
  career: SubmittedCareer | null = null,
): SubmissionContent {
  return {
    posting: {
      company: posting.company,
      title: posting.title,
      url: posting.url,
      deadline: posting.deadline,
      isRolling: posting.isRolling,
      rawText: posting.rawText,
      companyNote: posting.companyNote,
    },
    resume,
    career,
    answers: [...questions]
      .sort((a, b) => a.position - b.position)
      .map((question) => ({
        prompt: question.prompt,
        charLimit: question.charLimit,
        countSpaces: question.countSpaces,
        paragraphs: (question.draft?.paragraphs ?? []).map((paragraph) => ({
          text: paragraph.text,
          sources: [
            ...paragraph.sources.map((experienceId) => ({ experienceId, name: names.get(experienceId) ?? DELETED })),
            ...(paragraph.answers ?? []).map((answerId) => ({ experienceId: answerId, name: answerNames.get(answerId) ?? DELETED_ANSWER })),
            ...(paragraph.company ?? []).map((factId) => ({ experienceId: factId, name: factName(question.draft, factId) })),
          ],
          edited: paragraph.edited,
        })),
      })),
  };
}

// 맞춤본이 있으면 맞춤본, 없으면 트랙 공통본, 둘 다 없으면 null. 내용이 비어 있거나 항목이 0개인 행은 없는 것으로 본다
async function pickResume(db: Db, userId: string, posting: Posting) {
  const [tailored, common] = await Promise.all([getTailoredResume(db, userId, posting.id), getCommonResume(db, userId, posting.trackId)]);
  if (tailored?.content && tailored.content.entries.length > 0) {
    return { from: "tailored" as const, content: tailored.content, commonVersion: common?.version ?? tailored.content.commonVersion ?? 0 };
  }
  if (common?.content && common.content.entries.length > 0) return { from: "common" as const, content: common.content, commonVersion: null };
  return null;
}

// 경력기술서도 맞춤본 → 트랙 공통본 → null. 회사가 0개인 행은 없는 것으로 본다(회사 머리만 있는 행은 낸다)
async function pickCareer(db: Db, userId: string, posting: Posting) {
  const [tailored, common] = await Promise.all([getTailoredCareer(db, userId, posting.id), getCommonCareer(db, userId, posting.trackId)]);
  if (tailored?.content && tailored.content.companies.length > 0) {
    return { from: "tailored" as const, content: tailored.content, commonVersion: common?.version ?? tailored.content.commonVersion ?? 0 };
  }
  if (common?.content && common.content.companies.length > 0) return { from: "common" as const, content: common.content, commonVersion: null };
  return null;
}

export type SubmitFailure = "not_found" | "not_apply" | "changed";

export async function submitPosting(
  db: Db,
  userId: string,
  postingId: string,
  expectedNumber: number,
  now: Date = new Date(),
): Promise<{ ok: true; number: number } | { ok: false; reason: SubmitFailure }> {
  const posting = await getPosting(db, userId, postingId);
  if (!posting) return { ok: false, reason: "not_found" };
  if (posting.status !== "apply") return { ok: false, reason: "not_apply" };

  // 읽기와 넣기를 잠금 안에서 한다: 그 사이에 끼어드는 저장이 없어야 제출본에 최신 답이 얼려진다
  return withPostingLock(db, postingId, async (tx) => {
    // 고른 서류는 잠금 안에서 다시 읽은 공고로 본다
    const current = (await getPosting(tx, userId, postingId)) ?? posting;
    const chosen = chosenDocuments(current);
    const [questions, picked, pickedCareer, names] = await Promise.all([
      chosen.includes("cover_letter") ? listQuestions(tx, userId, postingId) : Promise.resolve([]),
      chosen.includes("resume") ? pickResume(tx, userId, posting) : Promise.resolve(null),
      chosen.includes("career") ? pickCareer(tx, userId, posting) : Promise.resolve(null),
      sourceNames(tx, userId),
    ]);
    const resume = picked ? { from: picked.from, content: picked.content } : null;
    const career = pickedCareer ? { from: pickedCareer.from, content: pickedCareer.content } : null;
    const answers = await listAnswersByIds(tx, userId, draftAnswerIds(questions));
    const answerNames = new Map(answers.map((answer) => [answer.id, answerLabel(answer)]));
    return insertSubmission(tx, userId, postingId, expectedNumber, freeze(posting, questions, resume, names, answerNames, career), now);
  });
}

export async function reopenPosting(
  db: Db,
  userId: string,
  postingId: string,
  expectedNumber: number,
  now: Date = new Date(),
): Promise<{ ok: true } | { ok: false; reason: "not_found" | "changed" }> {
  if (!(await getPosting(db, userId, postingId))) return { ok: false, reason: "not_found" };
  return withPostingLock(db, postingId, (tx) => reopenSubmission(tx, userId, postingId, expectedNumber, now));
}

const numbers = (list: number[]) => `${list.join(", ")}번`;

// 화면의 확인 창에 보일 문장들. 지금의 경험으로 계산한다
export async function submitPreview(
  db: Db,
  userId: string,
  posting: Posting,
): Promise<{ resumeFrom: "tailored" | "common" | null; careerFrom: "tailored" | "common" | null; questionCount: number; warnings: string[] }> {
  const chosen = chosenDocuments(posting);
  const withLetter = chosen.includes("cover_letter");
  const withResume = chosen.includes("resume");
  const withCareer = chosen.includes("career");
  const [questions, writingSources, resumeSources, picked, oldIds, facts, careerSources, pickedCareer] = await Promise.all([
    withLetter ? listQuestions(db, userId, posting.id) : Promise.resolve([]),
    listWritingSources(db, userId, posting.trackId),
    listResumeSources(db, userId, posting.trackId),
    withResume ? pickResume(db, userId, posting) : Promise.resolve(null),
    oldRecordIds(db, userId),
    withLetter ? usableCompanyFacts(db, userId, posting.company) : Promise.resolve([]),
    withCareer ? listCareerSources(db, userId, posting.trackId) : Promise.resolve([]),
    withCareer ? pickCareer(db, userId, posting) : Promise.resolve(null),
  ]);
  const companyFactIds = new Set(facts.map((fact) => fact.id));
  const ordered = [...questions].sort((a, b) => a.position - b.position);
  const answers = await listAnswersByIds(db, userId, draftAnswerIds(ordered));
  const warnings: string[] = [];

  if (withLetter && ordered.length === 0) warnings.push("자소서 문항이 없습니다");

  const empty: number[] = [];
  const over: number[] = [];
  const marked: number[] = [];
  ordered.forEach((question, index) => {
    const draft = question.draft;
    if (!draft || draft.paragraphs.length === 0) {
      empty.push(index + 1);
      return;
    }
    const check = checkDraft(draft, question, writingSources, { oldIds, answers, companyFactIds });
    if (check.length.over) over.push(index + 1);
    const flagged = (p: (typeof check.paragraphs)[number]) =>
      p.banned.length > 0 || p.ungrounded.length > 0 || p.noSource || p.staleSource || p.structureChanged;
    if (check.questionChanged || check.paragraphs.some(flagged)) {
      marked.push(index + 1);
    }
  });
  if (empty.length > 0) warnings.push(`답이 없는 문항: ${numbers(empty)}`);
  if (over.length > 0) warnings.push(`글자 수를 넘은 문항: ${numbers(over)}`);
  if (marked.length > 0) warnings.push(`표시가 남은 문항: ${numbers(marked)}`);

  if (!withResume) {
    // 이력서를 내지 않는 공고라 말하지 않는다
  } else if (!picked) {
    warnings.push("이력서가 없습니다");
  } else {
    if (picked.from === "common") warnings.push("맞춤본이 없어 트랙 공통본으로 냅니다");
    const check = checkResume(picked.content, resumeSources, picked.commonVersion, { oldIds });
    const flagged = check.entries.filter(
      (e) => e.unavailable || e.structureChanged || e.empty || e.stale || e.scopeChanged || e.banned.length > 0 || e.ungrounded.length > 0,
    ).length;
    if (flagged > 0) warnings.push(`이력서에 표시가 남은 항목: ${flagged}개`);
  }

  if (!withCareer) {
    // 경력기술서를 내지 않는 공고라 말하지 않는다
  } else if (!pickedCareer) {
    warnings.push("경력기술서가 없습니다");
  } else {
    if (pickedCareer.from === "common") warnings.push("경력기술서 맞춤본이 없어 트랙 공통본으로 냅니다");
    const check = checkCareer(pickedCareer.content, careerSources, pickedCareer.commonVersion);
    // 편집 화면에 보이는 표시만 센다: 회사 줄의 표시(쓸 수 없음, 기록 바뀜)와 항목의 표시. 쓸 수 없는 회사 아래 항목은 회사 줄에서 한 번만 센다
    const flagged = check.companies.reduce((sum, company) => {
      const items = company.unavailable
        ? 0
        : company.items.filter((i) => i.unavailable || i.empty || i.stale || i.scopeChanged || i.banned.length > 0 || i.ungrounded.length > 0).length;
      return sum + (company.unavailable || company.stale ? 1 : 0) + items;
    }, 0);
    if (flagged > 0) warnings.push(`경력기술서에 표시가 남은 항목: ${flagged}개`);
  }

  return { resumeFrom: picked?.from ?? null, careerFrom: pickedCareer?.from ?? null, questionCount: ordered.length, warnings };
}
