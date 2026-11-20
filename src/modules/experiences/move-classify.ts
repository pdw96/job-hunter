import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db/types";
import { type AiClient, type AiFailure, runAi } from "@/modules/ai/client";
import { type MoveRole, setMoveRoles } from "./move-repo";
import { type Kind, KIND_LABELS } from "./options";
import { CLASSIFY_SYSTEM } from "./prompts";
import { experiences } from "./schema";

// 옮기기 전 정리. 옛 기록 전부를 한 번에 AI에 보내 기록마다 역할을 정한다:
// fact(이력 사실)·head(머리)·scene(다른 머리의 사례)·duplicate(같은 기록). AI의 답은 코드가 검사하고,
// 같은 기록 중 무엇을 남길지는 코드가 정한다(AI의 짝은 묶음만 알려 준다). 옛 표는 읽기만 한다.

// AI에 보내는 칸. 증빙 메모·연락처·id는 보내지 않는다
export type ClassifyRecord = {
  name: string;
  kind: Kind;
  organization: string | null;
  role: string | null;
  startMonth: string | null;
  endMonth: string | null;
  isOngoing: boolean;
  body: string; // 상황·한 일·결과를 이은 글(보낼 때 앞 300자만)
};
// ref는 같은 목록의 순서
export type RoleChoice = { role: MoveRole; ref: number | null };

const BODY_LIMIT = 300;
const FACT_KINDS: readonly Kind[] = ["school", "training", "certificate", "gap"];
const ALLOWED: Record<Kind, readonly MoveRole[]> = {
  school: ["fact", "duplicate"],
  training: ["fact", "duplicate"],
  certificate: ["fact", "duplicate"],
  gap: ["fact", "duplicate"],
  job: ["head", "duplicate"],
  project: ["head", "scene", "duplicate"],
  other: ["head", "scene", "duplicate"],
};

// 지금의 구분별 길: 학력·교육·자격·공백은 이력 사실, 재직·프로젝트·기타는 머리
export const defaultRole = (kind: Kind): MoveRole => (FACT_KINDS.includes(kind) ? "fact" : "head");

const squash = (text: string) => text.replace(/\s+/g, " ").trim();

function lineOf(record: ClassifyRecord, index: number): string {
  const period =
    record.kind === "certificate"
      ? (record.startMonth ?? "없음")
      : record.startMonth
        ? `${record.startMonth} ~ ${record.isOngoing ? "진행 중" : (record.endMonth ?? "없음")}`
        : "없음";
  const body = squash(record.body).slice(0, BODY_LIMIT);
  const fields: [string, string | null][] = [
    ["이름", squash(record.name)],
    ["구분", KIND_LABELS[record.kind]],
    ["소속", record.organization],
    ["역할", record.role],
    ["기간", period],
    ["본문", body === "" ? null : body],
  ];
  return [`R${index + 1}`, ...fields.map(([label, value]) => `${label}: ${value ?? "없음"}`)].join(" | ");
}

const answerSchema = z.object({
  records: z.array(z.object({ record: z.string(), role: z.enum(["fact", "head", "scene", "duplicate"]), ref: z.string().nullable() })),
});

const aliasIndex = (alias: string | null, size: number): number | null => {
  const match = alias?.trim().match(/^R(\d+)$/);
  if (!match) return null;
  const index = Number(match[1]) - 1;
  return index >= 0 && index < size ? index : null;
};

// AI에게 기록마다 역할을 묻고 검사한다. 어긋난 기록만 기본값으로 둔다
export async function requestClassify(
  db: Db,
  ai: AiClient,
  userId: string,
  records: ClassifyRecord[],
  now: Date = new Date(),
): Promise<{ ok: true; roles: RoleChoice[] } | { ok: false; reason: "over_limit" | AiFailure }> {
  const text = ["[옮기기: 정리]", `[기록]\n${records.map(lineOf).join("\n")}`].join("\n\n");
  const answer = await runAi(
    db,
    ai,
    userId,
    {
      purpose: "migrate",
      system: CLASSIFY_SYSTEM,
      messages: [{ role: "user", text }],
      schema: answerSchema,
      effort: "medium",
      maxTokens: 16000, // 스트리밍 없이 보낼 수 있는 길이. 더 크게 잡으면 SDK가 보내기 전에 거절한다
    },
    now,
  );
  if (!answer.ok) return { ok: false, reason: answer.reason };

  const size = records.length;
  const fallback = (index: number): RoleChoice => ({ role: defaultRole(records[index].kind), ref: null });
  // 모든 별명이 정확히 한 번: 두 번 나온 별명은 모두 버린다
  const seen = new Map<number, number>();
  for (const item of answer.value.records) {
    const index = aliasIndex(item.record, size);
    if (index !== null) seen.set(index, (seen.get(index) ?? 0) + 1);
  }
  const picked: (RoleChoice & { rawRef: number | null })[] = records.map((_, index) => ({ ...fallback(index), rawRef: null }));
  for (const item of answer.value.records) {
    const index = aliasIndex(item.record, size);
    if (index === null || seen.get(index) !== 1) continue;
    // 구분에 맞지 않는 역할이면 기본값
    if (!ALLOWED[records[index].kind].includes(item.role)) continue;
    picked[index] = { role: item.role, ref: null, rawRef: aliasIndex(item.ref, size) };
  }

  // duplicate: 짝이 자기 아닌 같은 구분이고, 짝의 역할이 duplicate가 아니어야 한다(AI가 답한 역할로 본다)
  const afterDuplicates: RoleChoice[] = picked.map((item, index) => {
    if (item.role === "scene") return { role: "scene", ref: item.rawRef };
    if (item.role !== "duplicate") return { role: item.role, ref: null };
    const ref = item.rawRef;
    const valid = ref !== null && ref !== index && records[ref].kind === records[index].kind && picked[ref].role !== "duplicate";
    return valid ? { role: "duplicate", ref } : fallback(index);
  });
  // scene: 머리가 자기 아니고 역할이 head여야 한다
  const roles = afterDuplicates.map((item, index): RoleChoice => {
    if (item.role !== "scene") return item;
    const ref = item.ref;
    const valid = ref !== null && ref !== index && afterDuplicates[ref].role === "head";
    return valid ? item : fallback(index);
  });
  return { ok: true, roles };
}

