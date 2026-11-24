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
  customItem: 100, // 자유양식에 직접 더하는 항목 글자 수
  asks: 3, // 한 번에 묻는 질문
  askOptionsMin: 3, // 질문마다 선택지(AI에게 주는 범위)
  askOptions: 5,
  askQuestion: 200,
  askOption: 200,
  askPrevious: 2, // 질문마다 붙이는 지난 답(주제마다 최근 것)
  answer: 1000, // 답 하나의 글자 수
  answersPerQuestion: 6, // 문항 하나에 붙이는 답
} as const;

// 문항의 유형(여러 개일 수 있다)
export const QUESTION_KINDS = ["experience", "motive", "self"] as const;
export type QuestionKind = (typeof QUESTION_KINDS)[number];
export const QUESTION_KIND_LABELS: Record<QuestionKind, string> = { experience: "경험형", motive: "동기포부형", self: "자기소개형" };

// 답의 주제
export const ANSWER_TOPICS = ["motive", "aspiration", "growth", "personality", "values", "other"] as const;
export type AnswerTopic = (typeof ANSWER_TOPICS)[number];
export const ANSWER_TOPIC_LABELS: Record<AnswerTopic, string> = {
  motive: "지원동기",
  aspiration: "입사 후 포부",
  growth: "성장과정",
  personality: "성격의 장단점",
  values: "가치관",
  other: "기타",
};
// 주제가 속한 유형
export const TOPIC_KIND: Record<AnswerTopic, Exclude<QuestionKind, "experience">> = {
  motive: "motive",
  aspiration: "motive",
  growth: "self",
  personality: "self",
  values: "self",
  other: "self",
};
export const COMPANY_TOPICS: readonly AnswerTopic[] = ["motive", "aspiration"];

// 자유양식 항목(설계 5.4 순서)
export const FREEFORM_ITEMS: readonly { id: string; label: string; kinds: QuestionKind[]; topics: AnswerTopic[] }[] = [
  { id: "growth", label: "성장과정", kinds: ["self"], topics: ["growth"] },
  { id: "personality", label: "성격의 장단점", kinds: ["self"], topics: ["personality"] },
  { id: "motive", label: "지원동기", kinds: ["motive"], topics: ["motive"] },
  { id: "competence", label: "직무 역량·경험", kinds: ["experience"], topics: [] },
  { id: "aspiration", label: "입사 후 포부", kinds: ["motive"], topics: ["aspiration"] },
  { id: "values", label: "가치관·생활신조", kinds: ["self"], topics: ["values"] },
  { id: "teamwork", label: "협업 경험", kinds: ["experience"], topics: [] },
  { id: "hardship", label: "어려움을 극복한 경험", kinds: ["experience"], topics: [] },
];
export const FREEFORM_DEFAULT = ["motive", "competence", "aspiration"];
export const FREEFORM_CHAR_LIMIT = 800;


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

// 경력기술서의 한도. 줄 수·글자 수·강조 수는 RESUME_LIMITS를 쓴다
export const CAREER_LIMITS = {
  items: 30, // 공통본에 넣는 항목
  fullDone: 4, // 자세히 항목의 한 일 줄 수
  summaryDone: 2, // 요약 항목의 한 일 줄 수
  fullResults: 3, // 자세히 항목의 성과 줄 수
  summaryResults: 1, // 요약 항목의 성과 줄 수
} as const;
