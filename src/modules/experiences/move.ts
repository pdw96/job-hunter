import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db/types";
import { type AiClient, type AiFailure, runAi } from "@/modules/ai/client";
import { type ClaimStatus, findClaims, type FoundClaim, mergeClaims, subjectOfScene } from "./claims";
import { listClaims } from "./claims-repo";
import { createFact, listFacts, setProjectParentIfUnset } from "./facts-repo";
import { applyDefaultRoles, classifyMoves } from "./move-classify";
import { claimNextMove, finishMove, hasSceneMoves, holdMove, type MoveProgress, moveProgress, type MoveRole, reopenAffiliate } from "./move-repo";
import { type Kind, LIMITS, type Scope } from "./options";
import { AFFILIATE_SYSTEM, describeExperience, MOVE_CLAIMS_SYSTEM } from "./prompts";
import { insertRecordClaims } from "./record-claims-repo";
import { type ImportPlan, requestRecordImport, saveImportPlan } from "./record-import";
import { type ActivityInput, type ProjectInput, type SceneInput, validateFact, validateScene } from "./record-input";
import type { HeadKind, ParentKind } from "./record-options";
import { type Experience, getExperience, getTrackScopes } from "./repo";
import { statuses, withStatuses } from "./rubric-store";
import { scenePeriodStatus } from "./scene-rules";
import { activities, courses, credentials, education, experiences, gaps, jobs, projects, scenes, type StoredRubric } from "./schema";
import { createScene } from "./scenes-repo";
import { rubricAfterContentEdit, verificationState } from "./verification";

// 옛 기록(experiences_experiences) 하나를 새 메뉴별 표로 옮긴다. 옛 표는 읽기만 한다.
// 프로젝트·기타는 코드가 머리와 장면 하나로, 공백은 코드가 공백 하나로 옮기고, 나머지 구분은 가져오기처럼 AI가 메뉴별로 나눈다.
// 정리(move-classify.ts)가 정한 역할이 있으면 따른다: 같은 기록은 옮기지 않고, 다른 머리의 사례는 그 머리 아래 장면 하나로 옮긴다.

// note: 옮겼지만 일부를 옮기지 못했거나 비운 것이 있을 때 화면에 보여 줄 글
type Result = { ok: true; note?: string } | { ok: false; error: string };

const NOTHING_FOUND = "나눌 내용을 찾지 못했습니다";
export const OVER_LIMIT_MESSAGE = "이번 달 AI 사용 한도에 닿았습니다. 다음 달에 다시 시도해 주세요";
const ERRORS: Record<string, string> = {
  over_limit: OVER_LIMIT_MESSAGE,
  refused: "AI가 이 기록을 처리하지 못했습니다",
  truncated: "AI의 답이 중간에 끊겼습니다. 다시 시도해 주세요",
  invalid: "AI의 답을 읽지 못했습니다. 다시 시도해 주세요",
  unavailable: "AI 서비스에 연결하지 못했습니다. 잠시 뒤 다시 시도해 주세요",
  nothing_found: NOTHING_FOUND,
};
const errorOf = (reason: string) => ERRORS[reason] ?? "옮기는 중에 문제가 생겼습니다. 다시 시도해 주세요";

// 나누는 구분이 적어도 하나는 내야 하는 메뉴(학력→학력, 교육→교육 과정, 자격→자격, 재직→경력)
const EXPECTED_MENU: Partial<Record<Kind, keyof ImportPlan>> = {
  school: "education",
  training: "courses",
  certificate: "credentials",
  job: "jobs",
};

const MOVED_TABLES = [education, courses, jobs, gaps, credentials, projects, activities, scenes] as const;

// 이미 그 옛 기록에서 옮겨 온 행이 있는가(두 번 옮기지 않는다)
async function alreadyMoved(db: Db, userId: string, oldId: string): Promise<boolean> {
  for (const table of MOVED_TABLES) {
    const rows = await db
      .select({ id: table.id })
      .from(table)
      .where(and(eq(table.userId, userId), eq(table.movedFrom, oldId)))
      .limit(1);
    if (rows.length > 0) return true;
  }
  return false;
}