// 같은 기록 중 남길 것을 고르는 데 쓰는 것
export type KeepInfo = { confirmed: boolean; length: number; createdAt: Date };

// 같은 기록 묶음(짝 + 그것을 가리키는 duplicate)마다 확인된 것 → 본문이 긴 것 → 먼저 만든 것을 남긴다.
// 남는 것이 짝의 역할을 이어받고, 나머지는 남는 것을 가리키는 duplicate가 된다. 짝을 머리로 삼던 장면은 남는 것을 머리로 삼는다
export function settleRoles(records: KeepInfo[], roles: RoleChoice[]): RoleChoice[] {
  const better = (a: number, b: number) => {
    const x = records[a];
    const y = records[b];
    if (x.confirmed !== y.confirmed) return x.confirmed ? a : b;
    if (x.length !== y.length) return x.length > y.length ? a : b;
    if (x.createdAt.getTime() !== y.createdAt.getTime()) return x.createdAt < y.createdAt ? a : b;
    return a < b ? a : b;
  };
  const groups = new Map<number, number[]>(); // 짝 → 묶음
  roles.forEach((item, index) => {
    if (item.role !== "duplicate" || item.ref === null) return;
    groups.set(item.ref, [...(groups.get(item.ref) ?? [item.ref]), index]);
  });
  const keeperOf = new Map<number, number>();
  const result = roles.map((item) => ({ ...item }));
  for (const [target, members] of groups) {
    const keeper = members.reduce(better);
    for (const member of members) keeperOf.set(member, keeper);
    result[keeper] = { ...roles[target] };
    for (const member of members) if (member !== keeper) result[member] = { role: "duplicate", ref: keeper };
  }
  // 장면의 머리는 그 머리 묶음에서 남는 것으로
  return result.map((item) => (item.role === "scene" && item.ref !== null ? { role: "scene", ref: keeperOf.get(item.ref) ?? item.ref } : item));
}

const proseLength = (row: { situation: string | null; actions: string | null; result: string | null }) =>
  (row.situation ?? "").length + (row.actions ?? "").length + (row.result ?? "").length;

// 정리를 할 수 없을 때(거듭 실패): 모든 기록을 구분별 기본값으로 둔다. 같은 기록·사례는 묶지 않는다
export async function applyDefaultRoles(db: Db, userId: string): Promise<void> {
  const rows = await db.select({ id: experiences.id, kind: experiences.kind }).from(experiences).where(eq(experiences.userId, userId));
  await setMoveRoles(
    db,
    userId,
    rows.map((row) => ({ oldId: row.id, role: defaultRole(row.kind), ref: null })),
  );
}

// 정리 한 번: 옛 기록을 읽어 묻고, 정한 역할을 기록 행에 적는다
export async function classifyMoves(
  db: Db,
  ai: AiClient,
  userId: string,
  now: Date = new Date(),
): Promise<{ ok: true } | { ok: false; reason: "over_limit" | AiFailure }> {
  const rows = await db
    .select()
    .from(experiences)
    .where(eq(experiences.userId, userId))
    .orderBy(asc(experiences.createdAt), asc(experiences.id));
  if (rows.length < 2) return { ok: true };
  const records: ClassifyRecord[] = rows.map((row) => ({
    name: row.name,
    kind: row.kind,
    organization: row.organization,
    role: row.role,
    startMonth: row.startMonth,
    endMonth: row.endMonth,
    isOngoing: row.isOngoing,
    body: [row.situation, row.actions, row.result].filter((text): text is string => !!text).join(" "),
  }));
  const asked = await requestClassify(db, ai, userId, records, now);
  if (!asked.ok) return asked;
  const settled = settleRoles(
    rows.map((row) => ({ confirmed: row.confirmedAt !== null, length: proseLength(row), createdAt: row.createdAt })),
    asked.roles,
  );
  await setMoveRoles(
    db,
    userId,
    settled.map((item, index) => ({ oldId: rows[index].id, role: item.role, ref: item.ref === null ? null : rows[item.ref].id })),
  );
  return { ok: true };
}
