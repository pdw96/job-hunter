import { eq } from "drizzle-orm";
import type { Db } from "@/db/types";
import { ownsTrack } from "@/modules/tracks/repo";
import type { EvidenceCandidate } from "./evidence";
import { type Fact, type FactsByKind, listFacts } from "./facts-repo";
import type { Metric } from "./input";
import type { Kind, Scope } from "./options";
import type { CourseInput, CredentialInput, EducationInput, GapInput, ProjectInput } from "./record-input";
import { CREDENTIAL_TYPE_LABELS, DEGREE_LABELS, type HeadKind, SCHOOL_STATUS_LABELS } from "./record-options";
import { statuses } from "./rubric-store";
import { headOfRow } from "./scene-head";
import { narrowerScope, sceneState, sceneUsable, versionHash } from "./scene-rules";
import { scenes } from "./schema";
import type { VerificationState } from "./verification";
import type { ResumeSource, WritingSource } from "./writing";

// 새 표(이력 사실·장면)를 지금의 원천 모양(WritingSource·ResumeSource·EvidenceCandidate)으로 바꾼다.
// 옛 원천(writing.ts·evidence.ts)과 같은 거르기 규칙을 새 표의 확인 기준으로 한다:
// - 자기소개서: 장면만. 장면이 확인됨이고 머리도 확인됨, 머리·장면 범위 중 좁은 것이 "사용"
// - 이력서: 확인된 머리마다 하나(확인된 장면을 이어 붙임)와 확인된 이력 사실 하나씩
// - 채점 근거: 확인됨·부분 확인 장면(머리 확인은 보지 않음)과 확인된 학력·교육 과정·자격·경력 머리
// 증빙 메모와 연락처는 담지 않는다. 학교 소재지(location)도 담지 않는다(자사양식용으로 남겨 둠)

type Period = { startMonth: string | null; endMonth: string | null; isOngoing: boolean };
type SceneRow = typeof scenes.$inferSelect;

// 머리(경력·프로젝트·활동)를 원천에 쓰기 좋게 편 모양
type Head = Period & {
  id: string;
  kind: Kind;
  name: string;
  organization: string | null; // 이력서 머리의 소속: 경력은 부서, 프로젝트는 소속 조직 이름, 활동은 기관
  sceneOrganization: string; // 장면 원천의 소속: "회사 · 부서" / "프로젝트 · 소속 조직" / 활동 이름
  role: string | null;
  isConfirmed: boolean;
  versionParts: (string | number)[]; // 머리(프로젝트면 소속 조직까지)의 (id, 버전)
  trackScopes: Record<string, Scope>;
  bannedPhrases: string[];
  duties?: string[];
  createdAt: Date;
};

const HEAD_RESUME_KIND: Record<HeadKind, Kind> = { job: "job", project: "project", activity: "other" };
const GAP_NAME = "공백 기간";
const unique = (list: string[]) => [...new Set(list)];

const scopeIn = (trackScopes: Record<string, Scope>, trackId: string): Scope => trackScopes[trackId] ?? "use";
const joined = (parts: (string | null | undefined)[], separator: string) => {
  const kept = parts.filter((part): part is string => typeof part === "string" && part !== "");
  return kept.length > 0 ? kept.join(separator) : null;
};

// 시작 월 최근 순, 시작 월이 없는 것은 아래, 같으면 만든 때 최근 순(옛 원천과 같다)
function byRecent<T>(items: { item: T; start: string | null; createdAt: Date }[]): T[] {
  return [...items]
    .sort((a, b) => {
      if (a.start !== b.start) {
        if (a.start === null) return 1;
        if (b.start === null) return -1;
        return a.start < b.start ? 1 : -1;
      }
      return b.createdAt.getTime() - a.createdAt.getTime();
    })
    .map(({ item }) => item);
}

function factName(fact: Fact): string {
  switch (fact.kind) {
    case "education":
      return (fact.value as EducationInput).schoolName;
    case "job":
      return (fact as Fact<"job">).value.company;
    case "gap":
      return GAP_NAME;
    default:
      return (fact.value as { name: string }).name;
  }
}

async function load(db: Db, userId: string) {
  const [facts, sceneRows] = await Promise.all([listFacts(db, userId), db.select().from(scenes).where(eq(scenes.userId, userId))]);
  return { facts, sceneRows, heads: headsOf(facts) };
}

