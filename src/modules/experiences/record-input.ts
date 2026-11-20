import { isMonth, type Metric, stringList, text } from "./input";
import {
  CREDENTIAL_TYPES,
  type CredentialType,
  DEGREES,
  type Degree,
  EMPLOYMENTS,
  type Employment,
  type FactKind,
  GPA_SCALES,
  type GpaScale,
  HEAD_KINDS,
  type HeadRef,
  PARENT_KINDS,
  type ProjectParent,
  RECORD_LIMITS,
  SCHOOL_STATUSES,
  type SchoolStatus,
} from "./record-options";
import { LIMITS } from "./options";

// 메뉴별 입력 타입과 검사. 오류 문구는 화면에 그대로 보여 준다.

export type EducationInput = {
  schoolName: string;
  location: string | null;
  degree: Degree;
  major: string | null;
  startMonth: string | null;
  endMonth: string | null;
  status: SchoolStatus;
  gpa: string | null;
  gpaScale: GpaScale | null;
};
export type CourseInput = {
  name: string;
  institution: string | null;
  startMonth: string | null;
  endMonth: string | null;
  hours: number | null;
  learned: string | null;
};
export type JobInput = {
  company: string;
  department: string | null;
  title: string | null;
  employment: Employment;
  startMonth: string | null;
  endMonth: string | null;
  isOngoing: boolean;
  duties: string[];
  bannedPhrases: string[];
};
export type GapInput = { startMonth: string | null; endMonth: string | null; note: string | null };
export type CredentialInput = {
  type: CredentialType;
  name: string;
  issuer: string | null;
  month: string | null;
  score: string | null;
};
export type ProjectInput = {
  name: string;
  parent: ProjectParent;
  startMonth: string | null;
  endMonth: string | null;
  isOngoing: boolean;
  role: string | null;
  tools: string[];
  summary: string | null;
  bannedPhrases: string[];
};
export type ActivityInput = {
  name: string;
  organization: string | null;
  startMonth: string | null;
  endMonth: string | null;
  isOngoing: boolean;
  role: string | null;
};
export type SceneInput = {
  head: HeadRef;
  title: string;
  startMonth: string | null;
  endMonth: string | null;
  isOngoing: boolean;
  situation: string | null;
  judgment: string | null;
  actions: string | null;
  result: string | null;
  lessons: string | null;
  metrics: Metric[];
  notDone: string | null;
  bannedPhrases: string[];
  evidenceNote: string | null;
  tags: string[];
};
export type FactInputs = {
  education: EducationInput;
  course: CourseInput;
  job: JobInput;
  gap: GapInput;
  credential: CredentialInput;
  project: ProjectInput;
  activity: ActivityInput;
};

type Errors<T> = Partial<Record<keyof T, string>>;
type Result<T> = { ok: true; value: T } | { ok: false; errors: Errors<T> };
type Raw = Record<string, unknown>;

const asRaw = (input: unknown): Raw => (typeof input === "object" && input !== null ? (input as Raw) : {});
const pick = <T extends string>(options: readonly T[], value: unknown): T | null =>
  options.find((o) => o === value) ?? null;

// 짧은 칸: 100자까지
function shortText<T>(errors: Errors<T>, key: keyof T, raw: unknown, label: string, required = false): string | null {
  const value = text(raw);
  if (value === null) {
    if (required) errors[key] = `${label}을(를) 입력해 주세요`;
    return null;
  }
  if (value.length > LIMITS.shortText) errors[key] = `${label}은(는) ${LIMITS.shortText}자까지 쓸 수 있습니다`;
  return value;
}

function longText<T>(errors: Errors<T>, key: keyof T, raw: unknown, label: string): string | null {
  const value = text(raw);
  if (value !== null && value.length > LIMITS.longText) {
    errors[key] = `${label}은(는) ${LIMITS.longText.toLocaleString("ko-KR")}자까지 쓸 수 있습니다`;
  }
  return value;
}

function month<T>(errors: Errors<T>, key: keyof T, raw: unknown, label: string, required = false): string | null {
  const value = text(raw);
  if (value === null) {
    if (required) errors[key] = `${label}을(를) 입력해 주세요`;
    return null;
  }
  if (!isMonth(value)) {
    errors[key] = `${label}을(를) 다시 확인해 주세요`;
    return null;
  }
  return value;
}

