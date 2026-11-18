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
