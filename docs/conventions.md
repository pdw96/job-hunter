# 데이터 접근 규칙

1. DB는 `src/modules/<모듈>/repo.ts`(또는 그 모듈의 다른 파일)의 함수로만 읽고 쓴다. 페이지와 서버 액션에서 쿼리를 직접 쓰지 않는다.
2. 사용자 데이터를 다루는 repo 함수의 첫 두 인자는 항상 `(db, userId)`이고, 모든 쿼리에 `userId` 조건이 들어간다.
3. `userId`는 서버에서 `requireUser()`로만 얻는다. 요청 본문, 폼, URL에서 받은 사용자 식별자는 쓰지 않는다. 레이아웃은 페이지 이동 때 다시 실행되지 않으므로 모든 페이지와 서버 액션이 `requireUser()`(관리 기능은 `requireAdmin()`)를 직접 부른다.
4. 사용자 데이터 테이블은 `auth_user(id)`를 `on delete cascade`로 참조하고, repo마다 "다른 사용자의 것은 읽히지 않는다" 테스트를 둔다.
5. 테이블은 모듈이 소유한다. 정의는 `src/modules/<모듈>/schema.ts`, 이름은 `<모듈>_<이름>`. 새 모듈을 만들면 `src/db/schema.ts`에 한 줄 추가한다.
6. 다른 모듈의 테이블을 직접 조회하지 않는다. 필요한 데이터는 그 모듈의 함수로 얻는다. 다른 모듈의 표를 가리키는 외래 키는 둘 수 있다(예: `auth_user(id)`, `ncs_categories(code)`, `tracks_tracks(id)`).

## 모듈 목록

| 모듈 | 맡는 일 | 테이블 |
|---|---|---|
| `auth` | 구글 로그인 | `auth_user`, `auth_session`, `auth_account`, `auth_verification` |
| `access` | 허용 이메일, 가입·접근 판정 | `access_allowed_emails` |
| `profile` | 연락처 | `profile_contacts` |
| `ncs` | NCS 직무 분류와 별칭 (모든 사용자가 함께 쓰는 기준 데이터, `userId` 없음) | `ncs_categories`, `ncs_aliases` |
| `tracks` | 트랙, 설문 규칙, 희망 조건과 채점 배점 | `tracks_tracks`, `tracks_jobs` |
| `experiences` | 경험 기록: 이력 사실(학력·교육 과정·경력·공백·자격·프로젝트·활동)과 사례(장면), 사례의 검증 규칙(루브릭과 검증 상태), 트랙별 사용 범위, AI 판정, 사례 인터뷰, 가져오기와 주장별 확인, 옛 기록을 새 구조로 옮기기, 자소서·이력서·채점·제출에 주는 원천(`sources.ts`). 옛 기록 표는 옮기기가 읽기만 한다(5-4부터 쓰지 않음) | 이력 사실 `experiences_education`, `experiences_courses`, `experiences_jobs`, `experiences_gaps`, `experiences_credentials`, `experiences_projects`, `experiences_activities` / 사례 `experiences_scenes` / 주장 `experiences_record_claims` / 옮기기 `experiences_moves` / 사례 인터뷰 `experiences_interviews` / 옛 기록(읽기만) `experiences_experiences`, `experiences_track_scopes`, `experiences_claims` |
| `postings` | 채용 공고, 공고에서 값 뽑기(붙여 넣기·주소·그림), 제외 조건, 요구 사항과 점수, 회사 조사(인재상·소식, 사용자·회사 단위) | `postings_postings`, `postings_research` |
| `applications` | 자기소개서 문항, 고른 경험, 쓴 답, 지원자의 답(묻기), 이력서 공통본·맞춤본, 제출본 | `applications_questions`, `applications_answers`, `applications_resumes`, `applications_submissions` |
| `ai` | Claude API 호출, 사용량 기록과 월 한도, 보내기 전 연락처 가리기 | `ai_usage` |

## AI 사용 규칙

1. Claude API는 `src/modules/ai/anthropic-client.ts`에서만 부른다. 다른 모듈은 `AiClient`를 인자로 받고, 호출은 반드시 `runAi()`를 거친다(한도 검사, 연락처 가리기, 사용량 기록).
2. AI에게 보내지 않는 것: `profile` 모듈의 연락처, 이메일, 사용자 id, 로그인 이름.
3. AI가 돌려준 내용은 코드가 검사한 뒤에만 저장한다. AI가 만든 기록은 항상 미확인이고, AI 판정은 본인 확인을 바꾸지 않는다.
4. 시간이 걸리는 AI 작업의 결과는 읽었을 때의 내용 그대로일 때만 반영한다(`contentVersion`).
5. 테스트는 `createFakeAi()`를 쓴다. 실제 API를 부르는 테스트를 두지 않는다.
