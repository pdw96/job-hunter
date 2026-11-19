import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import type { Db } from "@/db/types";
import type { PostingStatus } from "@/modules/postings/options";
import { getPosting } from "@/modules/postings/repo";
import { hasPgCode } from "./db-errors";
import { submissions } from "./schema";
import type { SubmissionContent } from "./types";

// 공고마다 쌓는 제출본의 저장과 조회. 마지막 번호가 잠겨 있으면(reopened_at이 비어 있으면) 새로 넣지 못한다.

export type Submission = {
  id: string;
  postingId: string;
  number: number;
  content: SubmissionContent;
  submittedAt: Date;
  reopenedAt: Date | null;
};
export type SubmissionSummary = Omit<Submission, "content">;

const ofPosting = (userId: string, postingId: string) =>
  and(eq(submissions.userId, userId), eq(submissions.postingId, postingId));

const summaryColumns = {
  id: submissions.id,
  postingId: submissions.postingId,
  number: submissions.number,
  submittedAt: submissions.submittedAt,
  reopenedAt: submissions.reopenedAt,
};

export async function listSubmissions(db: Db, userId: string, postingId: string): Promise<SubmissionSummary[]> {
  return db.select(summaryColumns).from(submissions).where(ofPosting(userId, postingId)).orderBy(asc(submissions.number));
}

export async function getSubmission(db: Db, userId: string, postingId: string, number: number): Promise<Submission | null> {
  const [row] = await db
    .select({ ...summaryColumns, content: submissions.content })
    .from(submissions)
    .where(and(ofPosting(userId, postingId), eq(submissions.number, number)))
    .limit(1);
  return row ?? null;
}

export async function latestSubmission(db: Db, userId: string, postingId: string): Promise<SubmissionSummary | null> {
  const [row] = await db
    .select(summaryColumns)
    .from(submissions)
    .where(ofPosting(userId, postingId))
    .orderBy(desc(submissions.number))
    .limit(1);
  return row ?? null;
}

export const isLocked = (latest: SubmissionSummary | null): boolean => latest !== null && latest.reopenedAt === null;

// 공고에서 자소서·맞춤본을 고칠 수 없는 까닭. 고칠 수 있으면 null. 지원이 아니면 not_apply, 제출해서 잠겼으면 submitted
export async function editBlock(
  db: Db,
  userId: string,
  posting: { id: string; status: PostingStatus },
): Promise<"not_apply" | "submitted" | null> {
  if (posting.status !== "apply") return "not_apply";
  return isLocked(await latestSubmission(db, userId, posting.id)) ? "submitted" : null;
}

// AI가 도는 사이 상태가 바뀌었을 수 있어, 저장 직전에 공고를 다시 읽고 같은 검사를 한다. 공고가 사라졌으면 null(저장이 알아서 실패한다)
export async function editBlockNow(db: Db, userId: string, postingId: string): Promise<"not_apply" | "submitted" | null> {
  const posting = await getPosting(db, userId, postingId);
  return posting ? editBlock(db, userId, posting) : null;
}

// 마지막 번호가 expectedNumber(없으면 0)이고 잠기지 않았을 때만 expectedNumber + 1로 넣는다.
// 동시에 넣어 고유 색인을 어기면(23505) changed, 그 사이 공고가 지워져 외래 키를 어기면(23503) not_found
export async function insertSubmission(
  db: Db,
  userId: string,
  postingId: string,
  expectedNumber: number,
  content: SubmissionContent,
  now: Date,
): Promise<{ ok: true; number: number } | { ok: false; reason: "changed" | "not_found" }> {
  if (!(await getPosting(db, userId, postingId))) return { ok: false, reason: "not_found" };
  const latest = await latestSubmission(db, userId, postingId);
  if ((latest?.number ?? 0) !== expectedNumber || isLocked(latest)) return { ok: false, reason: "changed" };
  const number = expectedNumber + 1;
  try {
    await db.insert(submissions).values({ id: randomUUID(), userId, postingId, number, content, submittedAt: now });
  } catch (error) {
    if (hasPgCode(error, "23505")) return { ok: false, reason: "changed" };
    if (hasPgCode(error, "23503")) return { ok: false, reason: "not_found" };
    throw error;
  }
  return { ok: true, number };
}

// 마지막 번호가 expectedNumber이고 reopened_at이 비었을 때만 채운다
export async function reopenSubmission(
  db: Db,
  userId: string,
  postingId: string,
  expectedNumber: number,
  now: Date,
): Promise<{ ok: true } | { ok: false; reason: "changed" }> {
  const latest = await latestSubmission(db, userId, postingId);
  if (!latest || latest.number !== expectedNumber) return { ok: false, reason: "changed" };
  const rows = await db
    .update(submissions)
    .set({ reopenedAt: now })
    .where(and(ofPosting(userId, postingId), eq(submissions.number, expectedNumber), isNull(submissions.reopenedAt)))
    .returning({ id: submissions.id });
  return rows.length > 0 ? { ok: true } : { ok: false, reason: "changed" };
}
