import type { Resume } from "@/modules/applications/resume-repo";
import { checkResume, type EntryCheck } from "@/modules/applications/resume-check";
import { RESUME_LIMITS } from "@/modules/applications/options";
import { resumeText, sections } from "@/modules/applications/resume-entries";
import type { ResumeEntry } from "@/modules/applications/types";
import type { ResumeSource } from "@/modules/experiences/writing";

// 서버 컴포넌트가 이력서를 지금의 경험으로 검사하고 섹션으로 묶어 ResumeEditor에 넘길 값을 만든다

export type EntryView = { entry: ResumeEntry; check: EntryCheck };
export type SectionView = { kind: string; label: string; entries: EntryView[] };
export type EditorData = {
  resumeId: string;
  version: number;
  sections: SectionView[];
  missing: { id: string; name: string }[]; // 넣을 수 있는데 이력서에 없는 경험
  commonChanged: boolean;
  full: boolean; // 이미 항목이 한도(40개)까지 찼다
  copyText: string;
};

// currentCommonVersion이 null이면 공통본, 숫자면 맞춤본
export function editorData(resume: Resume, sources: ResumeSource[], currentCommonVersion: number | null): EditorData | null {
  const content = resume.content;
  if (!content) return null;
  const check = checkResume(content, sources, currentCommonVersion);
  // 검사 결과는 content.entries와 같은 순서다. 섹션으로 묶을 때는 경험 id로 맞춘다
  const byId = new Map(content.entries.map((entry, index) => [entry.experienceId, check.entries[index]]));
  const names = new Map(sources.map((source) => [source.id, source.name]));
  return {
    resumeId: resume.id,
    version: resume.version,
    sections: sections(content).map((section) => ({
      kind: section.kind,
      label: section.label,
      entries: section.entries.map((entry) => ({ entry, check: byId.get(entry.experienceId)! })),
    })),
    missing: check.missing.map((id) => ({ id, name: names.get(id) ?? "" })),
    commonChanged: check.commonChanged,
    full: content.entries.length >= RESUME_LIMITS.entries,
    copyText: resumeText(content),
  };
}
