import type { Db } from "@/db/types";
import { getPosting } from "@/modules/postings/repo";
import { moveItem, removeItem, replaceItemLines } from "./career-entries";
import { getCareer, saveCareerContent } from "./career-repo";
import { RESUME_LIMITS } from "./options";
import { parseLines } from "./resume-entries";
import { editBlock, withEditLock } from "./submission-repo";
import type { CareerContent } from "./types";

// 경력기술서 다듬기(AI 없음): 한 항목의 한 일·성과 줄 고치기, 회사 안에서 옮기기, 빼기. 공통본과 맞춤본이 같다

export type CareerEdit =
  | { type: "lines"; itemId: string; field: "done" | "results"; text: string } // 한 줄에 한 항목 줄
  | { type: "move"; itemId: string; direction: "up" | "down" }
  | { type: "remove"; itemId: string }; // 경력 id면 회사째

type Failure = "not_found" | "not_apply" | "submitted" | "changed" | "too_long" | "too_many_lines";

export async function editCareer(
  db: Db,
  userId: string,
  careerId: string,
  edit: CareerEdit,
  expectedVersion: number,
): Promise<{ ok: true; value: CareerContent } | { ok: false; reason: Failure }> {
  const career = await getCareer(db, userId, careerId);
  if (!career) return { ok: false, reason: "not_found" };
  // 맞춤본은 지원 판단이 "지원"인 공고에서만 고친다
  if (career.postingId) {
    const posting = await getPosting(db, userId, career.postingId);
    if (!posting) return { ok: false, reason: "not_found" };
    const block = await editBlock(db, userId, posting);
    if (block) return { ok: false, reason: block };
  }
  const content = career.content;
  if (!content || career.version !== expectedVersion) return { ok: false, reason: "changed" };
  // 빼기는 경력 id도 받고, 줄 고치기·옮기기는 항목 id만 받는다
  const isItem = content.companies.some((company) => company.items.some((item) => item.experienceId === edit.itemId));
  const isCompany = content.companies.some((company) => company.experienceId === edit.itemId);
  if (!isItem && !(edit.type === "remove" && isCompany)) return { ok: false, reason: "changed" };

  let next: CareerContent;
  if (edit.type === "lines") {
    const lines = parseLines(edit.text);
    if (lines.length > RESUME_LIMITS.editLines) return { ok: false, reason: "too_many_lines" };
    if (lines.some((line) => [...line].length > RESUME_LIMITS.line)) return { ok: false, reason: "too_long" };
    next = replaceItemLines(content, edit.itemId, edit.field, lines);
  } else if (edit.type === "move") {
    next = moveItem(content, edit.itemId, edit.direction);
    if (next === content) return { ok: true, value: content }; // 바뀐 것이 없으면 저장하지 않는다
  } else {
    next = removeItem(content, edit.itemId);
  }

  // 맞춤본은 제출 확인과 저장을 공고 잠금 안에서 한다. 공통본은 잠금 없이 저장한다
  const save = (tx: Db) => saveCareerContent(tx, userId, careerId, next, expectedVersion);
  const saved = career.postingId ? await withEditLock(db, userId, career.postingId, save) : await save(db);
  return saved.ok ? { ok: true, value: next } : saved;
}
