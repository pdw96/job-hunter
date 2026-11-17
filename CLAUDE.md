# Job Hunter 작업 안내

사용자와 지인 몇 명이 쓰는 한국어 취업 지원 도우미. 먼저 사용자의 실제 경험을 확인된 기록으로 쌓고, AI는 그 기록에 있는 것만으로 지원서를 쓴다.

한 세션으로 이어 간다. 다른 세션이 이어받을 때는 이 파일과 `docs/`만 보고 `docs/status.md`의 다음 할 일부터 한다.

## 일하는 방식

- 답은 한국어로, 짧게, 핵심만 쓴다. 물을 때는 한 번에 하나만, 번호 붙인 선택지로 묻는다. 선택지 끝에 늘 `기타 (짧게 적기)`를 둔다
- 순서: 계획 → TDD 구현 → PR → 검토 → 합치기 → 배포 확인. 단계마다 멈출지는 `docs/decision-rubrics.md`로 채점해 정한다
- 계획 문서는 `docs/superpowers/plans/`에 둔다. 구현하다 달라진 점과 검토에서 고친 것은 그 문서 끝에 적는다
- `main`에 합치면 실제 서비스에 배포된다. AI가 합쳐도 되는지는 `docs/decision-rubrics.md`의 ②를 따른다
- 화면을 바꾸면 로컬 미리보기로 확인하고 사진을 사용자에게 보낸다
- 사용자는 타자를 많이 치는 것을 싫어한다. 입력을 줄이는 쪽으로 만든다

## 지켜야 할 것

- 비밀 값은 사용자가 Vercel이나 콘솔 화면에 직접 넣는다. 대화에 붙여 넣게 하지 않고, 저장소에 넣지 않는다
- 연락처(전화번호, 주소, 생년월일)는 따로 저장하고 AI에 보내지 않는다
- AI 호출은 모두 `runAi()`를 거친다. 모델은 `claude-sonnet-5-5`
- 가져온 자료(노션 등)는 AI가 쓴 것이므로 "확인이 필요한 주장"으로 다룬다
- 테이블은 모듈이 갖고, 이름은 `<모듈>_<이름>`이다. 자세한 규칙은 `docs/conventions.md`
- 주소로 공고를 읽는 기능은 사용자가 넣은 주소 하나만 연다. 대신 로그인하지 않고, 내부망 주소는 열지 않는다
- 사용자의 개인 자료(노션 내보내기 등)는 세션 안에서만 쓰고 커밋하지 않는다

## 개발 메모

- Next.js 16은 학습 자료와 다르다. 코드를 쓰기 전에 `node_modules/next/dist/docs/`를 읽는다(`AGENTS.md`)
- 확인: `npm test`(2분쯤 걸린다), `npx tsc --noEmit`, `npm run lint`. PR마다 GitHub Actions(`.github/workflows/check.yml`)가 같은 검사를 돌린다
- 파일을 고치면 옆의 테스트(`x.ts` → `x.test.ts`)가 자동으로 돈다(`.claude/hooks/related-test.sh`). 전체 테스트는 올리기 전에 돌린다
- 올릴 때의 순서는 `/ship`(`.claude/skills/ship/SKILL.md`)에 있다
- 로컬 미리보기: `LOCAL_PREVIEW=1 npx next build` 뒤 `LOCAL_PREVIEW=1 npx next start -p 3210`을 백그라운드로 띄운다. DB, 로그인, AI, 페이지 읽기가 `src/dev/local-*.ts`의 가짜로 바뀐다
- 테스트의 DB는 PGlite에 실제 마이그레이션을 적용한다(`createTestDb()`)
- 배포: Vercel이 `main`에서 배포하고, 실제 서비스 빌드에서만 마이그레이션을 적용한다. 주소는 https://job-hunter-six-nu.vercel.app
- 작업 환경에서는 채용 사이트에 직접 접속할 수 없다. 사이트 구조 확인은 판단표 ⑤를 따른다

## 지금 상태

끝난 것, 다음 할 일, 남은 확인은 `docs/status.md`에 있다. 계획 하나가 끝날 때마다 그 파일을 고치고 판단표를 점검한다.
