import type { Kind } from "@/modules/experiences/options";

// 자기소개서 쓰기의 한도. 화면 검사와 저장 검사가 같은 값을 쓴다
export const APPLICATION_LIMITS = {
  questions: 10, // 공고당 문항
  prompt: 1000, // 문항 글 길이
  charLimitMin: 50,
  charLimitMax: 10000,
  picks: 3, // 한 문항에 고르는 경험
  passed: 5, // 후보로 밀린 경험
  approved: 5, // 승인한 경험
  paragraphs: 10,
  paragraph: 2000,
  reason: 300,
  note: 200,
  shortage: 500,
} as const;

// 이력서의 한도. 화면 검사와 저장 검사가 같은 값을 쓴다
export const RESUME_LIMITS = {
  entries: 40, // 공통본에 넣는 항목
  fullLines: 4, // 자세히 항목의 줄 수
  summaryLines: 2, // 요약 항목의 줄 수
  editLines: 8, // 직접 고쳐 늘릴 수 있는 줄 수
  line: 150, // 한 줄 글자 수
  emphasis: 5, // 맞춤본에서 강조하는 항목
  reason: 300, // 강조 이유
} as const;

// 이력서의 섹션 순서와 이름
export const RESUME_SECTIONS: { kind: Kind; label: string }[] = [
  { kind: "job", label: "경력" },
  { kind: "project", label: "프로젝트" },
  { kind: "training", label: "교육" },
  { kind: "school", label: "학력" },
  { kind: "certificate", label: "자격" },
  { kind: "other", label: "기타" },
  { kind: "gap", label: "공백기" },
];
