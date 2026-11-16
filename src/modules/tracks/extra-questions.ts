// 분야(NCS 대분류)에 따라 더 묻는 질문. 질문 id와 답 value는 DB에 저장되므로 바꾸지 않는다.

export type ExtraQuestion = {
  id: string;
  label: string;
  options: { value: string; label: string }[];
};

const ABILITY = [
  { value: "yes", label: "가능" },
  { value: "no", label: "불가" },
  { value: "any", label: "상관없음" },
];

const QUESTIONS: (ExtraQuestion & { majors: string[] })[] = [
  {
    id: "shiftWork",
    label: "교대·야간 근무가 가능한가요?",
    options: ABILITY,
    // 보건ㆍ의료, 건설, 기계, 재료, 화학, 섬유ㆍ의복, 전기ㆍ전자, 식품가공, 인쇄ㆍ목재ㆍ가구ㆍ공예, 환경ㆍ에너지ㆍ안전
    majors: ["06", "14", "15", "16", "17", "18", "19", "21", "22", "23"],
  },
  {
    id: "fieldWork",
    label: "현장 근무(지방·해외 포함)가 가능한가요?",
    options: ABILITY,
    majors: ["14", "23"], // 건설, 환경ㆍ에너지ㆍ안전
  },
  {
    id: "remoteWork",
    label: "재택근무를 희망하나요?",
    options: [
      { value: "prefer", label: "희망" },
      { value: "any", label: "상관없음" },
      { value: "office", label: "출근 선호" },
    ],
    majors: ["20"], // 정보통신
  },
  {
    id: "weekendWork",
    label: "주말 근무가 가능한가요?",
    options: ABILITY,
    majors: ["10"], // 영업판매
  },
];

export function extraQuestionsFor(majorCode: string): ExtraQuestion[] {
  return QUESTIONS.filter((q) => q.majors.includes(majorCode)).map(({ id, label, options }) => ({
    id,
    label,
    options,
  }));
}
