import { randomUUID } from "node:crypto";
import { and, asc, count, eq, isNull, or, sql } from "drizzle-orm";
import type { Db } from "@/db/types";
import { getPosting } from "@/modules/postings/repo";
import { APPLICATION_LIMITS } from "./options";
import { questions } from "./schema";
import { editBlock, withEditLock } from "./submission-repo";
import type { Draft, Selection, SourceRef } from "./types";

// 자소서 문항, 고른 경험, 쓴 답의 저장과 조회. 모든 함수가 userId로 소유자를 확인한다.

export type QuestionInput = { prompt: string; charLimit: number | null; countSpaces: boolean };
export type Question = QuestionInput & {
  id: string;
  postingId: string;
  position: number;
  version: number;
  selection: Selection | null;
  draft: Draft | null;
  createdAt: Date;
  updatedAt: Date;
};

type Stale = { ok: true } | { ok: false; reason: "not_found" | "changed" };

const mine = (userId: string, id: string) => and(eq(questions.id, id), eq(questions.userId, userId));
const json = (value: unknown) => sql`${JSON.stringify(value)}::jsonb`;

function toQuestion(row: typeof questions.$inferSelect): Question {
  const { userId: owner, ...rest } = row;
  void owner;
  return rest;
}

// 조건이 어긋나 못 고쳤을 때, 문항이 없는 것인지 조건이 바뀐 것인지 가른다
async function whyNot(db: Db, userId: string, id: string): Promise<{ ok: false; reason: "not_found" | "changed" }> {
  const [exists] = await db.select({ id: questions.id }).from(questions).where(mine(userId, id)).limit(1);
  return { ok: false, reason: exists ? "changed" : "not_found" };
}

// 지원으로 정한 공고에만 문항을 더한다. 한도를 넘으면 하나도 넣지 않는다
export async function addQuestions(
  db: Db,
  userId: string,
  postingId: string,
  inputs: QuestionInput[],
): Promise<{ ok: true; ids: string[] } | { ok: false; reason: "not_found" | "not_apply" | "submitted" | "too_many" }> {
  const posting = await getPosting(db, userId, postingId);
  if (!posting) return { ok: false, reason: "not_found" };
  const block = await editBlock(db, userId, posting);
  if (block) return { ok: false, reason: block };

  // 확인과 저장을 공고 잠금 안에서 한다(withEditLock이 곧 트랜잭션)
  return withEditLock(db, userId, postingId, async (tx) => {
    const [{ value }] = await tx
      .select({ value: count() })
      .from(questions)
      .where(and(eq(questions.userId, userId), eq(questions.postingId, postingId)));
    if (value + inputs.length > APPLICATION_LIMITS.questions) return { ok: false as const, reason: "too_many" as const };
    const [{ last }] = await tx
      .select({ last: sql<number>`coalesce(max(${questions.position}), -1)` })
      .from(questions)
      .where(and(eq(questions.userId, userId), eq(questions.postingId, postingId)));
    const ids = inputs.map(() => randomUUID());
    if (inputs.length > 0) {
      await tx.insert(questions).values(
        inputs.map((input, index) => ({
          id: ids[index],
          userId,
          postingId,
          position: Number(last) + 1 + index,
          prompt: input.prompt,
          charLimit: input.charLimit,
          countSpaces: input.countSpaces,
        })),
      );
    }
    return { ok: true as const, ids };
  });
}

// 공고가 지원이 아니게 되어도 남은 문항은 읽힌다
export async function listQuestions(db: Db, userId: string, postingId: string): Promise<Question[]> {
  const rows = await db
    .select()
    .from(questions)
    .where(and(eq(questions.userId, userId), eq(questions.postingId, postingId)))
    .orderBy(asc(questions.position), asc(questions.createdAt));
  return rows.map(toQuestion);
}

export async function getQuestion(db: Db, userId: string, id: string): Promise<Question | null> {
  const [row] = await db.select().from(questions).where(mine(userId, id)).limit(1);
  return row ? toQuestion(row) : null;
}

// 문항의 공고가 지원이고 제출해 잠기지 않았을 때만 문항을 고치거나 지울 수 있다. 확인과 변경을 공고 잠금 안에서 한다
async function guardedWrite(
  db: Db,
  userId: string,
  id: string,
  write: (tx: Db) => Promise<{ ok: true } | { ok: false; reason: "not_found" }>,
): Promise<{ ok: true } | { ok: false; reason: "not_found" | "not_apply" | "submitted" }> {
  const question = await getQuestion(db, userId, id);
  if (!question) return { ok: false, reason: "not_found" };
  const posting = await getPosting(db, userId, question.postingId);
  if (!posting) return { ok: false, reason: "not_found" };
  const block = await editBlock(db, userId, posting);
  if (block) return { ok: false, reason: block };
  return withEditLock(db, userId, posting.id, write);
}

