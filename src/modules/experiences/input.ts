import { KINDS, type Kind, LIMITS } from "./options";

export type Metric = { text: string; basis: string | null };

export type ExperienceInput = {
  name: string;
  kind: Kind;
  organization: string | null;
  role: string | null;
  startMonth: string | null; // YYYY-MM. 자격은 취득 월
  endMonth: string | null;
  isOngoing: boolean;
  situation: string | null;
  actions: string | null; // 본인이 한 일
  result: string | null;
  metrics: Metric[];
  notDone: string | null; // 하지 않은 것
  bannedPhrases: string[]; // 쓰면 안 되는 표현
  evidenceNote: string | null;
  tags: string[];
};

export type ExperienceErrors = Partial<Record<keyof ExperienceInput, string>>;

// 이 칸들이 바뀌면 기록의 "내용"이 바뀐 것으로 보고 본인 확인을 푼다
export const CONTENT_FIELDS = [
  "kind",
  "organization",
  "role",
  "startMonth",
  "endMonth",
  "isOngoing",
  "situation",
  "actions",
  "result",
  "metrics",
  "notDone",
] as const satisfies readonly (keyof ExperienceInput)[];

const SHORT_LABELS = { organization: "소속·기관", role: "직무·역할" } as const;
const LONG_LABELS = {
  situation: "상황",
  actions: "본인이 한 일",
  result: "결과",
  notDone: "하지 않은 것",
  evidenceNote: "증빙·확인 메모",
} as const;

export const isMonth = (value: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(value);

export function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

export function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.flatMap((item) => text(item) ?? []))];
}

// 입력을 다듬고 검사한다. 오류 문구는 화면에 그대로 보여 준다.
export function validateExperience(
  input: unknown,
): { ok: true; value: ExperienceInput } | { ok: false; errors: ExperienceErrors } {
  const raw = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
  const errors: ExperienceErrors = {};

  const name = text(raw.name) ?? "";
  if (name === "") errors.name = "이름을 입력해 주세요";
  else if (name.length > LIMITS.shortText) errors.name = `이름은 ${LIMITS.shortText}자까지 쓸 수 있습니다`;

  const kind = KINDS.find((k) => k === raw.kind) ?? null;
  if (kind === null) errors.kind = "구분을 골라 주세요";

  const short = {} as Record<keyof typeof SHORT_LABELS, string | null>;
  for (const key of Object.keys(SHORT_LABELS) as (keyof typeof SHORT_LABELS)[]) {
    short[key] = text(raw[key]);
    if ((short[key]?.length ?? 0) > LIMITS.shortText) {
      errors[key] = `${SHORT_LABELS[key]}은(는) ${LIMITS.shortText}자까지 쓸 수 있습니다`;
    }
  }

  const long = {} as Record<keyof typeof LONG_LABELS, string | null>;
  for (const key of Object.keys(LONG_LABELS) as (keyof typeof LONG_LABELS)[]) {
    long[key] = text(raw[key]);
    if ((long[key]?.length ?? 0) > LIMITS.longText) {
      errors[key] = `${LONG_LABELS[key]}은(는) ${LIMITS.longText.toLocaleString("ko-KR")}자까지 쓸 수 있습니다`;
    }
  }

  const startMonth = text(raw.startMonth);
  if (startMonth !== null && !isMonth(startMonth)) errors.startMonth = "시작 월을 다시 확인해 주세요";

  // 자격은 취득 월 하나만 쓴다
  const isCertificate = kind === "certificate";
  const isOngoing = !isCertificate && raw.isOngoing === true;
  let endMonth = isCertificate || isOngoing ? null : text(raw.endMonth);
  if (endMonth !== null && !isMonth(endMonth)) {
    errors.endMonth = "끝 월을 다시 확인해 주세요";
    endMonth = null;
  } else if (endMonth !== null && startMonth !== null && !errors.startMonth && endMonth < startMonth) {
    errors.endMonth = "끝 월이 시작 월보다 앞섭니다";
  }

  const metrics: ExperienceInput["metrics"] = [];
  for (const item of Array.isArray(raw.metrics) ? raw.metrics : []) {
    const row = (typeof item === "object" && item !== null ? item : {}) as Record<string, unknown>;
    const metricText = text(row.text);
    if (metricText === null) continue; // 내용이 빈 줄은 버린다
    const basis = text(row.basis);
    if (metricText.length > LIMITS.longText || (basis?.length ?? 0) > LIMITS.longText) {
      errors.metrics = "수치 칸이 너무 깁니다";
    }
    metrics.push({ text: metricText, basis });
  }
  if (metrics.length > LIMITS.metrics) errors.metrics = `수치는 ${LIMITS.metrics}개까지 넣을 수 있습니다`;

  const tags = stringList(raw.tags);
  if (tags.length > LIMITS.tags) errors.tags = `태그는 ${LIMITS.tags}개까지 넣을 수 있습니다`;
  else if (tags.some((tag) => tag.length > LIMITS.tagLength)) errors.tags = `태그는 ${LIMITS.tagLength}자까지 쓸 수 있습니다`;

  const bannedPhrases = stringList(raw.bannedPhrases);
  if (bannedPhrases.length > LIMITS.bannedPhrases) {
    errors.bannedPhrases = `쓰면 안 되는 표현은 ${LIMITS.bannedPhrases}개까지 넣을 수 있습니다`;
  } else if (bannedPhrases.some((phrase) => phrase.length > LIMITS.shortText)) {
    errors.bannedPhrases = `쓰면 안 되는 표현은 ${LIMITS.shortText}자까지 쓸 수 있습니다`;
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      name,
      kind: kind!,
      organization: short.organization,
      role: short.role,
      startMonth,
      endMonth,
      isOngoing,
      situation: long.situation,
      actions: long.actions,
      result: long.result,
      metrics,
      notDone: long.notDone,
      bannedPhrases,
      evidenceNote: long.evidenceNote,
      tags,
    },
  };
}