function headsOf(facts: FactsByKind): Map<string, Head> {
  const heads = new Map<string, Head>();
  const base = (fact: Fact, value: Period) => ({
    id: fact.id,
    startMonth: value.startMonth,
    endMonth: value.endMonth,
    isOngoing: value.isOngoing,
    isConfirmed: fact.isConfirmed,
    trackScopes: fact.trackScopes,
    createdAt: fact.createdAt,
  });
  for (const fact of facts.job) {
    const v = fact.value;
    heads.set(fact.id, {
      ...base(fact, v),
      kind: HEAD_RESUME_KIND.job,
      name: v.company,
      organization: v.department,
      sceneOrganization: joined([v.company, v.department], " · ") ?? v.company,
      role: v.title,
      versionParts: [fact.id, fact.contentVersion],
      bannedPhrases: v.bannedPhrases,
      duties: v.duties,
    });
  }
  // 프로젝트의 소속 조직(경력·학교·교육 과정)
  const parents = new Map<string, Fact>([...facts.job, ...facts.education, ...facts.course].map((fact) => [fact.id, fact]));
  for (const fact of facts.project) {
    const v: ProjectInput = fact.value;
    const parent = v.parent ? parents.get(v.parent.id) : undefined;
    const parentName = parent ? factName(parent) : null;
    heads.set(fact.id, {
      ...base(fact, v),
      kind: HEAD_RESUME_KIND.project,
      name: v.name,
      organization: parentName,
      sceneOrganization: joined([v.name, parentName], " · ") ?? v.name,
      role: v.role,
      // 소속 조직은 내용 칸이 아니어서 프로젝트 버전이 오르지 않는다. 소속이나 그 이름이 바뀌어도 버전이 바뀌게 함께 넣는다
      versionParts: [fact.id, fact.contentVersion, ...(parent ? [parent.id, parent.contentVersion] : [])],
      bannedPhrases: v.bannedPhrases,
    });
  }
  for (const fact of facts.activity) {
    const v = fact.value;
    heads.set(fact.id, {
      ...base(fact, v),
      kind: HEAD_RESUME_KIND.activity,
      name: v.name,
      organization: v.organization,
      sceneOrganization: v.name,
      role: v.role,
      versionParts: [fact.id, fact.contentVersion],
      bannedPhrases: [],
    });
  }
  return heads;
}

const sceneStateOf = (row: SceneRow): VerificationState => sceneState(statuses(row.rubric), row.confirmedAt !== null);
const scenePeriod = (row: SceneRow, head: Head): Period =>
  row.startMonth === null
    ? { startMonth: head.startMonth, endMonth: head.endMonth, isOngoing: head.isOngoing }
    : { startMonth: row.startMonth, endMonth: row.endMonth, isOngoing: row.isOngoing };
const sceneMetrics = (row: SceneRow): Metric[] => (row.rubric.metrics.status === "met" ? row.metrics : []);

// 자소서 원천과 채점 근거가 함께 쓰는 장면 칸. 판단은 한 일 앞에, 배운 점은 결과 뒤에 붙인다
function sceneFields(row: SceneRow, head: Head) {
  return {
    id: row.id,
    name: row.title,
    kind: head.kind,
    organization: head.sceneOrganization,
    role: head.role,
    ...scenePeriod(row, head),
    situation: row.situation,
    actions: joined([row.judgment ? `판단: ${row.judgment}` : null, row.actions], "\n"),
    result: joined([row.result, row.lessons ? `배운 점: ${row.lessons}` : null], "\n"),
    notDone: row.notDone,
    contentVersion: versionHash([row.id, row.contentVersion, ...head.versionParts]),
  };
}

// 장면과 그 머리. 머리가 없는 장면(있을 수 없지만)은 건너뛴다
function scenesWithHeads(sceneRows: SceneRow[], heads: Map<string, Head>) {
  return sceneRows.flatMap((row) => {
    const head = heads.get(headOfRow(row).id);
    return head ? [{ row, head }] : [];
  });
}

export async function listSceneWritingSources(db: Db, userId: string, trackId: string): Promise<WritingSource[]> {
  if (!(await ownsTrack(db, userId, trackId))) return [];
  const { sceneRows, heads } = await load(db, userId);
  const items = scenesWithHeads(sceneRows, heads)
    .filter(({ row, head }) => sceneUsable(sceneStateOf(row), head.isConfirmed))
    .filter(({ row, head }) => narrowerScope(scopeIn(head.trackScopes, trackId), scopeIn(row.trackScopes, trackId)) === "use")
    .map(({ row, head }) => {
      const fields = sceneFields(row, head);
      // 금지 표현은 장면과 머리(경력·프로젝트)의 합
      const source: WritingSource = { ...fields, bannedPhrases: unique([...row.bannedPhrases, ...head.bannedPhrases]), metrics: sceneMetrics(row) };
      return { item: source, start: fields.startMonth, createdAt: row.createdAt };
    });
  return byRecent(items);
}

