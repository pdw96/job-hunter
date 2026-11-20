import { z } from "zod";
import type { Db } from "@/db/types";
import { type AiClient, type AiFailure, runAi } from "@/modules/ai/client";
import {
  type ClaimSubject,
  findClaims,
  type FoundClaim,
  MAX_CLAIMS,
  mergeClaims,
  sentences,
  subjectOfJob,
  subjectOfProject,
  subjectOfScene,
} from "./claims";
import { createFact } from "./facts-repo";
import { numbersIn } from "./grounding";
import { isMonth } from "./input";
import { type Kind, KIND_LABELS, LIMITS, type Scope } from "./options";
import { RECORD_IMPORT_SYSTEM } from "./prompts";
import { insertRecordClaims } from "./record-claims-repo";
import {
  type ActivityInput,
  type CourseInput,
  type CredentialInput,
  type EducationInput,
  type GapInput,
  type JobInput,
  type ProjectInput,
  type SceneInput,
  validateFact,
  validateScene,
} from "./record-input";
import {
  CREDENTIAL_TYPES,
  DEGREES,
  EMPLOYMENTS,
  type FactKind,
  type HeadRef,
  PARENT_KINDS,
  type ParentKind,
  RECORD_LIMITS,
  SCHOOL_STATUSES,
} from "./record-options";
import { fitScene, sceneDraftSchema } from "./scene-interview";
import { createScene } from "./scenes-repo";

// 새 구조로 가져오기. 글을 AI가 메뉴별(이력 사실, 머리, 장면)로 나누고, 코드가 검사한 뒤 미확인 기록과 주장으로 저장한다.
// 가져온 글은 AI가 쓴 것일 수 있으므로 내용을 사실로 취급하지 않는다(import.ts와 같은 규칙).

const MAX_ITEMS = 30; // 머리와 이력 사실을 합쳐
const MAX_SCENES = 8; // 머리마다

const squash = (text: string) => text.replace(/\s+/g, " ").trim();

const sceneSchema = sceneDraftSchema.extend({ roleClaims: z.array(z.string()), bannedPhrases: z.array(z.string()) });
// 빈 칸은 빈 문자열로 받는다
const importSchema = z.object({
  education: z.array(
    z.object({
      schoolName: z.string(),
      location: z.string(),
      degree: z.enum(DEGREES),
      major: z.string(),
      startMonth: z.string(),
      endMonth: z.string(),
      status: z.enum(SCHOOL_STATUSES),
      gpa: z.string(),
      gpaScale: z.enum(["4.5", "4.3", "4.0", ""]),
    }),
  ),
  courses: z.array(
    z.object({ name: z.string(), institution: z.string(), startMonth: z.string(), endMonth: z.string(), hours: z.string(), learned: z.string() }),
  ),
  credentials: z.array(z.object({ type: z.enum(CREDENTIAL_TYPES), name: z.string(), issuer: z.string(), month: z.string(), score: z.string() })),
  gaps: z.array(z.object({ startMonth: z.string(), endMonth: z.string(), note: z.string() })),
  jobs: z.array(
    z.object({
      company: z.string(),
      department: z.string(),
      title: z.string(),
      employment: z.enum(EMPLOYMENTS),
      startMonth: z.string(),
      endMonth: z.string(),
      isOngoing: z.boolean(),
      duties: z.array(z.string()),
      bannedPhrases: z.array(z.string()),
      roleClaims: z.array(z.string()),
      scenes: z.array(sceneSchema),
    }),
  ),
  projects: z.array(
    z.object({
      name: z.string(),
      // 같은 답의 jobs·education·courses 배열에서의 순서. null이면 개인
      parentIndex: z.object({ kind: z.enum(PARENT_KINDS), index: z.number().int() }).nullable(),
      startMonth: z.string(),
      endMonth: z.string(),
      isOngoing: z.boolean(),
      role: z.string(),
      tools: z.array(z.string()),
      summary: z.string(),
      bannedPhrases: z.array(z.string()),
      roleClaims: z.array(z.string()),
      scenes: z.array(sceneSchema),
    }),
  ),
  activities: z.array(
    z.object({
      name: z.string(),
      organization: z.string(),
      startMonth: z.string(),
      endMonth: z.string(),
      isOngoing: z.boolean(),
      role: z.string(),
      scenes: z.array(sceneSchema),
    }),
  ),
  more: z.boolean(), // 더 있는데 다 담지 못했는가
});
type Answer = z.infer<typeof importSchema>;

