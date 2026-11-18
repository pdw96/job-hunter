import { numbersIn } from "@/modules/experiences/grounding";
import type { ResumeSource } from "@/modules/experiences/writing";
import { knownNumbers } from "./check";
import { detailFor } from "./resume-entries";
import type { ResumeContent } from "./types";

// 이력서를 코드로 검사한다. 표시할 뿐 저장과 복사는 막지 않는다. 화면과 DB를 모르는 순수 함수

export type EntryCheck = { unavailable: boolean; stale: boolean; scopeChanged: boolean; banned: string[]; ungrounded: string[] };
export type ResumeCheck = { entries: EntryCheck[]; missing: string[]; commonChanged: boolean };

const squash = (text: string) => text.replace(/\s+/g, "").toLowerCase();

// currentCommonVersion이 null이면 공통본, 숫자면 맞춤본
export function checkResume(content: ResumeContent, sources: ResumeSource[], currentCommonVersion: number | null): ResumeCheck {
  const byId = new Map(sources.map((source) => [source.id, source]));
  const isCommon = currentCommonVersion === null;

  const entries = content.entries.map((entry): EntryCheck => {
    const current = byId.get(entry.experienceId);
    if (!current) return { unavailable: true, stale: false, scopeChanged: false, banned: [], ungrounded: [] };

    const squashed = squash(entry.lines.map((line) => line.text).join("\n"));
    const banned = [...new Set(current.bannedPhrases)].filter((phrase) => squash(phrase) !== "" && squashed.includes(squash(phrase)));

    const known = new Set(knownNumbers(current));
    const ungrounded = [
      ...new Set(entry.lines.filter((line) => !line.edited).flatMap((line) => numbersIn(line.text)).filter((n) => !known.has(n))),
    ];

    return {
      unavailable: false,
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