// 문항 글이 바뀌면 version을 올리고 고르기 결과를 지운다(쓴 답은 남긴다). 제한·기준만 바뀌면 둘 다 그대로
export async function updateQuestion(
  db: Db,
  userId: string,
  id: string,
  input: QuestionInput,
): Promise<{ ok: true } | { ok: false; reason: "not_found" | "not_apply" | "submitted" }> {
  return guardedWrite(db, userId, id, (tx) => doUpdate(tx, userId, id, input));
}

async function doUpdate(db: Db, userId: string, id: string, input: QuestionInput): Promise<{ ok: true } | { ok: false; reason: "not_found" }> {
  const changed = sql`${questions.prompt} <> ${input.prompt}`;
  const updated = await db
    .update(questions)
    .set({
      prompt: input.prompt,
      charLimit: input.charLimit,
      countSpaces: input.countSpaces,
      version: sql`case when ${changed} then ${questions.version} + 1 else ${questions.version} end`,
      selection: sql`case when ${changed} then null else ${questions.selection} end`,
      updatedAt: new Date(),
    })
    .where(mine(userId, id))
    .returning({ id: questions.id });
  return updated.length > 0 ? { ok: true } : { ok: false, reason: "not_found" };
}

export async function deleteQuestion(
  db: Db,
  userId: string,
  id: string,
): Promise<{ ok: true } | { ok: false; reason: "not_found" | "not_apply" | "submitted" }> {
  return guardedWrite(db, userId, id, async (tx) => {
    const deleted = await tx.delete(questions).where(mine(userId, id)).returning({ id: questions.id });
    return deleted.length > 0 ? { ok: true as const } : { ok: false as const, reason: "not_found" as const };
  });
}

// 고른 결과를 저장한다. 읽은 때의 문항 글 그대로일 때만 쓴다. 승인은 지워지고 답은 그대로다
export async function saveSelection(db: Db, userId: string, id: string, selection: Selection): Promise<Stale> {
  const updated = await db
    .update(questions)
    .set({ selection: { ...selection, approved: null, approvedAt: null }, updatedAt: new Date() })
    .where(and(mine(userId, id), eq(questions.version, selection.questionVersion)))
    .returning({ id: questions.id });
  return updated.length > 0 ? { ok: true } : whyNot(db, userId, id);
}

// 지금 고르기 결과가 읽은 것과 같을 때만 승인한다
export async function approveSelection(
  db: Db,
  userId: string,
  id: string,
  approved: SourceRef[],
  readAs: Selection,
  now: Date = new Date(),
): Promise<Stale> {
  const updated = await db
    .update(questions)
    .set({
      selection: { ...readAs, approved, approvedAt: now.toISOString() },
      updatedAt: now,
    })
    .where(and(mine(userId, id), sql`${questions.selection} = ${json(readAs)}`))
    .returning({ id: questions.id });
  return updated.length > 0 ? { ok: true } : whyNot(db, userId, id);
}

// 쓴 답을 저장한다. 읽은 때의 문항 글, 승인, 지금 답(없으면 null) 그대로일 때만 쓴다.
// 쓰는 동안 직접 고친 문단을 덮어쓰지 않으려고 지금 답도 비교한다
export async function saveDraft(
  db: Db,
  userId: string,
  id: string,
  draft: Draft,
  readAs: { version: number; approved: SourceRef[]; draft: Draft | null },
): Promise<Stale> {
  const updated = await db
    .update(questions)
    .set({ draft, updatedAt: new Date() })
    .where(
      and(
        mine(userId, id),
        eq(questions.version, readAs.version),
        sql`${questions.selection}->'approved' = ${json(readAs.approved)}`,
        readAs.draft === null ? isNull(questions.draft) : sql`${questions.draft} = ${json(readAs.draft)}`,
      ),
    )
    .returning({ id: questions.id });
  return updated.length > 0 ? { ok: true } : whyNot(db, userId, id);
}

// 부분 수정·직접 수정으로 답을 바꾼다. 지금 답이 읽은 것과 같을 때만 쓴다
export async function replaceDraft(db: Db, userId: string, id: string, expected: Draft, next: Draft): Promise<Stale> {
  const updated = await db
    .update(questions)
    .set({ draft: next, updatedAt: new Date() })
    .where(and(mine(userId, id), sql`${questions.draft} = ${json(expected)}`))
    .returning({ id: questions.id });
  return updated.length > 0 ? { ok: true } : whyNot(db, userId, id);
}

// 답이 없거나 문단이 하나도 없을 때만 처음 쓴 답(직접 쓰기)을 저장한다. 그사이 답이 생겼으면 changed
export async function createDraft(db: Db, userId: string, id: string, draft: Draft): Promise<Stale> {
  const updated = await db
    .update(questions)
    .set({ draft, updatedAt: new Date() })
    .where(and(mine(userId, id), or(isNull(questions.draft), sql`${questions.draft}->'paragraphs' = '[]'::jsonb`)))
    .returning({ id: questions.id });
  return updated.length > 0 ? { ok: true } : whyNot(db, userId, id);
}
