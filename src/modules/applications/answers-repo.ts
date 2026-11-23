import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, isNull, notInArray, or } from "drizzle-orm";
import type { Db } from "@/db/types";
import type { AnswerTopic } from "./options";
import { answers } from "./schema";

// 지원자의 답(묻기)의 저장과 조회. 답은 고치지 않는다. 모든 함수가 userId로 소유자를 확인한다.

export type Answer = {
  id: string;
  topic: AnswerTopic;
  question: string;
  answer: string;
  postingId: string | null;
  company: string;
  companyKey: string | null;
  createdAt: Date;
};

function toAnswer(row: typeof answers.$inferSelect): Answer {
  const { userId: owner, ...rest } = row;
  void owner;
  return rest;
}

export async function createAnswer(db: Db, userId: string, input: Omit<Answer, "id" | "createdAt">, now: Date = new Date()): Promise<string> {
  const id = randomUUID();
  await db.insert(answers).values({ id, userId, ...input, createdAt: now });
  return id;
}

// ids 순서대로. 없거나 남의 id는 빠진다
export async function listAnswersByIds(db: Db, userId: string, ids: string[]): Promise<Answer[]> {
  if (ids.length === 0) return [];
  const rows = await db
    .select()
    .from(answers)
    .where(and(eq(answers.userId, userId), inArray(answers.id, ids)));
  const byId = new Map(rows.map((row) => [row.id, toAnswer(row)]));
  return ids.flatMap((id) => byId.get(id) ?? []);
}

// 다시 쓸 수 있는 지난 답. 주제마다 최근 perTopic개(같은 글은 한 번).
// companyKey가 있는 답(지원동기·입사 후 포부)은 같은 companyKey일 때만. exceptIds(이미 붙인 답)는 뺀다
export async function listReusable(
  db: Db,
  userId: string,
  topics: AnswerTopic[],
  companyKey: string,
  exceptIds: string[],
  perTopic = 2,
): Promise<Map<AnswerTopic, Answer[]>> {
  const result = new Map<AnswerTopic, Answer[]>();
  if (topics.length === 0) return result;
  const rows = await db
    .select()
    .from(answers)
    .where(
      and(
        eq(answers.userId, userId),
        inArray(answers.topic, topics),
        or(isNull(answers.companyKey), eq(answers.companyKey, companyKey)),
        exceptIds.length > 0 ? notInArray(answers.id, exceptIds) : undefined,
      ),
    )
    .orderBy(desc(answers.createdAt), desc(answers.id));
  for (const row of rows) {
    const list = result.get(row.topic) ?? [];
    if (list.length >= perTopic || list.some((kept) => kept.answer === row.answer)) continue;
    list.push(toAnswer(row));
    result.set(row.topic, list);
  }
  return result;
}

// 붙일 수 있는 답인지: 주제가 맞고, 회사에 묶인 답이면 같은 회사다(listReusable과 같은 규칙)
export const reusableFor = (answer: Answer, topic: AnswerTopic, companyKey: string): boolean =>
  answer.topic === topic && (answer.companyKey === null || answer.companyKey === companyKey);
