import { randomUUID } from "node:crypto";
import { and, eq, gte, sum } from "drizzle-orm";
import type { Db } from "@/db/types";
import { costMicroUsd, type TokenUsage } from "./pricing";
import { aiUsage } from "./schema";

const DEFAULT_MONTHLY_LIMIT_USD = 5;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

// 1인당 월 한도(마이크로달러). 환경 변수 AI_MONTHLY_LIMIT_USD로 바꾼다
export function monthlyLimitMicroUsd(): number {
  const configured = Number(process.env.AI_MONTHLY_LIMIT_USD);
  const usd = Number.isFinite(configured) && configured >= 0 && process.env.AI_MONTHLY_LIMIT_USD ? configured : DEFAULT_MONTHLY_LIMIT_USD;
  return Math.round(usd * 1_000_000);
}

// 한국 시간으로 그 달 1일 0시
export function monthStart(now: Date): Date {
  const kst = new Date(now.getTime() + KST_OFFSET_MS);
  return new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), 1) - KST_OFFSET_MS);
}

export async function recordUsage(
  db: Db,
  userId: string,
  entry: { purpose: string; model: string; usage: TokenUsage; at: Date },
): Promise<void> {
  await db.insert(aiUsage).values({
    id: randomUUID(),
    userId,
    purpose: entry.purpose,
    model: entry.model,
    ...entry.usage,
    costMicroUsd: costMicroUsd(entry.model, entry.usage),
    createdAt: entry.at,
  });
}

export async function monthlyCostMicroUsd(db: Db, userId: string, now: Date): Promise<number> {
  const [row] = await db
    .select({ total: sum(aiUsage.costMicroUsd) })
    .from(aiUsage)
    .where(and(eq(aiUsage.userId, userId), gte(aiUsage.createdAt, monthStart(now))));
  return Number(row.total ?? 0);
}

export async function checkBudget(
  db: Db,
  userId: string,
  now: Date,
): Promise<{ ok: true } | { ok: false; reason: "over_limit" }> {
  return (await monthlyCostMicroUsd(db, userId, now)) >= monthlyLimitMicroUsd()
    ? { ok: false, reason: "over_limit" }
    : { ok: true };
}
