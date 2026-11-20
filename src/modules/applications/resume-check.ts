import { numbersIn } from "@/modules/experiences/grounding";
import type { ResumeSource } from "@/modules/experiences/sources";
import { type CheckOptions, knownNumbers } from "./check";
import { detailFor } from "./resume-entries";
import type { ResumeContent } from "./types";

// 이력서를 코드로 검사한다. 표시할 뿐 저장과 복사는 막지 않는다. 화면과 DB를 모르는 순수 함수

// structureChanged: 항목이 옛 표(바꾸기 전 경험 기록)의 id라 새 구조로 다시 만들어야 한다
export type EntryCheck = { unavailable: boolean; structureChanged: boolean; empty: boolean; stale: boolean; scopeChanged: boolean; banned: string[]; ungrounded: string[] };
export type ResumeCheck = { entries: EntryCheck[]; missing: string[]; commonChanged: boolean };

const squash = (text: string) => text.replace(/\s+/g, "").toLowerCase();

// currentCommonVersion이 null이면 공통본, 숫자면 맞춤본
export function checkResume(
  content: ResumeContent,
  sources: ResumeSource[],
  currentCommonVersion: number | null,
  options: CheckOptions = {},
): ResumeCheck {
  const oldIds = options.oldIds ?? new Set<string>();
  const byId = new Map(sources.map((source) => [source.id, source]));
  const isCommon = currentCommonVersion === null;

  const entries = content.entries.map((entry): EntryCheck => {
    const none = { unavailable: false, structureChanged: false, empty: false, stale: false, scopeChanged: false, banned: [], ungrounded: [] };
    if (oldIds.has(entry.experienceId)) return { ...none, structureChanged: true };
    const current = byId.get(entry.experienceId);
    if (!current) return { ...none, unavailable: true };

    const squashed = squash(entry.lines.map((line) => line.text).join("\n"));
    const banned = [...new Set(current.bannedPhrases)].filter((phrase) => squash(phrase) !== "" && squashed.includes(squash(phrase)));

    // 코드 줄(이력 사실)의 숫자도 기록에 있는 숫자다
    const known = new Set([...knownNumbers(current), ...(current.codeLines ?? []).flatMap(numbersIn)]);
    const ungrounded = [
      ...new Set(entry.lines.filter((line) => !line.edited).flatMap((line) => numbersIn(line.text)).filter((n) => !known.has(n))),
    ];

    return {
      unavailable: false,
      structureChanged: false,
      // 코드 줄 원천은 다시 써도 같은 줄이라 빈 줄을 표시하지 않는다
      empty:
        entry.detail === "full" &&
        entry.kind !== "school" &&
        entry.kind !== "certificate" &&
        current.codeLines === undefined &&
        entry.lines.length === 0,
      stale: entry.contentVersion !== current.contentVersion,
      scopeChanged: isCommon && entry.detail !== detailFor(current.scope),
      banned,
      ungrounded,
    };
  });

  const present = new Set(content.entries.map((entry) => entry.experienceId));
  return {
    entries,
    missing: sources.filter((source) => !present.has(source.id)).map((source) => source.id),
    commonChanged: !isCommon && content.commonVersion !== currentCommonVersion,
  };
}
