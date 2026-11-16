import { and, asc, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import type { Db } from "@/db/types";
import { ncsAliases, ncsCategories } from "./schema";

// 기준 데이터라 모든 사용자가 같은 것을 본다. 그래서 userId 인자가 없다.

export type NcsNode = { code: string; level: number; name: string };
export type NcsJob = { code: string; name: string; path: [NcsNode, NcsNode, NcsNode] };

const node = { code: ncsCategories.code, level: ncsCategories.level, name: ncsCategories.name };

export async function listMajors(db: Db): Promise<NcsNode[]> {
  return db.select(node).from(ncsCategories).where(isNull(ncsCategories.parentCode)).orderBy(asc(ncsCategories.code));
}

export async function listChildren(db: Db, parentCode: string): Promise<NcsNode[]> {
  return db
    .select(node)
    .from(ncsCategories)
    .where(eq(ncsCategories.parentCode, parentCode))
    .orderBy(asc(ncsCategories.code));
}

// 중분류 아래의 직무(세분류)를 소분류별로 묶는다
export async function listJobsUnder(db: Db, middleCode: string): Promise<{ group: NcsNode; jobs: NcsNode[] }[]> {
  const groups = await listChildren(db, middleCode);
  if (groups.length === 0) return [];
  const jobs = await db
    .select({ ...node, parentCode: ncsCategories.parentCode })
    .from(ncsCategories)
    .where(
      inArray(
        ncsCategories.parentCode,
        groups.map((g) => g.code),
      ),
    )
    .orderBy(asc(ncsCategories.code));
  return groups.map((group) => ({
    group,
    jobs: jobs.filter((j) => j.parentCode === group.code).map(({ code, level, name }) => ({ code, level, name })),
  }));
}

async function withPaths(db: Db, jobs: { code: string; name: string }[]): Promise<NcsJob[]> {
  if (jobs.length === 0) return [];
  const ancestorCodes = [...new Set(jobs.flatMap((j) => [j.code.slice(0, 2), j.code.slice(0, 4), j.code.slice(0, 6)]))];
  const ancestors = await db.select(node).from(ncsCategories).where(inArray(ncsCategories.code, ancestorCodes));
  const byCode = new Map(ancestors.map((a) => [a.code, a]));
  return jobs.map((j) => ({
    code: j.code,
    name: j.name,
    path: [byCode.get(j.code.slice(0, 2))!, byCode.get(j.code.slice(0, 4))!, byCode.get(j.code.slice(0, 6))!],
  }));
}

// 세분류로 존재하는 코드만 돌려준다. 순서는 넘겨받은 codes의 순서
export async function getJobs(db: Db, codes: string[]): Promise<NcsJob[]> {
  if (codes.length === 0) return [];
  const rows = await db
    .select({ code: ncsCategories.code, name: ncsCategories.name })
    .from(ncsCategories)
    .where(and(inArray(ncsCategories.code, codes), eq(ncsCategories.level, 4)));
  const byCode = new Map(rows.map((r) => [r.code, r]));
  const ordered = [...new Set(codes)].flatMap((code) => byCode.get(code) ?? []);
  return withPaths(db, ordered);
}

// 검색어 안의 %, _, \ 를 글자 그대로 찾도록 바꾼다
function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

export async function searchJobs(db: Db, query: string, limit = 20): Promise<NcsJob[]> {
  const q = query.trim();
  // 글자나 숫자가 2개 이상 있어야 찾는다
  if ((q.match(/[\p{L}\p{N}]/gu) ?? []).length < 2) return [];
  const like = escapeLike(q);

  // 순위: 0 별칭이 정확히 일치, 1 이름이 검색어로 시작, 2 이름에 포함, 3 별칭이 검색어로 시작
  const rank = sql<number>`min(case
    when lower(${ncsAliases.alias}) = lower(${q}) then 0
    when ${ncsCategories.name} ilike ${`${like}%`} then 1
    when ${ncsCategories.name} ilike ${`%${like}%`} then 2
    else 3 end)`;

  const rows = await db
    .select({ code: ncsCategories.code, name: ncsCategories.name, rank })
    .from(ncsCategories)
    .leftJoin(ncsAliases, eq(ncsAliases.code, ncsCategories.code))
    .where(
      and(
        eq(ncsCategories.level, 4),
        or(ilike(ncsCategories.name, `%${like}%`), ilike(ncsAliases.alias, `${like}%`)),
      ),
    )
    .groupBy(ncsCategories.code, ncsCategories.name)
    .orderBy(rank, asc(ncsCategories.code))
    .limit(limit);

  return withPaths(db, rows);
}

// 대분류로 존재하는 코드인지
export async function isMajor(db: Db, code: string): Promise<boolean> {
  const rows = await db
    .select({ code: ncsCategories.code })
    .from(ncsCategories)
    .where(and(eq(ncsCategories.code, code), eq(ncsCategories.level, 1)))
    .limit(1);
  return rows.length > 0;
}
