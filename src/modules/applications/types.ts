// applications 모듈이 저장하는 JSON의 모양. 타입만 둔다
import type { Kind } from "@/modules/experiences/options";
import type { CompanyFact } from "@/modules/postings/research";
import type { AnswerTopic } from "./options";

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
// sources는 경험 id, answers는 근거로 삼은 지원자의 답(applications_answers) id, company는 쓴 회사 정보(CompanyFact) id.
// 옛 답에는 answers·company가 없다(빈 배열로 본다)
export type Paragraph = { text: string; sources: string[]; answers?: string[]; company?: string[]; edited: boolean };
export type Draft = {
  questionVersion: number;
  basedOn: SourceRef[];
  paragraphs: Paragraph[];
  shortage: string;
  answers?: string[]; // 쓸 때 AI에 보낸 답 id. 옛 답에는 없다
  companyFacts?: CompanyFact[]; // 쓸 때 AI에 보낸 회사 정보의 복사본(고치기도 이것을 보낸다). 옛 답에는 없다
  writtenAt: string;
};

// 묻기. 쓰기 전에 동기·포부 같은 재료를 고를 수 있는 질문으로 묻는다
export type PreviousAnswer = { answerId: string; text: string; label: string }; // label: "삼성전자 · 2026-11"
export type AskItem = { id: string; topic: AnswerTopic; link: string; question: string; options: string[]; previous: PreviousAnswer[] }; // id: 질문을 만들 때 붙인 고유 값(답할 때 이 값으로 가리킨다). link: 연결고리 한 줄(없으면 빈 글)
// companyKey: 질문을 만들 때 공고 회사 이름의 정리 값. 그 뒤 회사 이름을 바꾸면 이 질문으로 답을 저장하지 않는다(옛 질문에는 없다)
export type Asks = { questionVersion: number; items: AskItem[]; madeAt: string; companyKey?: string };

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

// 경력기술서. 회사(경력) 아래에 항목(사례·프로젝트)이 있다
export type CareerItemHeading = { name: string; role: string | null; period: string; tools: string[] };
// experienceId: 사례 id 또는 프로젝트 id
export type CareerItem = SourceRef & {
  kind: "scene" | "project";
  heading: CareerItemHeading;
  detail: ResumeDetail;
  emphasized: boolean;
  done: ResumeLine[];
  results: ResumeLine[];
  writtenAt: string;
};
export type CareerCompanyHeading = { company: string; department: string | null; title: string | null; period: string; duties: string[] };
// experienceId: 경력 id
export type CareerCompany = SourceRef & { heading: CareerCompanyHeading; items: CareerItem[] };
export type CareerContent = { companies: CareerCompany[]; commonVersion: number | null }; // 맞춤본을 만들 때의 공통본 version. 공통본은 null
export type CareerSelection = ResumeSelection; // picks의 experienceId는 항목 id

// 제출본. 제출하는 순간의 공고, 이력서, 답을 통째로 얼린 복사본이다
export type SubmittedPosting = { company: string; title: string; url: string | null; deadline: string | null; isRolling: boolean; rawText: string; companyNote: string | null };
export type SubmittedParagraph = { text: string; sources: { experienceId: string; name: string }[]; edited: boolean };
export type SubmittedAnswer = { prompt: string; charLimit: number | null; countSpaces: boolean; paragraphs: SubmittedParagraph[] }; // 답이 없으면 paragraphs는 []
export type SubmittedResume = { from: "tailored" | "common"; content: ResumeContent };
export type SubmissionContent = { posting: SubmittedPosting; resume: SubmittedResume | null; answers: SubmittedAnswer[] };
