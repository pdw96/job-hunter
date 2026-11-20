import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db/types";
import { type AiClient, type AiFailure, runAi } from "@/modules/ai/client";
import { type ClaimStatus, findClaims, type FoundClaim, mergeClaims, subjectOfScene } from "./claims";
import { listClaims } from "./claims-repo";
import { createFact, listFacts, updateFact } from "./facts-repo";
import { claimNextMove, finishMove, type MoveProgress, moveProgress } from "./move-repo";
import type { Kind, Scope } from "./options";
import { AFFILIATE_SYSTEM, describeExperience, MOVE_CLAIMS_SYSTEM } from "./prompts";
import { insertRecordClaims } from "./record-claims-repo";
import { type ImportPlan, requestRecordImport, saveImportPlan } from "./record-import";
import { type ActivityInput, type ProjectInput, type SceneInput, validateFact, validateScene } from "./record-input";
import type { ParentKind } from "./record-options";
import { type Experience, getExperience, getTrackScopes } from "./repo";
import { statuses, withStatuses } from "./rubric-store";
import { scenePeriodStatus } from "./scene-rules";
import { activities, courses, credentials, education, experiences, gaps, jobs, projects, scenes, type StoredRubric } from "./schema";
import { createScene } from "./scenes-repo";
import { rubricAfterContentEdit, verificationState } from "./verification";

// 옛 기록(experiences_experiences) 하나를 새 메뉴별 표로 옮긴다. 옛 표는 읽기만 한다.
// 프로젝트·기타는 코드가 머리와 장면 하나로 옮기고, 나머지 구분은 가져오기처럼 AI가 메뉴별로 나눈다.

type Result = { ok: true } | { ok: false; error: string };

const NOTHING_FOUND = "나눌 내용을 찾지 못했습니다";
const ERRORS: Record<string, string> = {
  over_limit: "이번 달 AI 사용 한도에 닿았습니다. 다음 달에 다시 시도해 주세요",
  refused: "AI가 이 기록을 처리하지 못했습니다",
  truncated: "AI의 답이 중간에 끊겼습니다. 다시 시도해 주세요",
  invalid: "AI의 답을 읽지 못했습니다. 다시 시도해 주세요",
  unavailable: "AI 서비스에 연결하지 못했습니다. 잠시 뒤 다시 시도해 주세요",
  nothing_found: NOTHING_FOUND,
};
const errorOf = (reason: string) => ERRORS[reason] ?? "옮기는 중에 문제가 생겼습니다. 다시 시도해 주세요";