export type PreparedClaims = (FoundClaim & { status: "pending" | "needs_fix" })[];
export type PreparedScene = { input: Omit<SceneInput, "head">; claims: PreparedClaims };
export type ImportPlan = {
  education: EducationInput[];
  courses: CourseInput[];
  credentials: CredentialInput[];
  gaps: GapInput[];
  jobs: { input: JobInput; claims: PreparedClaims; scenes: PreparedScene[] }[];
  projects: { input: ProjectInput; claims: PreparedClaims; parentIndex: { kind: ParentKind; index: number } | null; scenes: PreparedScene[] }[];
  activities: { input: ActivityInput; scenes: PreparedScene[] }[];
};

type Failure = "over_limit" | "nothing_found" | AiFailure;

// 원본 글에 비추어 AI의 답을 검사하는 도구. 지어낸 숫자 때문에 비우거나 버린 것을 dropped로 센다
function checker(sourceText: string) {
  const flat = squash(sourceText);
  const known = new Set(numbersIn(sourceText));
  let dropped = 0;
  const isInvented = (text: string | null) => numbersIn(text).some((number) => !known.has(number));
  const short = (value: string) => value.trim().slice(0, LIMITS.shortText);
  // 원본에 연도와 월이 모두 숫자로 있는 월만 받는다. 아니면 비운다.
  // 두 자리 연도는 "16년 3월"처럼 따로 적힌 때만 받는다("16.03"은 소수 16.03으로 읽혀 비운다. 안전한 쪽이다)
  const month = (value: string) => {
    const trimmed = value.trim();
    if (!isMonth(trimmed)) return "";
    const [year, mon] = trimmed.split("-").map(Number);
    if ((known.has(String(year)) || known.has(String(year % 100))) && known.has(String(mon))) return trimmed;
    dropped += 1;
    return "";
  };
  // 선택 칸: 원본에 없던 숫자가 있으면 비운다
  const optional = (value: string) => {
    if (!isInvented(value)) return short(value);
    dropped += 1;
    return "";
  };
  // 이름 칸(필수): 원본에 없던 숫자가 있으면 null. 지어낸 이름으로 저장하지 않고 그 항목을 건너뛴다
  const identity = (value: string): string | null => {
    if (!isInvented(value)) return short(value);
    dropped += 1;
    return null;
  };
  // 목록 칸(사용 도구): 지어낸 숫자가 든 줄만 버린다
  const optionalList = (values: string[]) => values.map(short).filter((value) => value !== "" && optional(value) !== "");
  // 산출 근거는 주장으로 물어볼 수 없는 칸이라, 지어낸 숫자가 있으면 버린다
  const basis = (value: string | null) => {
    if (!isInvented(value)) return value;
    dropped += 1;
    return null;
  };
  // 금지 표현은 사용자가 정한다. 원본에 글자 그대로 적혀 있는 것만 받고, AI가 지어낸 것은 버린다
  const banned = (phrases: string[]) =>
    [...new Set(phrases.map(squash))]
      .filter((phrase) => phrase !== "" && phrase.length <= LIMITS.shortText && flat.includes(phrase))
      .slice(0, LIMITS.bannedPhrases);
  // 주장을 만든다. 지어낸 숫자가 든 구절은 needs_fix로, 자를 때 잘리지 않게 앞에 둔다
  const claims = (subject: ClaimSubject, aiQuotes: string[], extra: string[] = []): PreparedClaims => {
    const code = findClaims(subject);
    const ordered = [...code.filter((claim) => isInvented(claim.quote)), ...code.filter((claim) => !isInvented(claim.quote))];
    const merged = mergeClaims(ordered, aiQuotes, subject);
    const extras = extra
      .filter((quote) => isInvented(quote) && !merged.some((claim) => claim.quote === quote))
      .map((quote) => ({ kind: "metric" as const, quote, phrase: null, origin: "code" as const }));
    const all = [...extras, ...merged].map((claim) => ({
      ...claim,
      status: isInvented(claim.quote) ? ("needs_fix" as const) : ("pending" as const),
    }));
    return [...all.filter((claim) => claim.status === "needs_fix"), ...all.filter((claim) => claim.status === "pending")].slice(0, MAX_CLAIMS);
  };
  return { isInvented, short, month, optional, identity, optionalList, basis, banned, claims, dropped: () => dropped };
}
type Checker = ReturnType<typeof checker>;