// 옛 기록이 확인된 때. getExperience는 확인 여부만 돌려주므로 따로 읽는다(읽기만 한다)
async function oldConfirmedAt(db: Db, userId: string, oldId: string): Promise<Date | null> {
  const [row] = await db
    .select({ confirmedAt: experiences.confirmedAt })
    .from(experiences)
    .where(and(eq(experiences.id, oldId), eq(experiences.userId, userId)))
    .limit(1);
  return row?.confirmedAt ?? null;
}

// 같은 옛 기록을 저장하는 트랜잭션끼리 줄 세운다(멈춘 running을 다시 잡아 둘이 동시에 저장하는 경우). 잠근 뒤 moved_from을 다시 본다
async function lockOld(t: Db, userId: string, oldId: string): Promise<void> {
  await t.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`experiences_move:${userId}:${oldId}`}, 0))`);
}

// 저장 직전 확인(트랜잭션 안에서): 잡은 옮기기 행(guard)이 그 사이 다시 옮기기로 지워졌거나, 이미 옮겼으면 저장하지 않는다
async function staleOrMoved(t: Db, userId: string, oldId: string, guard: string | undefined): Promise<boolean> {
  await lockOld(t, userId, oldId);
  if (guard && !(await holdMove(t, userId, guard))) return true;
  return alreadyMoved(t, userId, oldId);
}

const firstError = (errors: Record<string, string>) => `옮길 수 없는 값이 있습니다: ${Object.values(errors)[0] ?? "알 수 없음"}`;

export const DUPLICATE_NOTE = "같은 기록이 있어 하나만 옮겼습니다";
export const CLASSIFY_FALLBACK_NOTE = "기록 정리를 하지 못해 하나씩 옮겼습니다";
// 정리가 한도 밖의 까닭으로 이만큼 실패하면 기본값으로 넘긴다(사용자가 /moving에 갇히지 않게)
const CLASSIFY_TRIES = 2;

type Period = { startMonth: string | null; endMonth: string | null; isOngoing: boolean };
// 장면 기록을 붙일, 머리 기록이 옮겨 만든 머리
type HeadTarget = { kind: HeadKind; id: string; period: Period };

// 그 옛 기록에서 옮겨 온 머리(경력·프로젝트·활동) 중 먼저 만든 것. 지워졌으면 null
async function movedHead(db: Db, userId: string, oldId: string): Promise<HeadTarget | null> {
  const tables = [
    ["job", jobs],
    ["project", projects],
    ["activity", activities],
  ] as const;
  for (const [kind, table] of tables) {
    const [row] = await db
      .select({ id: table.id, startMonth: table.startMonth, endMonth: table.endMonth, isOngoing: table.isOngoing })
      .from(table)
      .where(and(eq(table.userId, userId), eq(table.movedFrom, oldId)))
      .orderBy(asc(table.createdAt), asc(table.id))
      .limit(1);
    if (row) return { kind, id: row.id, period: { startMonth: row.startMonth, endMonth: row.endMonth, isOngoing: row.isOngoing } };
  }
  return null;
}

export async function moveRecord(
  db: Db,
  ai: AiClient,
  userId: string,
  oldId: string,
  now: Date = new Date(),
  // 정리가 정한 역할(없으면 구분별 기본 길)
  // guard: 잡은 옮기기 행의 id. 주면 저장 직전에 그 행이 아직 있는지 본다(다시 옮기기 뒤 늦은 답을 저장하지 않게)
  plan: { role: MoveRole | null; ref: string | null; guard?: string } = { role: null, ref: null },
): Promise<Result> {
  const guard = plan.guard;
  // 같은 기록: 남길 쪽이 옮기므로 아무것도 만들지 않는다
  if (plan.role === "duplicate") return { ok: true, note: DUPLICATE_NOTE };
  const old = await getExperience(db, userId, oldId);
  if (!old) return { ok: false, error: "예전 기록을 찾을 수 없습니다" };
  // 이미 옮겼으면 AI도 부르지 않는다. 저장 직전에 트랜잭션 안에서 한 번 더 본다
  if (await alreadyMoved(db, userId, oldId)) return { ok: true };
  const trackScopes = await getTrackScopes(db, userId, oldId);
  if (old.kind === "gap") return moveGap(db, userId, old, trackScopes, guard);
  if (old.kind === "project" || old.kind === "other") {
    // 다른 머리의 사례: 머리 기록이 옮겨 만든 머리 아래 장면 하나로. 그 머리가 그 사이 지워졌으면 자기 머리로 옮긴다
    const target = plan.role === "scene" && plan.ref !== null ? await movedHead(db, userId, plan.ref) : null;
    return moveNarrative(db, ai, userId, old, trackScopes, now, target, guard);
  }
  // 재직 머리에 사례 기록이 딸려 있으면 재직 글을 사례로 나누지 않고 경력 머리만 만든다(사례가 겹치지 않게)
  const headOnly = old.kind === "job" && (await hasSceneMoves(db, userId, oldId));
  return moveBySplitting(db, ai, userId, old, trackScopes, now, headOnly, guard);
}

// 공백: AI 없이 공백 하나로. 진행 중이면 끝 월을 비우고, 메모는 서술 칸 중 처음으로 글이 있는 것을 한 줄로 줄여 100자 안에 담는다
async function moveGap(db: Db, userId: string, old: Experience, trackScopes: Record<string, Scope>, guard?: string): Promise<Result> {
  const text = [old.actions, old.situation, old.result].map((value) => value?.replace(/\s+/g, " ").trim() ?? "").find((value) => value !== "") ?? null;
  const note = text !== null && text.length > LIMITS.shortText ? `${text.slice(0, LIMITS.shortText - 1)}…` : text;
  const gap = validateFact("gap", { startMonth: old.startMonth, endMonth: old.isOngoing ? null : old.endMonth, note });
  if (!gap.ok) return { ok: false, error: firstError(gap.errors) };
  return db.transaction(async (tx) => {
    const t = tx as unknown as Db;
    if (await staleOrMoved(t, userId, old.id, guard)) return { ok: true as const };
    await createFact(t, userId, "gap", gap.value, { source: "migrate", movedFrom: old.id, trackScopes });
    return { ok: true as const };
  });
}

// 프로젝트·기타: 머리(프로젝트 또는 활동) 하나와, 옛 서술을 글자 그대로 담은 장면 하나.
// target이 있으면(다른 머리의 사례) 머리를 만들지 않고 그 머리 아래 장면 하나만 만든다
async function moveNarrative(
  db: Db,
  ai: AiClient,
  userId: string,
  old: Experience,
  trackScopes: Record<string, Scope>,
  now: Date,
  target: HeadTarget | null = null,
  guard?: string,
): Promise<Result> {
  const ownKind = old.kind === "project" ? ("project" as const) : ("activity" as const);
  const headKind: HeadKind = target?.kind ?? ownKind;
  const headRaw: ProjectInput | ActivityInput =
    ownKind === "project"
      ? {
          name: old.name,
          parent: null, // 소속은 모두 옮긴 뒤 affiliateProjects가 잇는다
          startMonth: old.startMonth,
          endMonth: old.endMonth,
          isOngoing: old.isOngoing,
          role: old.role,
          tools: [],
          summary: null,
          bannedPhrases: [],
        }
      : {
          name: old.name,
          organization: old.organization,
          startMonth: old.startMonth,
          endMonth: old.endMonth,
          isOngoing: old.isOngoing,
          role: old.role,
        };
  // 사례로 붙일 때는 머리를 만들지 않으므로 머리 검사도 하지 않는다
  let headValue: ProjectInput | ActivityInput | null = null;
  if (!target) {
    const checked = validateFact(ownKind, headRaw);
    if (!checked.ok) return { ok: false, error: firstError(checked.errors) };
    headValue = checked.value;
  }
  const headPeriod: Period = target?.period ?? {
    startMonth: headValue?.startMonth ?? null,
    endMonth: headValue?.endMonth ?? null,
    isOngoing: headValue?.isOngoing ?? false,
  };

  // 자기 머리 아래면 장면의 기간은 비워 머리의 기간을 쓴다. 다른 머리의 사례면 옛 기록의 기간이 머리와 다를 때만 장면에 둔다.
  // 판단·배운 점은 옛 기록에 없던 칸이라 비운다
  const ownPeriod =
    target !== null &&
    old.startMonth !== null &&
    (old.startMonth !== headPeriod.startMonth || old.endMonth !== headPeriod.endMonth || old.isOngoing !== headPeriod.isOngoing);
  const scene = validateScene({
    head: { kind: headKind, id: "move" }, // 검사용. 저장할 때 실제 머리로 바꾼다
    title: old.name,
    startMonth: ownPeriod ? old.startMonth : null,
    endMonth: ownPeriod && !old.isOngoing ? old.endMonth : null,
    isOngoing: ownPeriod && old.isOngoing,
    situation: old.situation,
    judgment: null,
    actions: old.actions,
    result: old.result,
    lessons: null,
    metrics: old.metrics,
    notDone: old.notDone,
    bannedPhrases: old.bannedPhrases,
    evidenceNote: old.evidenceNote,
    tags: old.tags,
  } satisfies SceneInput);
  if (!scene.ok) return { ok: false, error: firstError(scene.errors as Record<string, string>) };

  // 옛 규칙으로 확인됨일 때만 확인을 넘긴다(부분 확인은 미확인으로 옮긴다)
  const confirmed = verificationState(old.kind, statuses(old.rubric), old.isConfirmed) === "confirmed";
  let carry: { rubric: StoredRubric; confirmedAt: Date | null };
  let confirmedAt: Date | undefined; // 확인됨이면 머리와 장면 모두 옛 기록이 확인된 때로
  let claims: (FoundClaim & { status?: ClaimStatus })[];
  if (confirmed) {
    confirmedAt = (await oldConfirmedAt(db, userId, old.id)) ?? now;
    carry = { rubric: old.rubric, confirmedAt };
    // 옛 주장을 답한 상태 그대로 옮긴다
    claims = (await listClaims(db, userId, old.id)).map(({ kind, quote, phrase, origin, status }) => ({ kind, quote, phrase, origin, status }));
  } else {
    // 미확인: 루브릭은 새로(닫아 둔 수치·증빙은 유지), 주장은 코드가 찾은 것과 AI가 짚은 역할 구절. 옛 주장 답은 옮기지 않는다
    const period = scenePeriodStatus(scene.value, headPeriod);
    carry = { rubric: withStatuses(rubricAfterContentEdit("project", statuses(old.rubric), period)), confirmedAt: null };
    const answer = await runAi(
      db,
      ai,
      userId,
      {
        purpose: "migrate",
        system: MOVE_CLAIMS_SYSTEM,
        messages: [{ role: "user", text: `[옮기기: 주장]\n\n${describeExperience(old)}` }],
        schema: z.object({ quotes: z.array(z.string()) }),
        effort: "low",
        maxTokens: 4000,
      },
      now,
    );
    if (!answer.ok) return { ok: false, error: errorOf(answer.reason) };
    const subject = subjectOfScene(scene.value);
    claims = mergeClaims(findClaims(subject), answer.value.quotes, subject);
  }

  const common = { source: "migrate" as const, movedFrom: old.id, trackScopes };
  return db.transaction(async (tx) => {
    const t = tx as unknown as Db;
    if (await staleOrMoved(t, userId, old.id, guard)) return { ok: true as const };
    let headId = target?.id;
    if (!headId) {
      const created =
        ownKind === "project"
          ? await createFact(t, userId, "project", headValue as ProjectInput, { ...common, confirmedAt })
          : await createFact(t, userId, "activity", headValue as ActivityInput, { ...common, confirmedAt });
      if (!created.ok) throw new Error("옮길 머리를 만들지 못했습니다");
      headId = created.id;
    }
    const saved = await createScene(t, userId, { ...scene.value, head: { kind: headKind, id: headId } }, { ...common, carry });
    if (!saved.ok) throw new Error("옮길 장면을 만들지 못했습니다");
    await insertRecordClaims(t, userId, { kind: "scene", id: saved.id }, claims);
    return { ok: true as const };
  });
}

// 학력·교육·자격·재직: 옛 기록을 글로 풀어 가져오기처럼 AI가 메뉴별로 나눈다. 모두 미확인으로 저장한다.
// headOnly(사례 기록이 딸린 재직)면 경력 머리(담당 업무 줄까지)만 만들고 장면·프로젝트·활동은 버린다
async function moveBySplitting(
  db: Db,
  ai: AiClient,
  userId: string,
  old: Experience,
  trackScopes: Record<string, Scope>,
  now: Date,
  headOnly = false,
  guard?: string,
): Promise<Result> {
  const prepared = await requestRecordImport(db, ai, userId, describeExperience(old), { purpose: "migrate", hint: old.kind, headOnly }, now);
  if (!prepared.ok) return { ok: false, error: errorOf(prepared.reason) };
  const menu = EXPECTED_MENU[old.kind];
  if (!menu || prepared.plan[menu].length === 0) return { ok: false, error: NOTHING_FOUND };
  const plan: ImportPlan = headOnly
    ? { ...prepared.plan, jobs: prepared.plan.jobs.map((job) => ({ ...job, scenes: [] })), projects: [], activities: [] }
    : prepared.plan;
  // 검사에서 빠지거나 비운 것이 있으면 통과한 것은 옮기고, 빠진 것을 알린다
  const notes = [
    prepared.skipped > 0 ? `${prepared.skipped}개는 검사를 통과하지 못해 옮기지 못했습니다` : null,
    prepared.inventedDropped > 0 ? "원본에 없던 숫자가 있어 일부 칸을 비웠습니다" : null,
    // 머리 하나의 사례가 한도(8개)를 넘었거나 AI가 다 담지 못했다고 한 경우. 머리만 만들 때는 일부러 버린 것이라 알리지 않는다
    prepared.more && !headOnly ? "내용이 많아 일부를 옮기지 못했습니다. 경험 사례에서 더 추가해 주세요" : null,
  ].filter((note): note is string => note !== null);

  return db.transaction(async (tx) => {
    const t = tx as unknown as Db;
    if (await staleOrMoved(t, userId, old.id, guard)) return { ok: true as const };
    // 금지 표현은 AI에 보내지 않았으므로 장면마다 옛 것을 그대로 붙인다(하지 않은 것은 장면에 없을 때만)
    await saveImportPlan(t, userId, plan, {
      source: "migrate",
      movedFrom: old.id,
      trackScopes,
      carry: { notDone: old.notDone, bannedPhrases: old.bannedPhrases },
    });
    return notes.length > 0 ? { ok: true as const, note: notes.join(" / ") } : { ok: true as const };
  });
}

// ---- 프로젝트 소속 잇기 ----

type Span = { startMonth: string | null; endMonth: string | null; isOngoing?: boolean };

// 프로젝트 기간이 조직의 기간 안에 있는가. 어느 한쪽에 시작 월이 없으면 알 수 없으므로 버린다.
// 조직이 재직·재학 중이거나 끝 월이 없으면 끝이 열린 것으로 본다
export function withinPeriod(project: Span, parent: Span): boolean {
  if (!project.startMonth || !parent.startMonth) return false;
  if (project.startMonth < parent.startMonth) return false;
  if (parent.isOngoing === true || parent.endMonth === null) return true;
  if (project.isOngoing === true) return false;
  return (project.endMonth ?? project.startMonth) <= parent.endMonth;
}

const periodText = (span: Span) =>
  span.startMonth ? `${span.startMonth} ~ ${span.isOngoing ? "진행 중" : (span.endMonth ?? "없음")}` : "없음";
const line = (alias: string, fields: [string, string | null][]) =>
  [alias, ...fields.map(([label, value]) => `${label}: ${value ?? "없음"}`)].join(" | ");

// 소속을 물을 때 보내는 것. 연락처는 없다
export type AffiliationInput = {
  projects: { name: string; organization: string | null; role: string | null; span: Span }[];
  jobs: { company: string; department: string | null; span: Span }[];
  schools: { schoolName: string; major: string | null; span: Span }[];
  courses: { name: string; institution: string | null; span: Span }[];
};
// project는 input.projects의 순서, parent.index는 그 종류 배열의 순서
export type AffiliationLink = { project: number; parent: { kind: ParentKind; index: number } };

const ALIAS_KINDS: Record<string, ParentKind> = { J: "job", S: "education", C: "course" };

// AI에게 프로젝트와 조직의 짝을 묻는다. 별명이 맞고 기간이 맞는 짝만, 프로젝트마다 첫 하나를 돌려준다
export async function requestAffiliation(
  db: Db,
  ai: AiClient,
  userId: string,
  input: AffiliationInput,
  now: Date = new Date(),
): Promise<{ ok: true; links: AffiliationLink[] } | { ok: false; reason: "over_limit" | AiFailure }> {
  const section = (title: string, lines: string[]) => `[${title}]\n${lines.length > 0 ? lines.join("\n") : "없음"}`;
  const text = [
    "[옮기기: 소속]",
    section(
      "프로젝트",
      input.projects.map((p, i) => line(`P${i + 1}`, [["이름", p.name], ["기관", p.organization], ["역할", p.role], ["기간", periodText(p.span)]])),
    ),
    section("경력", input.jobs.map((j, i) => line(`J${i + 1}`, [["이름", j.company], ["부서", j.department], ["기간", periodText(j.span)]]))),
    section("학교", input.schools.map((s, i) => line(`S${i + 1}`, [["이름", s.schoolName], ["전공", s.major], ["기간", periodText(s.span)]]))),
    section("교육 과정", input.courses.map((c, i) => line(`C${i + 1}`, [["이름", c.name], ["기관", c.institution], ["기간", periodText(c.span)]]))),
  ].join("\n\n");

  const answer = await runAi(
    db,
    ai,
    userId,
    {
      purpose: "migrate",
      system: AFFILIATE_SYSTEM,
      messages: [{ role: "user", text }],
      schema: z.object({ links: z.array(z.object({ project: z.string(), parent: z.string() })) }),
      effort: "low",
      maxTokens: 4000,
    },
    now,
  );
  if (!answer.ok) return { ok: false, reason: answer.reason };

  const spans: Record<ParentKind, Span[]> = {
    job: input.jobs.map((j) => j.span),
    education: input.schools.map((s) => s.span),
    course: input.courses.map((c) => c.span),
  };
  const links: AffiliationLink[] = [];
  for (const raw of answer.value.links) {
    const projectMatch = raw.project.trim().match(/^P(\d+)$/);
    const parentMatch = raw.parent.trim().match(/^([JSC])(\d+)$/);
    if (!projectMatch || !parentMatch) continue;
    const project = Number(projectMatch[1]) - 1;
    const kind = ALIAS_KINDS[parentMatch[1]];
    const index = Number(parentMatch[2]) - 1;
    const projectSpan = input.projects[project]?.span;
    const parentSpan = spans[kind][index];
    if (!projectSpan || !parentSpan || links.some((link) => link.project === project)) continue;
    // 프로젝트 기간이 조직의 기간 밖이면 버린다
    if (!withinPeriod(projectSpan, parentSpan)) continue;
    links.push({ project, parent: { kind, index } });
  }
  return { ok: true, links };
}

export async function affiliateProjects(db: Db, ai: AiClient, userId: string, now: Date = new Date(), guard?: string): Promise<Result> {
  const facts = await listFacts(db, userId);
  // 옮겨 온 개인 프로젝트만 보낸다(사용자가 직접 만들거나 소속을 정한 것은 건드리지 않는다)
  const moved = facts.project.filter((project) => project.source === "migrate" && project.movedFrom !== null && project.value.parent === null);
  if (moved.length === 0 || facts.job.length + facts.education.length + facts.course.length === 0) return { ok: true };

  const input: AffiliationInput = {
    projects: [],
    jobs: facts.job.map((job) => ({ company: job.value.company, department: job.value.department, span: job.value })),
    schools: facts.education.map((school) => ({ schoolName: school.value.schoolName, major: school.value.major, span: school.value })),
    courses: facts.course.map((course) => ({ name: course.value.name, institution: course.value.institution, span: course.value })),
  };
  for (const project of moved) {
    // 새 프로젝트에는 기관 칸이 없어, 예전 기록의 소속을 함께 보낸다
    const oldRecord = project.movedFrom ? await getExperience(db, userId, project.movedFrom) : null;
    input.projects.push({ name: project.value.name, organization: oldRecord?.organization ?? null, role: project.value.role, span: project.value });
  }

  const result = await requestAffiliation(db, ai, userId, input, now);
  if (!result.ok) return { ok: false, error: errorOf(result.reason) };
  if (result.links.length === 0) return { ok: true };

  const parentIds: Record<ParentKind, string[]> = {
    job: facts.job.map((f) => f.id),
    education: facts.education.map((f) => f.id),
    course: facts.course.map((f) => f.id),
  };
  await db.transaction(async (tx) => {
    const t = tx as unknown as Db;
    // 그 사이 다시 옮기기로 이 행이 지워졌으면 쓰지 않는다
    if (guard && !(await holdMove(t, userId, guard))) return;
    for (const link of result.links) {
      const project = moved[link.project];
      const parent = { kind: link.parent.kind, id: parentIds[link.parent.kind][link.parent.index] };
      // 소속 칸만, 아직 비어 있을 때만 쓴다. 묻는 사이 고친 내용이나 직접 고른 소속은 그대로 두고,
      // 그 사이 지워진 프로젝트·조직(not_found)은 건너뛴다. 소속은 내용 칸이 아니라 확인이 유지된다
      await setProjectParentIfUnset(t, userId, project.id, parent);
    }
  });
  return { ok: true };
}

// ---- 하나씩 돌리기 ----

// 정리 한 번. 한도 밖의 실패(예외 포함)가 두 번째면 모든 기록을 구분별 기본값으로 두고 정리를 끝낸다(사용자가 /moving에 갇히지 않게).
// 한도는 모두를 멈추는 기존 길로 간다(시도로 세지 않는다)
async function runClassify(db: Db, ai: AiClient, userId: string, attempts: number, now: Date, guard: string): Promise<Result> {
  let reason: string;
  try {
    const classified = await classifyMoves(db, ai, userId, now, guard);
    if (classified.ok) return { ok: true };
    reason = classified.reason;
  } catch (error) {
    console.error("기록 정리 실패", error);
    reason = "error";
  }
  if (reason === "over_limit") return { ok: false, error: OVER_LIMIT_MESSAGE };
  if (attempts + 1 >= CLASSIFY_TRIES) {
    await applyDefaultRoles(db, userId, guard);
    return { ok: true, note: CLASSIFY_FALLBACK_NOTE };
  }
  return { ok: false, error: errorOf(reason) };
}

const RELINK_KINDS: readonly Kind[] = ["project", "job", "school", "training"];

// 할 일 하나를 잡아 옮기고 진행을 돌려준다. 잡을 것이 없으면(모두 끝났거나 다른 탭이 돌리는 중) 진행만 돌려준다
export async function runNextMove(db: Db, ai: AiClient, userId: string, now: Date = new Date()): Promise<MoveProgress> {
  const claimed = await claimNextMove(db, userId, now);
  if (claimed) {
    let result: Result;
    let relink = false;
    try {
      if (claimed.step === "classify") {
        result = await runClassify(db, ai, userId, claimed.attempts, now, claimed.id);
      } else if (claimed.step === "record" && claimed.oldId !== null) {
        const kind = (await getExperience(db, userId, claimed.oldId))?.kind;
        result = await moveRecord(db, ai, userId, claimed.oldId, now, { role: claimed.role, ref: claimed.ref, guard: claimed.id });
        // 프로젝트나 조직이 될 기록이면, 소속 잇기가 이미 끝났어도 다시 돌게 한다(실패했다가 늦게 옮긴 경우).
        // 같은 기록은 새 머리를 만들지 않는다. 사례는 머리가 지워져 자기 프로젝트로 옮겨졌을 때만 다시 돈다
        if (result.ok && kind && RELINK_KINDS.includes(kind) && claimed.role !== "duplicate") {
          relink = claimed.role !== "scene" || (await movedHead(db, userId, claimed.oldId))?.kind === "project";
        }
      } else {
        result = await affiliateProjects(db, ai, userId, now, claimed.id);
      }
    } catch (error) {
      console.error("기록 옮기기 실패", error);
      result = { ok: false, error: "옮기는 중에 문제가 생겼습니다. 다시 시도해 주세요" };
    }
    // 한도로 멈춘 것은 AI를 부르지 않았으므로 시도로 세지 않는다(정리의 기본값 넘기기는 한도 밖의 실패만 센다)
    const limited = !result.ok && result.error === OVER_LIMIT_MESSAGE;
    await finishMove(db, userId, claimed.id, result, now, { countAttempt: !limited });
    if (result.ok && relink) await reopenAffiliate(db, userId, now);
  }
  return moveProgress(db, userId);
}