// 이력 사실 하나를 코드가 쓴 줄로
type FactLines = Period & { id: string; kind: Kind; name: string; codeLines: string[]; contentVersion: number; trackScopes: Record<string, Scope>; createdAt: Date };

function educationLines(v: EducationInput): string[] {
  const gpa = v.gpa ? ` · 학점 ${v.gpaScale ? `${v.gpa}/${v.gpaScale}` : v.gpa}` : "";
  return [`${joined([v.major, DEGREE_LABELS[v.degree], SCHOOL_STATUS_LABELS[v.status]], " · ")}${gpa}`];
}
function courseLines(v: CourseInput): string[] {
  const first = joined([v.institution, v.hours !== null ? `${v.hours}시간` : null], " · ");
  return [first, v.learned].filter((line): line is string => line !== null && line !== "");
}
const credentialLines = (v: CredentialInput): string[] => [joined([CREDENTIAL_TYPE_LABELS[v.type], v.issuer, v.score], " · ") as string];
const gapLines = (v: GapInput): string[] => (v.note ? [v.note] : []);

// 확인된 학력·교육 과정·자격·공백. withGaps가 아니면 공백은 뺀다(채점 근거)
function factLines(facts: FactsByKind, withGaps: boolean): FactLines[] {
  const common = (fact: Fact) => ({ id: fact.id, name: factName(fact), contentVersion: fact.contentVersion, trackScopes: fact.trackScopes, createdAt: fact.createdAt });
  const confirmed = <T extends Fact>(list: T[]) => list.filter((fact) => fact.isConfirmed);
  return [
    ...confirmed(facts.education).map((fact) => ({
      ...common(fact),
      kind: "school" as const,
      startMonth: fact.value.startMonth,
      endMonth: fact.value.endMonth,
      isOngoing: false,
      codeLines: educationLines(fact.value),
    })),
    ...confirmed(facts.course).map((fact) => ({
      ...common(fact),
      kind: "training" as const,
      startMonth: fact.value.startMonth,
      endMonth: fact.value.endMonth,
      isOngoing: false,
      codeLines: courseLines(fact.value),
    })),
    // 자격은 취득 월 하나. kind가 certificate라 formatPeriod가 "취득"으로 쓴다
    ...confirmed(facts.credential).map((fact) => ({
      ...common(fact),
      kind: "certificate" as const,
      startMonth: fact.value.month,
      endMonth: null,
      isOngoing: false,
      codeLines: credentialLines(fact.value),
    })),
    // 공백은 끝 월이 없으면 진행 중, 두 월이 모두 없으면 기간 없음
    ...(withGaps
      ? confirmed(facts.gap).map((fact) => ({
          ...common(fact),
          kind: "gap" as const,
          startMonth: fact.value.startMonth,
          endMonth: fact.value.endMonth,
          isOngoing: fact.value.startMonth !== null && fact.value.endMonth === null,
          codeLines: gapLines(fact.value),
        }))
      : []),
  ];
}

export async function listRecordResumeSources(db: Db, userId: string, trackId: string): Promise<ResumeSource[]> {
  if (!(await ownsTrack(db, userId, trackId))) return [];
  const { facts, sceneRows, heads } = await load(db, userId);

  // 머리마다 확인됨이고 그 트랙에서 제외하지 않은 장면(최근 순)
  const scenesByHead = new Map<string, { row: SceneRow; scope: Scope }[]>();
  const usable = scenesWithHeads(sceneRows, heads)
    .filter(({ row }) => sceneStateOf(row) === "confirmed" && scopeIn(row.trackScopes, trackId) !== "exclude")
    .map(({ row, head }) => ({ item: { row, head }, start: scenePeriod(row, head).startMonth, createdAt: row.createdAt }));
  for (const { row, head } of byRecent(usable)) {
    const list = scenesByHead.get(head.id) ?? [];
    list.push({ row, scope: scopeIn(row.trackScopes, trackId) });
    scenesByHead.set(head.id, list);
  }

  const items: { item: ResumeSource; start: string | null; createdAt: Date }[] = [];
  for (const head of heads.values()) {
    const scope = scopeIn(head.trackScopes, trackId);
    if (!head.isConfirmed || scope === "exclude") continue;
    const included = scenesByHead.get(head.id) ?? [];
    const chunks = included.map(({ row, scope: sceneScope }) => {
      const body = joined([row.situation && `상황: ${row.situation}`, row.actions && `한 일: ${row.actions}`, row.result && `결과: ${row.result}`], " / ");
      return `[${row.title}]${body ? ` ${body}` : ""}${sceneScope === "summary" ? " (요약만)" : ""}`;
    });
    const source: ResumeSource = {
      id: head.id,
      name: head.name,
      kind: head.kind,
      organization: head.organization,
      role: head.role,
      startMonth: head.startMonth,
      endMonth: head.endMonth,
      isOngoing: head.isOngoing,
      situation: null,
      actions: joined(chunks, "\n"),
      result: null,
      notDone: joined(
        included.map(({ row }) => (row.notDone ? `[${row.title}] ${row.notDone}` : null)),
        "\n",
      ),
      bannedPhrases: unique([...head.bannedPhrases, ...included.flatMap(({ row }) => row.bannedPhrases)]),
      contentVersion: versionHash([...head.versionParts, ...included.flatMap(({ row }) => [row.id, row.contentVersion])]),
      metrics: included.flatMap(({ row }) => sceneMetrics(row)),
      scope: scope === "summary" ? "summary" : "use",
      ...(head.duties ? { duties: head.duties } : {}),
    };
    items.push({ item: source, start: head.startMonth, createdAt: head.createdAt });
  }

  for (const fact of factLines(facts, true)) {
    const scope = scopeIn(fact.trackScopes, trackId);
    if (scope === "exclude") continue;
    items.push({
      item: {
        id: fact.id,
        name: fact.name,
        kind: fact.kind,
        organization: null,
        role: null,
        startMonth: fact.startMonth,
        endMonth: fact.endMonth,
        isOngoing: fact.isOngoing,
        situation: null,
        actions: null,
        result: null,
        notDone: null,
        bannedPhrases: [],
        contentVersion: fact.contentVersion,
        metrics: [],
        scope: scope === "summary" ? "summary" : "use",
        codeLines: fact.codeLines,
      },
      start: fact.startMonth,
      createdAt: fact.createdAt,
    });
  }
  return byRecent(items);
}

