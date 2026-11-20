// applications 모듈이 저장하는 JSON의 모양. 타입만 둔다
import type { Kind } from "@/modules/experiences/options";

// 근거로 삼은 경험과, 그때의 내용 버전
export type SourceRef = { experienceId: string; contentVersion: number };
export type PickReason = SourceRef & { overlap: string; role: string }; // 겹치는 문구, 쓸 수 있는 본인 역할
export type PassedReason = SourceRef & { whyNot: string };
export type Selection = {
  questionVersion: number;
  picks: PickReason[];
  passed: PassedReason[];
  noMatch: boolean;
  selectedAt: string;
  approved: SourceRef[] | null;
  approvedAt: string | null;
};
export type Paragraph = { text: string; sources: string[]; edited: boolean }; // sources는 경험 id
export type Draft = {
  questionVersion: number;
  basedOn: SourceRef[];
  paragraphs: Paragraph[];
  shortage: string;
  writtenAt: string;
};

// 이력서. 항목마다 근거 경험이 하나다
export type ResumeDetail = "full" | "summary";
export type ResumeLine = { text: string; edited: boolean };
// period는 formatPeriod 결과. duties는 경력 머리의 담당 업무(없거나 비면 키를 두지 않는다)
export type ResumeHeading = { name: string; organization: string | null; role: string | null; period: string; duties?: string[] };
export type ResumeEntry = SourceRef & {
  kind: Kind;
  heading: ResumeHeading;
  detail: ResumeDetail;
  emphasized: boolean;
  lines: ResumeLine[];
  writtenAt: string;
};
export type ResumeContent = { entries: ResumeEntry[]; commonVersion: number | null }; // 맞춤본을 만들 때의 공통본 version. 공통본은 null
export type EmphasisPick = SourceRef & { why: string };
export type ResumeSelection = { picks: EmphasisPick[]; noMatch: boolean; selectedAt: string };

// 제출본. 제출하는 순간의 공고, 이력서, 답을 통째로 얼린 복사본이다
export type SubmittedPosting = { company: string; title: string; url: string | null; deadline: string | null; isRolling: boolean; rawText: string; companyNote: string | null };
export type SubmittedParagraph = { text: string; sources: { experienceId: string; name: string }[]; edited: boolean };
export type SubmittedAnswer = { prompt: string; charLimit: number | null; countSpaces: boolean; paragraphs: SubmittedParagraph[] }; // 답이 없으면 paragraphs는 []
export type SubmittedResume = { from: "tailored" | "common"; content: ResumeContent };
export type SubmissionContent = { posting: SubmittedPosting; resume: SubmittedResume | null; answers: SubmittedAnswer[] };
