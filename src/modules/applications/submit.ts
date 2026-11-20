import type { Db } from "@/db/types";
import { listResumeSources, listWritingSources, sourceNames } from "@/modules/experiences/sources";
import { getPosting, type Posting } from "@/modules/postings/repo";
import { checkDraft } from "./check";
import { listQuestions, type Question } from "./repo";
import { checkResume } from "./resume-check";
import { getCommonResume, getTailoredResume } from "./resume-repo";
import { insertSubmission, reopenSubmission, withPostingLock } from "./submission-repo";
import type { SubmissionContent, SubmittedResume } from "./types";

// 제출본 얼리기. 공고의 원문, 이력서, 자소서 답을 그 순간의 복사본으로 저장한다. 연락처는 담지 않는다

const DELETED = "지운 경험";

// 순수 함수. names는 경험 id → 지금 이름(지운 경험은 없음 → "지운 경험")
export function freeze(
  posting: Posting,
  questions: Question[],
  resume: SubmittedResume | null,
  names: Map<string, string>,
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
    answers: [...questions]
      .sort((a, b) => a.position - b.position)
      .map((question) => ({
        prompt: question.prompt,
        charLimit: question.charLimit,
        countSpaces: question.countSpaces,
        paragraphs: (question.draft?.paragraphs ?? []).map((paragraph) => ({
          text: paragraph.text,
          sources: paragraph.sources.map((experienceId) => ({ experienceId, name: names.get(experienceId) ?? DELETED })),
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
    const [questions, picked, names] = await Promise.all([
      listQuestions(tx, userId, postingId),
      pickResume(tx, userId, posting),
      sourceNames(tx, userId),
    ]);
    const resume = picked ? { from: picked.from, content: picked.content } : null;
    return insertSubmission(tx, userId, postingId, expectedNumber, freeze(posting, questions, resume, names), now);
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
): Promise<{ resumeFrom: "tailored" | "common" | null; questionCount: number; warnings: string[] }> {
  const [questions, writingSources, resumeSources, picked] = await Promise.all([
    listQuestions(db, userId, posting.id),
    listWritingSources(db, userId, posting.trackId),
    listResumeSources(db, userId, posting.trackId),
    pickResume(db, userId, posting),
  ]);
  const ordered = [...questions].sort((a, b) => a.position - b.position);
  const warnings: string[] = [];

  if (ordered.length === 0) warnings.push("자소서 문항이 없습니다");

  const empty: number[] = [];
  const over: number[] = [];
  const marked: number[] = [];
  ordered.forEach((question, index) => {
    const draft = question.draft;
    if (!draft || draft.paragraphs.length === 0) {
      empty.push(index + 1);
      return;
    }
    const check = checkDraft(draft, question, writingSources);
    if (check.length.over) over.push(index + 1);
    if (check.questionChanged || check.paragraphs.some((p) => p.banned.length > 0 || p.ungrounded.length > 0 || p.noSource || p.staleSource)) {
      marked.push(index + 1);
    }
  });
  if (empty.length > 0) warnings.push(`답이 없는 문항: ${numbers(empty)}`);
  if (over.length > 0) warnings.push(`글자 수를 넘은 문항: ${numbers(over)}`);
  if (marked.length > 0) warnings.push(`표시가 남은 문항: ${numbers(marked)}`);

  if (!picked) {
    warnings.push("이력서가 없습니다");
  } else {
    if (picked.from === "common") warnings.push("맞춤본이 없어 트랙 공통본으로 냅니다");
    const check = checkResume(picked.content, resumeSources, picked.commonVersion);
    const flagged = check.entries.filter(
      (e) => e.unavailable || e.empty || e.stale || e.scopeChanged || e.banned.length > 0 || e.ungrounded.length > 0,
    ).length;
    if (flagged > 0) warnings.push(`이력서에 표시가 남은 항목: ${flagged}개`);
  }

  return { resumeFrom: picked?.from ?? null, questionCount: ordered.length, warnings };
}
