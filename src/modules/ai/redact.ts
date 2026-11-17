// AI에게 보내기 전에 글에 섞인 연락처를 가린다. 완벽하지 않다(형태가 다른 번호나 주소는 못 잡는다).

const PATTERNS: [RegExp, string][] = [
  [/\b\d{6}\s?-\s?[1-4]\d{6}\b/g, "[주민등록번호]"],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+/g, "[이메일]"],
  [/\+82[-.\s]?\d{1,2}[-.\s]?\d{3,4}[-.\s]?\d{4}\b/g, "[전화번호]"],
  // 0으로 시작하는 국내 번호: 010-1234-5678, 01012345678, 02-123-4567
  [/\b0\d{1,2}[-.\s]?\d{3,4}[-.\s]?\d{4}\b/g, "[전화번호]"],
];

export function redactContacts(text: string): string {
  return PATTERNS.reduce((result, [pattern, label]) => result.replace(pattern, label), text);
}
