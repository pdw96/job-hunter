// 프롬프트 점검의 한 줄. 점검은 준비한 예시를 실제 AI에 돌려, 기대한 결과가 나오는지와 말하지 않은 내용을 만들지 않는지 본다.
// 프롬프트나 모델을 바꿀 때 관리자 화면에서 다시 돌린다. 테스트는 가짜 AI를 쓰므로 이 품질은 테스트로 알 수 없다.
// 옛 경험 기록의 인터뷰 정리·가져오기 예시는 5-4에서 옛 메뉴를 닫으며 뺐고, 판정 예시는 장면 판정으로 옮겼다.
// 지금의 예시는 record-prompt-check.ts(새 기록 구조), postings·applications 모듈의 prompt-check에 있다.

export type CheckRow = { sample: string; check: string; expected: string; actual: string; pass: boolean };