// 시작·끝 월. forceNoEnd이면(재직 중·재학 중) 끝 월을 받지 않는다
function period<T extends { startMonth: string | null; endMonth: string | null }>(
  errors: Errors<T>,
  raw: Raw,
  opts: { forceNoEnd?: boolean; required?: boolean } = {},
): { startMonth: string | null; endMonth: string | null } {
  const startMonth = month(errors, "startMonth", raw.startMonth, "시작 월", opts.required);
  let endMonth: string | null = null;
  if (opts.forceNoEnd) {
    endMonth = null;
  } else {
    endMonth = month(errors, "endMonth", raw.endMonth, "끝 월", opts.required);
    if (endMonth !== null && startMonth !== null && endMonth < startMonth) errors.endMonth = "끝 월이 시작 월보다 앞섭니다";
  }
  return { startMonth, endMonth };
}

function limitedList<T>(
  errors: Errors<T>,
  key: keyof T,
  raw: unknown,
  label: string,
  max: number,
  maxLength: number,
): string[] {
  const list = stringList(raw);
  if (list.length > max) errors[key] = `${label}은(는) ${max}개까지 넣을 수 있습니다`;
  else if (list.some((s) => s.length > maxLength)) errors[key] = `${label}은(는) 줄마다 ${maxLength}자까지 쓸 수 있습니다`;
  return list;
}

function bannedList<T>(errors: Errors<T>, key: keyof T, raw: unknown): string[] {
  const list = stringList(raw);
  if (list.length > LIMITS.bannedPhrases) {
    errors[key] = `쓰면 안 되는 표현은 ${LIMITS.bannedPhrases}개까지 넣을 수 있습니다`;
  } else if (list.some((p) => p.length > LIMITS.shortText)) {
    errors[key] = `쓰면 안 되는 표현은 ${LIMITS.shortText}자까지 쓸 수 있습니다`;
  }
  return list;
}

function done<T>(errors: Errors<T>, value: T): Result<T> {
  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, value };
}

function validateEducation(input: unknown): Result<EducationInput> {
  const raw = asRaw(input);
  const errors: Errors<EducationInput> = {};
  const schoolName = shortText(errors, "schoolName", raw.schoolName, "학교 이름", true) ?? "";
  const location = shortText(errors, "location", raw.location, "소재지");
  const degree = pick(DEGREES, raw.degree);
  if (degree === null) errors.degree = "학위를 골라 주세요";
  const status = pick(SCHOOL_STATUSES, raw.status);
  if (status === null) errors.status = "상태를 골라 주세요";
  const major = shortText(errors, "major", raw.major, "전공"); // 고등학교는 비워도 된다
  const { startMonth, endMonth } = period(errors, raw, { forceNoEnd: status === "enrolled" || status === "leave" });

  let gpa = text(raw.gpa);
  let gpaScale = pick(GPA_SCALES, raw.gpaScale);
  if (gpa === null) {
    gpaScale = null;
  } else if (!/^\d(\.\d{1,2})?$/.test(gpa)) {
    errors.gpa = "학점을 다시 확인해 주세요";
    gpa = null;
  } else if (gpaScale === null) {
    errors.gpaScale = "학점 기준을 골라 주세요";
  } else if (Number(gpa) > Number(gpaScale)) {
    errors.gpa = "학점이 기준보다 큽니다";
  }

  return done(errors, {
    schoolName,
    location,
    degree: degree!,
    major,
    startMonth,
    endMonth,
    status: status!,
    gpa,
    gpaScale,
  });
}

function validateCourse(input: unknown): Result<CourseInput> {
  const raw = asRaw(input);
  const errors: Errors<CourseInput> = {};
  const name = shortText(errors, "name", raw.name, "과정 이름", true) ?? "";
  const institution = shortText(errors, "institution", raw.institution, "기관");
  const { startMonth, endMonth } = period(errors, raw);
  let hours: number | null = null;
  if (raw.hours !== null && raw.hours !== undefined && raw.hours !== "") {
    const n = typeof raw.hours === "number" ? raw.hours : Number(raw.hours);
    if (!Number.isInteger(n) || n < 1 || n > 10000) errors.hours = "시간은 1에서 10,000 사이의 정수로 적어 주세요";
    else hours = n;
  }
  const learned = shortText(errors, "learned", raw.learned, "배운 것");
  return done(errors, { name, institution, startMonth, endMonth, hours, learned });
}