// 검사에서 빠진 것은 null
function prepareScene(raw: Answer["jobs"][number]["scenes"][number], check: Checker): PreparedScene | null {
  const { roleClaims, bannedPhrases, ...draft } = raw;
  const { draft: fitted } = fitScene(draft);
  const head: HeadRef = { kind: "job", id: "plan" }; // 검사용. 저장할 때 실제 머리로 바꾼다
  const checked = validateScene({ ...fitted, head, bannedPhrases: check.banned(bannedPhrases) });
  if (!checked.ok) return null;
  const value: SceneInput = {
    ...checked.value,
    metrics: checked.value.metrics.map((metric) => ({ ...metric, basis: check.basis(metric.basis) })),
  };
  // 주장으로 훑지 않는 칸(제목, 하지 않은 것, 증빙 메모)에 지어낸 숫자가 있으면 그 구절도 묻는다
  const claims = check.claims(subjectOfScene(value), roleClaims, [value.title, value.notDone, value.evidenceNote].flatMap(sentences));
  const input: Omit<SceneInput, "head"> & { head?: HeadRef } = { ...value };
  delete input.head;
  return { input, claims };
}

function validated<K extends FactKind>(kind: K, raw: unknown) {
  const result = validateFact(kind, raw);
  return result.ok ? result.value : null;
}

