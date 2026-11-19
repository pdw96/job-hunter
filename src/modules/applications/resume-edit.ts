import type { Db } from "@/db/types";
import { getPosting } from "@/modules/postings/repo";
import { RESUME_LIMITS } from "./options";
import { editBlock, withEditLock } from "./submission-repo";
import { moveEntry, parseLines, removeEntry, replaceLines } from "./resume-entries";
import { getResume, saveResumeContent } from "./resume-repo";
import type { ResumeContent } from "./types";

// 이력서 다듬기(AI 없음): 한 항목의 줄 고치기, 섹션 안에서 옮기기, 빼기. 공통본과 맞춤본이 같다

export type ResumeEdit =
  | { type: "lines"; experienceId: string; text: string } // 한 줄에 한 항목 줄
  | { type: "move"; experienceId: string; direction: "up" | "down" }
  | { type: "remove"; experienceId: string };

type Failure = "not_found" | "not_apply" | "submitted" | "changed" | "too_long" | "too_many_lines";

export async function editResume(
  db: Db,
  userId: string,
  resumeId: string,
  edit: ResumeEdit,
  expectedVersion: number,
): Promise<{ ok: true; value: ResumeContent } | { ok: false; reason: Failure }> {
  const resume = await getResume(db, userId, resumeId);
  if (!resume) return { ok: false, reason: "not_found" };
  // 맞춤본은 지원 판단이 "지원"인 공고에서만 고친다
  if (resume.postingId) {
    const posting = await getPosting(db, userId, resume.postingId);
    if (!posting) return { ok: false, reason: "not_found" };
    const block = await editBlock(db, userId, posting);
    if (block) return { ok: false, reason: block };
  }
  const content = resume.content;
  if (!content || resume.version !== expectedVersion || !content.entries.some((entry) => entry.experienceId === edit.experienceId)) {
    return { ok: false, reason: "changed" };
  }

  let next: ResumeContent;
  if (edit.type === "lines") {
    const lines = parseLines(edit.text);
    if (lines.length > RESUME_LIMITS.editLines) return { ok: false, reason: "too_many_lines" };
    if (lines.some((line) => [...line].length > RESUME_LIMITS.line)) return { ok: false, reason: "too_long" };
    next = replaceLines(content, edit.experienceId, lines);
  } else if (edit.type === "move") {
    next = moveEntry(content, edit.experienceId, edit.direction);
    if (next === content) return { ok: true, value: content }; // 바뀐 것이 없으면 저장하지 않는다
  } else {
    next = removeEntry(content, edit.experienceId);
  }

  // 맞춤본은 제출 확인과 저장을 공고 잠금 안에서 한다. 공통본은 잠금 없이 저장한다
  const save = (tx: Db) => saveResumeContent(tx, userId, resumeId, next, expectedVersion);
  const saved = resume.postingId ? await withEditLock(db, userId, resume.postingId, save) : await save(db);
  return saved.ok ? { ok: true, value: next } : saved;
}