export async function listRecordEvidence(db: Db, userId: string, trackId: string): Promise<EvidenceCandidate[]> {
  if (!(await ownsTrack(db, userId, trackId))) return [];
  const { facts, sceneRows, heads } = await load(db, userId);
  const items: { item: EvidenceCandidate; start: string | null; createdAt: Date }[] = [];

  // 장면: 확인됨·부분 확인, 머리·장면 범위 중 좁은 것이 제외가 아닌 것(머리 확인 여부는 보지 않는다)
  for (const { row, head } of scenesWithHeads(sceneRows, heads)) {
    const state = sceneStateOf(row);
    if (state === "unconfirmed") continue;
    if (narrowerScope(scopeIn(head.trackScopes, trackId), scopeIn(row.trackScopes, trackId)) === "exclude") continue;
    const fields = sceneFields(row, head);
    items.push({ item: { ...fields, state }, start: fields.startMonth, createdAt: row.createdAt });
  }

  // 확인된 경력 머리: 담당 업무를 줄로
  for (const fact of facts.job) {
    if (!fact.isConfirmed || scopeIn(fact.trackScopes, trackId) === "exclude") continue;
    const v = fact.value;
    items.push({
      item: {
        id: fact.id,
        name: v.company,
        kind: "job",
        organization: v.department,
        role: v.title,
        startMonth: v.startMonth,
        endMonth: v.endMonth,
        isOngoing: v.isOngoing,
        situation: null,
        actions: joined(v.duties, "\n"),
        result: null,
        notDone: null,
        contentVersion: fact.contentVersion,
        state: "confirmed",
      },
      start: v.startMonth,
      createdAt: fact.createdAt,
    });
  }

  // 확인된 학력·교육 과정·자격: 코드 줄을 한 일 칸에
  for (const fact of factLines(facts, false)) {
    if (scopeIn(fact.trackScopes, trackId) === "exclude") continue;
    items.push({
      item: {
        id: fact.id,
        name: fact.name,
        kind: fact.kind,
        organization: null,
        role: null,
        startMonth: fact.startMonth,
        endMonth: fact.endMonth,
        isOngoing: fact.isOngoing,
        situation: null,
        actions: joined(fact.codeLines, "\n"),
        result: null,
        notDone: null,
        contentVersion: fact.contentVersion,
        state: "confirmed",
      },
      start: fact.startMonth,
      createdAt: fact.createdAt,
    });
  }
  return byRecent(items);
}

// 장면 id → 제목, 이력 사실 id → 이름. 제출본을 얼릴 때 근거의 이름을 남기려고 쓴다(확인 여부와 상관없이 모두)
export async function recordNames(db: Db, userId: string): Promise<Map<string, string>> {
  const { facts, sceneRows } = await load(db, userId);
  const names = new Map<string, string>();
  for (const list of Object.values(facts) as Fact[][]) for (const fact of list) names.set(fact.id, factName(fact));
  for (const row of sceneRows) names.set(row.id, row.title);
  return names;
}