function validateJob(input: unknown): Result<JobInput> {
  const raw = asRaw(input);
  const errors: Errors<JobInput> = {};
  const company = shortText(errors, "company", raw.company, "회사 이름", true) ?? "";
  const department = shortText(errors, "department", raw.department, "부서");
  const title = shortText(errors, "title", raw.title, "직위·직무");
  const employment = pick(EMPLOYMENTS, raw.employment);
  if (employment === null) errors.employment = "고용 형태를 골라 주세요";
  const isOngoing = raw.isOngoing === true;
  const { startMonth, endMonth } = period(errors, raw, { forceNoEnd: isOngoing });
  const duties = limitedList(errors, "duties", raw.duties, "담당 업무", RECORD_LIMITS.duties, RECORD_LIMITS.dutyLength);
  const bannedPhrases = bannedList(errors, "bannedPhrases", raw.bannedPhrases);
  return done(errors, {
    company,
    department,
    title,
    employment: employment!,
    startMonth,
    endMonth,
    isOngoing,
    duties,
    bannedPhrases,
  });
}

function validateGap(input: unknown): Result<GapInput> {
  const raw = asRaw(input);
  const errors: Errors<GapInput> = {};
  // 끝 월이 없으면 진행 중, 두 월이 모두 없으면 기간 없음(옮긴 옛 공백에 흔하다)
  const { startMonth, endMonth } = period(errors, raw);
  const note = shortText(errors, "note", raw.note, "메모");
  return done(errors, { startMonth, endMonth, note });
}

function validateCredential(input: unknown): Result<CredentialInput> {
  const raw = asRaw(input);
  const errors: Errors<CredentialInput> = {};
  const type = pick(CREDENTIAL_TYPES, raw.type);
  if (type === null) errors.type = "종류를 골라 주세요";
  const name = shortText(errors, "name", raw.name, "이름", true) ?? "";
  const issuer = shortText(errors, "issuer", raw.issuer, "발급 기관");
  const m = month(errors, "month", raw.month, "취득 월");
  const score = shortText(errors, "score", raw.score, "점수·등급");
  return done(errors, { type: type!, name, issuer, month: m, score });
}

function validateProject(input: unknown): Result<ProjectInput> {
  const raw = asRaw(input);
  const errors: Errors<ProjectInput> = {};
  const name = shortText(errors, "name", raw.name, "프로젝트 이름", true) ?? "";

  // 딸린 곳의 소유 확인은 repo에서 한다. 여기서는 모양만 본다
  let parent: ProjectParent = null;
  if (raw.parent !== null && raw.parent !== undefined) {
    const p = asRaw(raw.parent);
    const kind = pick(PARENT_KINDS, p.kind);
    const id = text(p.id);
    if (kind === null || id === null) errors.parent = "소속을 다시 골라 주세요";
    else parent = { kind, id };
  }

  const isOngoing = raw.isOngoing === true;
  const { startMonth, endMonth } = period(errors, raw, { forceNoEnd: isOngoing });
  const role = shortText(errors, "role", raw.role, "역할");
  const tools = limitedList(errors, "tools", raw.tools, "사용 도구", RECORD_LIMITS.tools, LIMITS.shortText);
  const summary = text(raw.summary);
  if (summary !== null && summary.length > RECORD_LIMITS.summary) {
    errors.summary = `한 줄 소개는 ${RECORD_LIMITS.summary}자까지 쓸 수 있습니다`;
  }
  const bannedPhrases = bannedList(errors, "bannedPhrases", raw.bannedPhrases);
  return done(errors, { name, parent, startMonth, endMonth, isOngoing, role, tools, summary, bannedPhrases });
}

function validateActivity(input: unknown): Result<ActivityInput> {
  const raw = asRaw(input);
  const errors: Errors<ActivityInput> = {};
  const name = shortText(errors, "name", raw.name, "활동 이름", true) ?? "";
  const organization = shortText(errors, "organization", raw.organization, "단체·기관");
  const isOngoing = raw.isOngoing === true;
  const { startMonth, endMonth } = period(errors, raw, { forceNoEnd: isOngoing });
  const role = shortText(errors, "role", raw.role, "역할");
  return done(errors, { name, organization, startMonth, endMonth, isOngoing, role });
}

