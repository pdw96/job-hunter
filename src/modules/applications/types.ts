// applications 모듈이 저장하는 JSON의 모양. 타입만 둔다

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
