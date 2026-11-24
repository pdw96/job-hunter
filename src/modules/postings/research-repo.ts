import { randomUUID } from "node:crypto";
import { and, eq, lte, ne, or } from "drizzle-orm";
import type { Db } from "@/db/types";
import { RESEARCH_LIMITS } from "./options";
import type { NewsItem, ResearchFailure, Talent } from "./research";
import { researches } from "./schema";

export type Research = typeof researches.$inferSelect;

const mine = (userId: string, key: string) => and(eq(researches.userId, userId), eq(researches.companyKey, key));

export async function getResearch(db: Db, userId: string, key: string): Promise<Research | null> {
  const [row] = await db.select().from(researches).where(mine(userId, key));
  return row ?? null;
}

// 조사를 잡는다. 잡으면 잡은 startedAt, 못 잡으면 null.
// onlyIfMissing이면 줄이 없을 때만(자동 조사), 아니면 running이 아니거나 runningMinutes가 지났을 때(다시 조사).
// 지난 결과는 그대로 두고 status만 running으로 바꾼다. 줄 하나를 한 문장으로 잡으므로 따로 잠그지 않는다
export async function claimResearch(
  db: Db,
  userId: string,
  key: string,
  company: string,
  now: Date,
  opts: { onlyIfMissing: boolean },
): Promise<Date | null> {
  const insert = db.insert(researches).values({
    id: randomUUID(),
    userId,
    companyKey: key,
    company,
    status: "running",
    startedAt: now,
    updatedAt: now,
  });
  const rows = opts.onlyIfMissing
    ? await insert.onConflictDoNothing().returning({ startedAt: researches.startedAt })
    : await insert
        .onConflictDoUpdate({
          target: [researches.userId, researches.companyKey],
          set: { company, status: "running", failure: null, startedAt: now, updatedAt: now },
          setWhere: or(
            ne(researches.status, "running"),
            lte(researches.startedAt, new Date(now.getTime() - RESEARCH_LIMITS.runningMinutes * 60_000)),
          ),
        })
        .returning({ startedAt: researches.startedAt });
  return rows[0]?.startedAt ?? null;
}

// 잡은 startedAt이 그대로일 때만 결과를 저장한다. 지난 결과는 이때 바뀐다
export async function finishResearch(
  db: Db,
  userId: string,
  key: string,
  startedAt: Date,
  result: { talent: Talent | null; talentSkipped: boolean; news: NewsItem[] },
  now: Date,
): Promise<boolean> {
  const rows = await db
    .update(researches)
    .set({
      status: "done",
      failure: null,
      researchedAt: now,
      talent: result.talent,
      talentSkipped: result.talentSkipped,
      news: result.news,
      updatedAt: now,
    })
    .where(and(mine(userId, key), eq(researches.startedAt, startedAt)))
    .returning({ id: researches.id });
  return rows.length > 0;
}

// 실패해도 지난 결과는 두고 status와 failure만 바꾼다
export async function failResearch(
  db: Db,
  userId: string,
  key: string,
  startedAt: Date,
  failure: ResearchFailure,
  now: Date,
): Promise<boolean> {
  const rows = await db
    .update(researches)
    .set({ status: "failed", failure, updatedAt: now })
    .where(and(mine(userId, key), eq(researches.startedAt, startedAt)))
    .returning({ id: researches.id });
  return rows.length > 0;
}

type PickResult = { ok: true } | { ok: false; reason: "not_found" | "running" };

// 조사 결과의 한 칸을 고친다. 줄을 잠그고 읽어서 고치므로 동시에 다른 칸을 눌러도 서로 덮어쓰지 않는다
function editResult(
  db: Db,
  userId: string,
  key: string,
  change: (row: Research) => Partial<Pick<Research, "talent" | "news">> | null,
): Promise<PickResult> {
  return db.transaction(async (tx): Promise<PickResult> => {
    const [row] = await tx.select().from(researches).where(mine(userId, key)).for("update");
    if (!row) return { ok: false, reason: "not_found" };
    if (row.status === "running") return { ok: false, reason: "running" };
    const set = change(row);
    if (!set) return { ok: false, reason: "not_found" };
    await tx
      .update(researches)
      .set({ ...set, updatedAt: new Date() })
      .where(and(mine(userId, key), eq(researches.id, row.id)));
    return { ok: true };
  });
}

export function setTalentVerdict(
  db: Db,
  userId: string,
  key: string,
  talentId: string,
  verdict: "yes" | "no" | null,
): Promise<PickResult> {
  return editResult(db, userId, key, (row) =>
    row.talent?.id === talentId ? { talent: { ...row.talent, verdict } } : null,
  );
}

export function setNewsChecked(
  db: Db,
  userId: string,
  key: string,
  newsId: string,
  checked: boolean,
): Promise<PickResult> {
  return editResult(db, userId, key, (row) =>
    row.news.some((n) => n.id === newsId)
      ? { news: row.news.map((n) => (n.id === newsId ? { ...n, checked } : n)) }
      : null,
  );
}