const FACT_VALIDATORS: { [K in FactKind]: (raw: unknown) => Result<FactInputs[K]> } = {
  education: validateEducation,
  course: validateCourse,
  job: validateJob,
  gap: validateGap,
  credential: validateCredential,
  project: validateProject,
  activity: validateActivity,
};

export function validateFact<K extends FactKind>(
  kind: K,
  raw: unknown,
): { ok: true; value: FactInputs[K] } | { ok: false; errors: Record<string, string> } {
  const result = FACT_VALIDATORS[kind](raw);
  return result.ok ? result : { ok: false, errors: result.errors as Record<string, string> };
}

const SCENE_LONG_LABELS = {
  situation: "상황",
  judgment: "판단",
  actions: "본인이 한 일",
  result: "결과",
  lessons: "배운 것",
  notDone: "하지 않은 것",
  evidenceNote: "증빙·확인 메모",
} as const;

export function validateScene(input: unknown): Result<SceneInput> {
  const raw = asRaw(input);
  const errors: Errors<SceneInput> = {};

  const h = asRaw(raw.head);
  const headKind = pick(HEAD_KINDS, h.kind);
  const headId = text(h.id);
  if (headKind === null || headId === null) errors.head = "장면이 속할 경력·프로젝트·활동을 골라 주세요";

  const title = shortText(errors, "title", raw.title, "제목", true) ?? "";
  const isOngoing = raw.isOngoing === true;
  const { startMonth, endMonth } = period(errors, raw, { forceNoEnd: isOngoing });

  const long = {} as Record<keyof typeof SCENE_LONG_LABELS, string | null>;
  for (const key of Object.keys(SCENE_LONG_LABELS) as (keyof typeof SCENE_LONG_LABELS)[]) {
    long[key] = longText(errors, key, raw[key], SCENE_LONG_LABELS[key]);
  }

  const metrics: Metric[] = [];
  for (const item of Array.isArray(raw.metrics) ? raw.metrics : []) {
    const row = asRaw(item);
    const metricText = text(row.text);
    if (metricText === null) continue;
    const basis = text(row.basis);
    if (metricText.length > LIMITS.longText || (basis?.length ?? 0) > LIMITS.longText) errors.metrics = "수치 칸이 너무 깁니다";
    metrics.push({ text: metricText, basis });
  }
  if (metrics.length > LIMITS.metrics) errors.metrics = `수치는 ${LIMITS.metrics}개까지 넣을 수 있습니다`;

  const tags = stringList(raw.tags);
  if (tags.length > LIMITS.tags) errors.tags = `태그는 ${LIMITS.tags}개까지 넣을 수 있습니다`;
  else if (tags.some((t) => t.length > LIMITS.tagLength)) errors.tags = `태그는 ${LIMITS.tagLength}자까지 쓸 수 있습니다`;

  const bannedPhrases = bannedList(errors, "bannedPhrases", raw.bannedPhrases);

  return done(errors, {
    head: { kind: headKind!, id: headId! },
    title,
    startMonth,
    endMonth,
    isOngoing,
    situation: long.situation,
    judgment: long.judgment,
    actions: long.actions,
    result: long.result,
    lessons: long.lessons,
    metrics,
    notDone: long.notDone,
    bannedPhrases,
    evidenceNote: long.evidenceNote,
    tags,
  });
}

// 이 칸들이 바뀌면 내용이 바뀐 것으로 보고 본인 확인을 푼다. project의 parent는 넣지 않는다
export const FACT_CONTENT_FIELDS: { [K in FactKind]: readonly (keyof FactInputs[K])[] } = {
  education: ["schoolName", "location", "degree", "major", "startMonth", "endMonth", "status", "gpa", "gpaScale"],
  course: ["name", "institution", "startMonth", "endMonth", "hours", "learned"],
  job: ["company", "department", "title", "employment", "startMonth", "endMonth", "isOngoing", "duties"],
  gap: ["startMonth", "endMonth", "note"],
  credential: ["type", "name", "issuer", "month", "score"],
  project: ["name", "startMonth", "endMonth", "isOngoing", "role", "tools", "summary"],
  activity: ["name", "organization", "startMonth", "endMonth", "isOngoing", "role"],
};

export const SCENE_CONTENT_FIELDS: readonly (keyof SceneInput)[] = [
  "head",
  "title",
  "startMonth",
  "endMonth",
  "isOngoing",
  "situation",
  "judgment",
  "actions",
  "result",
  "lessons",
  "metrics",
  "notDone",
];