// 나누는 구분이 적어도 하나는 내야 하는 메뉴(학력→학력, 교육→교육 과정, 자격→자격, 공백→공백, 재직→경력)
const EXPECTED_MENU: Partial<Record<Kind, keyof ImportPlan>> = {
  school: "education",
  training: "courses",
  certificate: "credentials",
  gap: "gaps",
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

const firstError = (errors: Record<string, string>) => `옮길 수 없는 값이 있습니다: ${Object.values(errors)[0] ?? "알 수 없음"}`;

export async function moveRecord(db: Db, ai: AiClient, userId: string, oldId: string, now: Date = new Date()): Promise<Result> {
  const old = await getExperience(db, userId, oldId);
  if (!old) return { ok: false, error: "예전 기록을 찾을 수 없습니다" };
  // 이미 옮겼으면 AI도 부르지 않는다. 저장 직전에 트랜잭션 안에서 한 번 더 본다
  if (await alreadyMoved(db, userId, oldId)) return { ok: true };
  const trackScopes = await getTrackScopes(db, userId, oldId);
  return old.kind === "project" || old.kind === "other"
    ? moveNarrative(db, ai, userId, old, trackScopes, now)
    : moveBySplitting(db, ai, userId, old, trackScopes, now);
}

// 프로젝트·기타: 머리(프로젝트 또는 활동) 하나와, 옛 서술을 글자 그대로 담은 장면 하나
async function moveNarrative(
  db: Db,
  ai: AiClient,
  userId: string,
  old: Experience,
  trackScopes: Record<string, Scope>,
  now: Date,
): Promise<Result> {
  const headKind = old.kind === "project" ? ("project" as const) : ("activity" as const);
  const headRaw: ProjectInput | ActivityInput =
    headKind === "project"
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
  const head = validateFact(headKind, headRaw);
  if (!head.ok) return { ok: false, error: firstError(head.errors) };

  // 장면의 기간은 비워 머리의 기간을 쓴다. 판단·배운 점은 옛 기록에 없던 칸이라 비운다
  const scene = validateScene({
    head: { kind: headKind, id: "move" }, // 검사용. 저장할 때 실제 머리로 바꾼다
    title: old.name,
    startMonth: null,
    endMonth: null,
    isOngoing: false,
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
  let claims: (FoundClaim & { status?: ClaimStatus })[];
  if (confirmed) {
    carry = { rubric: old.rubric, confirmedAt: (await oldConfirmedAt(db, userId, old.id)) ?? now };
    // 옛 주장을 답한 상태 그대로 옮긴다
    claims = (await listClaims(db, userId, old.id)).map(({ kind, quote, phrase, origin, status }) => ({ kind, quote, phrase, origin, status }));
  } else {
    // 미확인: 루브릭은 새로(닫아 둔 수치·증빙은 유지), 주장은 코드가 찾은 것과 AI가 짚은 역할 구절. 옛 주장 답은 옮기지 않는다
    const headPeriod = { startMonth: head.value.startMonth, endMonth: head.value.endMonth, isOngoing: head.value.isOngoing };
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
    if (await alreadyMoved(t, userId, old.id)) return { ok: true as const };
    const created =
      headKind === "project"
        ? await createFact(t, userId, "project", head.value as ProjectInput, { ...common, confirmed })
        : await createFact(t, userId, "activity", head.value as ActivityInput, { ...common, confirmed });
    if (!created.ok) throw new Error("옮길 머리를 만들지 못했습니다");
    const saved = await createScene(t, userId, { ...scene.value, head: { kind: headKind, id: created.id } }, { ...common, carry });
    if (!saved.ok) throw new Error("옮길 장면을 만들지 못했습니다");
    await insertRecordClaims(t, userId, { kind: "scene", id: saved.id }, claims);
    return { ok: true as const };
  });
}

// 학력·교육·자격·공백·재직: 옛 기록을 글로 풀어 가져오기처럼 AI가 메뉴별로 나눈다. 모두 미확인으로 저장한다
async function moveBySplitting(
  db: Db,
  ai: AiClient,
  userId: string,
  old: Experience,
  trackScopes: Record<string, Scope>,
  now: Date,
): Promise<Result> {
  const prepared = await requestRecordImport(db, ai, userId, describeExperience(old), { purpose: "migrate", hint: old.kind }, now);
  if (!prepared.ok) return { ok: false, error: errorOf(prepared.reason) };
  const menu = EXPECTED_MENU[old.kind];
  if (!menu || prepared.plan[menu].length === 0) return { ok: false, error: NOTHING_FOUND };

  return db.transaction(async (tx) => {
    const t = tx as unknown as Db;
    if (await alreadyMoved(t, userId, old.id)) return { ok: true as const };
    // 금지 표현은 AI에 보내지 않았으므로 장면마다 옛 것을 그대로 붙인다(하지 않은 것은 장면에 없을 때만)
    await saveImportPlan(t, userId, prepared.plan, {
      source: "migrate",
      movedFrom: old.id,
      trackScopes,
      carry: { notDone: old.notDone, bannedPhrases: old.bannedPhrases },
    });
    return { ok: true as const };
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

export async function affiliateProjects(db: Db, ai: AiClient, userId: string, now: Date = new Date()): Promise<Result> {
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
    for (const link of result.links) {
      const project = moved[link.project];
      const parent = { kind: link.parent.kind, id: parentIds[link.parent.kind][link.parent.index] };
      // 소속은 내용 칸이 아니라 확인이 유지된다
      const updated = await updateFact(t, userId, "project", project.id, { ...project.value, parent });
      if (!updated.ok) throw new Error("프로젝트의 소속을 쓰지 못했습니다");
    }
  });
  return { ok: true };
}

// ---- 하나씩 돌리기 ----

// 할 일 하나를 잡아 옮기고 진행을 돌려준다. 잡을 것이 없으면(모두 끝났거나 다른 탭이 돌리는 중) 진행만 돌려준다
export async function runNextMove(db: Db, ai: AiClient, userId: string, now: Date = new Date()): Promise<MoveProgress> {
  const claimed = await claimNextMove(db, userId, now);
  if (claimed) {
    let result: Result;
    try {
      result =
        claimed.step === "record" && claimed.oldId !== null
          ? await moveRecord(db, ai, userId, claimed.oldId, now)
          : await affiliateProjects(db, ai, userId, now);
    } catch (error) {
      console.error("기록 옮기기 실패", error);
      result = { ok: false, error: "옮기는 중에 문제가 생겼습니다. 다시 시도해 주세요" };
    }
    await finishMove(db, userId, claimed.id, result);
  }
  return moveProgress(db, userId);
}
