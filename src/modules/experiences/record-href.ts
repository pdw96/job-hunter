import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db/types";
import type { FactKind } from "./record-options";
import { activities, courses, credentials, education, gaps, jobs, projects, scenes } from "./schema";

// 원천 id(자소서 후보, 강조 고르기, 채점 근거) → 그 기록을 여는 새 기록 화면 주소.
// 사례는 /records/scenes/<id>, 이력 사실과 머리(경력·프로젝트·활동)는 /records/facts/<종류>/<id>.
// 표마다 한 번씩 고정된 수만큼 읽는다(줄마다 읽지 않음). 모르는 id(옛 기록, 지운 기록, 남의 것)는 담지 않는다

const FACT_TABLES = { education, course: courses, job: jobs, gap: gaps, credential: credentials, project: projects, activity: activities } satisfies Record<
  FactKind,
  unknown
>;

export async function recordHrefs(db: Db, userId: string, ids: Iterable<string>): Promise<Map<string, string>> {
  const wanted = [...new Set(ids)];
  const hrefs = new Map<string, string>();
  if (wanted.length === 0) return hrefs;

  const factLookups = (Object.entries(FACT_TABLES) as [FactKind, (typeof FACT_TABLES)[FactKind]][]).map(async ([kind, table]) => {
    const rows = await db
      .select({ id: table.id })
      .from(table)
      .where(and(eq(table.userId, userId), inArray(table.id, wanted)));
    for (const row of rows) hrefs.set(row.id, `/records/facts/${kind}/${row.id}`);
  });
  const sceneLookup = (async () => {
    const rows = await db
      .select({ id: scenes.id })
      .from(scenes)
      .where(and(eq(scenes.userId, userId), inArray(scenes.id, wanted)));
    for (const row of rows) hrefs.set(row.id, `/records/scenes/${row.id}`);
  })();
  await Promise.all([...factLookups, sceneLookup]);
  return hrefs;
}