// AI에게 글을 나누게 하고, 코드로 검사해 저장할 계획을 만든다. 저장하지 않는다(옮기기와 프롬프트 점검에서도 쓴다)
export async function requestRecordImport(
  db: Db,
  ai: AiClient,
  userId: string,
  sourceText: string,
  // headOnly: 옮기기에서 사례 기록이 따로 딸린 재직이면 머리만 받는다(답을 짧게. 남은 장면은 옮기는 쪽이 버린다)
  options: { purpose?: "import_records" | "migrate"; hint?: Kind; headOnly?: boolean } = {},
  now: Date = new Date(),
): Promise<{ ok: true; plan: ImportPlan; skipped: number; more: boolean; inventedDropped: number } | { ok: false; reason: Failure }> {
  // 옮기기는 한 목적(migrate)에 세 가지 요청이 있어, 첫 줄로 무엇을 하는지 적는다(로컬 미리보기의 가짜 AI도 이것으로 고른다)
  const tag = options.purpose === "migrate" ? "[옮기기: 나누기]\n" : "";
  const only = options.headOnly ? ". 이 회사의 사례는 따로 옮깁니다. 경력 머리(담당 업무까지)만 적고 scenes는 빈 배열로 둡니다" : "";
  const lead = options.hint ? `이 글은 예전 기록의 '${KIND_LABELS[options.hint]}' 한 건입니다${only}\n\n` : "";
  const result = await runAi(
    db,
    ai,
    userId,
    {
      purpose: options.purpose ?? "import_records",
      system: RECORD_IMPORT_SYSTEM,
      messages: [{ role: "user", text: `${tag}${lead}[가져올 글]\n${sourceText}` }],
      schema: importSchema,
      effort: "medium",
      maxTokens: 16000, // 스트리밍 없이 보낼 수 있는 길이. 더 크게 잡으면 SDK가 보내기 전에 거절한다
    },
    now,
  );
  if (!result.ok) return { ok: false, reason: result.reason };
  const answer = result.value;
  const total =
    answer.education.length + answer.courses.length + answer.credentials.length + answer.gaps.length +
    answer.jobs.length + answer.projects.length + answer.activities.length;
  if (total === 0) return { ok: false, reason: "nothing_found" };

  const check = checker(sourceText);
  const plan: ImportPlan = { education: [], courses: [], credentials: [], gaps: [], jobs: [], projects: [], activities: [] };
  let skipped = 0;
  let more = answer.more;
  let count = 0;
  // 검사를 통과한 것만 한도까지 받는다
  const take = <T>(value: T | null, push: (value: T) => void): boolean => {
    if (value === null) {
      skipped += 1;
      return false;
    }
    if (count >= MAX_ITEMS) {
      more = true;
      return false;
    }
    count += 1;
    push(value);
    return true;
  };
  const scenesOf = (raw: Answer["jobs"][number]["scenes"]) => {
    const prepared: PreparedScene[] = [];
    for (const item of raw) {
      const scene = prepareScene(item, check);
      if (scene === null) skipped += 1;
      else if (prepared.length >= MAX_SCENES) more = true;
      else prepared.push(scene);
    }
    return prepared;
  };
  // AI의 배열 순서 → 계획의 순서. 빠진 것은 null(그것을 가리키던 프로젝트는 개인으로 둔다)
  const indexMap: Record<ParentKind, (number | null)[]> = { job: [], education: [], course: [] };

  // 이름 칸에 지어낸 숫자가 있으면 값을 null로 넘겨 건너뛴다(머리면 장면도 버린다)
  const unless = <T>(name: string | null, build: (name: string) => T) => (name === null ? null : build(name));

  for (const raw of answer.education) {
    const gpa = check.optional(raw.gpa);
    const value = unless(check.identity(raw.schoolName), (schoolName) =>
      validated("education", {
        schoolName,
        location: check.optional(raw.location),
        degree: raw.degree,
        major: check.optional(raw.major),
        startMonth: check.month(raw.startMonth),
        endMonth: check.month(raw.endMonth),
        status: raw.status,
        gpa,
        gpaScale: gpa === "" ? "" : raw.gpaScale,
      }),
    );
    indexMap.education.push(take(value, (v) => plan.education.push(v)) ? plan.education.length - 1 : null);
  }
  for (const raw of answer.courses) {
    const value = unless(check.identity(raw.name), (name) =>
      validated("course", {
        name,
        institution: check.optional(raw.institution),
        startMonth: check.month(raw.startMonth),
        endMonth: check.month(raw.endMonth),
        hours: check.optional(raw.hours.match(/\d+/)?.[0] ?? ""),
        learned: check.optional(raw.learned),
      }),
    );
    indexMap.course.push(take(value, (v) => plan.courses.push(v)) ? plan.courses.length - 1 : null);
  }
  for (const raw of answer.credentials) {
    const value = unless(check.identity(raw.name), (name) =>
      validated("credential", {
        type: raw.type,
        name,
        issuer: check.optional(raw.issuer),
        month: check.month(raw.month),
        score: check.optional(raw.score),
      }),
    );
    take(value, (v) => plan.credentials.push(v));
  }
  for (const raw of answer.gaps) {
    const value = validated("gap", { startMonth: check.month(raw.startMonth), endMonth: check.month(raw.endMonth), note: check.optional(raw.note) });
    take(value, (v) => plan.gaps.push(v));
  }
  for (const raw of answer.jobs) {
    const value = unless(check.identity(raw.company), (company) =>
      validated("job", {
        company,
        department: check.optional(raw.department),
        title: check.optional(raw.title),
        employment: raw.employment,
        startMonth: check.month(raw.startMonth),
        endMonth: check.month(raw.endMonth),
        isOngoing: raw.isOngoing,
        // 담당 업무는 주장으로 묻는다(지어낸 숫자가 든 줄은 needs_fix)
        duties: raw.duties.map((line) => line.trim().slice(0, RECORD_LIMITS.dutyLength)).filter(Boolean).slice(0, RECORD_LIMITS.duties),
        bannedPhrases: check.banned(raw.bannedPhrases),
      }),
    );
    const kept = take(value, (input) => {
      plan.jobs.push({ input, claims: check.claims(subjectOfJob(input), raw.roleClaims), scenes: scenesOf(raw.scenes) });
    });
    indexMap.job.push(kept ? plan.jobs.length - 1 : null);
  }
  for (const raw of answer.projects) {
    const value = unless(check.identity(raw.name), (name) =>
      validated("project", {
        name,
        parent: null, // 저장할 때 parentIndex로 정한다
        startMonth: check.month(raw.startMonth),
        endMonth: check.month(raw.endMonth),
        isOngoing: raw.isOngoing,
        role: check.optional(raw.role),
        tools: [...new Set(check.optionalList(raw.tools))].slice(0, RECORD_LIMITS.tools),
        // 한 줄 소개는 주장으로 묻는다
        summary: raw.summary.trim().slice(0, RECORD_LIMITS.summary),
        bannedPhrases: check.banned(raw.bannedPhrases),
      }),
    );
    take(value, (input) => {
      const mapped = raw.parentIndex ? (indexMap[raw.parentIndex.kind][raw.parentIndex.index] ?? null) : null;
      const parentIndex = raw.parentIndex && mapped !== null ? { kind: raw.parentIndex.kind, index: mapped } : null;
      plan.projects.push({ input, claims: check.claims(subjectOfProject(input), raw.roleClaims), parentIndex, scenes: scenesOf(raw.scenes) });
    });
  }
  for (const raw of answer.activities) {
    const value = unless(check.identity(raw.name), (name) =>
      validated("activity", {
        name,
        organization: check.optional(raw.organization),
        startMonth: check.month(raw.startMonth),
        endMonth: check.month(raw.endMonth),
        isOngoing: raw.isOngoing,
        role: check.optional(raw.role),
      }),
    );
    take(value, (input) => plan.activities.push({ input, scenes: scenesOf(raw.scenes) }));
  }
  // inventedDropped: 원본에 없던 숫자 때문에 비운 칸, 버린 항목·도구·산출 근거의 수
  return { ok: true, plan, skipped, more, inventedDropped: check.dropped() };
}

export type CreatedItem = { kind: FactKind | "scene"; id: string; name: string };

// 계획을 한 트랜잭션에서 모두 만든다. 모두 미확인이다
export async function saveImportPlan(
  db: Db,
  userId: string,
  plan: ImportPlan,
  options: {
    source: "import" | "migrate";
    movedFrom?: string;
    trackScopes?: Record<string, Scope>;
    carry?: { notDone: string | null; bannedPhrases: string[] };
  },
): Promise<{ created: CreatedItem[] }> {
  return db.transaction(async (tx) => {
    const t = tx as unknown as Db;
    const created: CreatedItem[] = [];
    const common = { source: options.source, movedFrom: options.movedFrom, trackScopes: options.trackScopes };

    async function fact<K extends FactKind>(kind: K, input: Parameters<typeof createFact<K>>[3], name: string): Promise<string> {
      const result = await createFact(t, userId, kind, input, common);
      if (!result.ok) throw new Error("가져오기 계획의 소속을 찾을 수 없습니다");
      created.push({ kind, id: result.id, name });
      return result.id;
    }
    async function scenes(head: HeadRef, list: PreparedScene[]) {
      for (const { input, claims } of list) {
        const carry = options.carry;
        const value: SceneInput = {
          ...input,
          head,
          notDone: input.notDone ?? carry?.notDone ?? null,
          bannedPhrases: [...new Set([...input.bannedPhrases, ...(carry?.bannedPhrases ?? [])])].slice(0, LIMITS.bannedPhrases),
        };
        const result = await createScene(t, userId, value, common);
        if (!result.ok) throw new Error("가져오기 계획의 머리를 찾을 수 없습니다");
        await insertRecordClaims(t, userId, { kind: "scene", id: result.id }, claims);
        created.push({ kind: "scene", id: result.id, name: input.title });
      }
    }

    const ids: Record<ParentKind, string[]> = { job: [], education: [], course: [] };
    for (const input of plan.education) ids.education.push(await fact("education", input, input.schoolName));
    for (const input of plan.courses) ids.course.push(await fact("course", input, input.name));
    for (const input of plan.credentials) await fact("credential", input, input.name);
    for (const input of plan.gaps) await fact("gap", input, input.startMonth ? `공백 ${input.startMonth} ~ ${input.endMonth ?? "진행 중"}` : "공백");
    for (const job of plan.jobs) {
      const id = await fact("job", job.input, job.input.company);
      ids.job.push(id);
      await insertRecordClaims(t, userId, { kind: "job", id }, job.claims);
      await scenes({ kind: "job", id }, job.scenes);
    }
    for (const project of plan.projects) {
      const parentId = project.parentIndex ? ids[project.parentIndex.kind][project.parentIndex.index] : undefined;
      const parent = project.parentIndex && parentId ? { kind: project.parentIndex.kind, id: parentId } : null;
      const id = await fact("project", { ...project.input, parent }, project.input.name);
      await insertRecordClaims(t, userId, { kind: "project", id }, project.claims);
      await scenes({ kind: "project", id }, project.scenes);
    }
    for (const activity of plan.activities) {
      const id = await fact("activity", activity.input, activity.input.name);
      await scenes({ kind: "activity", id }, activity.scenes);
    }
    return { created };
  });
}

// 글을 새 구조로 가져온다. 모두 미확인으로, 주장과 함께 저장한다
export async function importRecords(
  db: Db,
  ai: AiClient,
  userId: string,
  sourceText: string,
  now: Date = new Date(),
): Promise<{ ok: true; created: CreatedItem[]; skipped: number; more: boolean } | { ok: false; reason: Failure }> {
  const prepared = await requestRecordImport(db, ai, userId, sourceText, {}, now);
  if (!prepared.ok) return prepared;
  const { created } = await saveImportPlan(db, userId, prepared.plan, { source: "import" });
  return { ok: true, created, skipped: prepared.skipped, more: prepared.more };
}
