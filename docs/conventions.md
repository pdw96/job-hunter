# 데이터 접근 규칙

1. DB는 `src/modules/<모듈>/repo.ts`(또는 그 모듈의 다른 파일)의 함수로만 읽고 쓴다. 페이지와 서버 액션에서 쿼리를 직접 쓰지 않는다.
2. 사용자 데이터를 다루는 repo 함수의 첫 두 인자는 항상 `(db, userId)`이고, 모든 쿼리에 `userId` 조건이 들어간다.
3. `userId`는 서버에서 `requireUser()`로만 얻는다. 요청 본문, 폼, URL에서 받은 사용자 식별자는 쓰지 않는다. 레이아웃은 페이지 이동 때 다시 실행되지 않으므로 모든 페이지와 서버 액션이 `requireUser()`(관리 기능은 `requireAdmin()`)를 직접 부른다.
4. 사용자 데이터 테이블은 `auth_user(id)`를 `on delete cascade`로 참조하고, repo마다 "다른 사용자의 것은 읽히지 않는다" 테스트를 둔다.
5. 테이블은 모듈이 소유한다. 정의는 `src/modules/<모듈>/schema.ts`, 이름은 `<모듈>_<이름>`. 새 모듈을 만들면 `src/db/schema.ts`에 한 줄 추가한다.
6. 다른 모듈의 테이블을 직접 조회하지 않는다. 필요한 데이터는 그 모듈의 함수로 얻는다. 예외는 `auth_user(id)`를 가리키는 외래 키뿐이다.

## 모듈 목록

| 모듈 | 맡는 일 | 테이블 |
|---|---|---|
| `auth` | 구글 로그인 | `auth_user`, `auth_session`, `auth_account`, `auth_verification` |
| `access` | 허용 이메일, 가입·접근 판정 | `access_allowed_emails` |
| `profile` | 연락처 | `profile_contacts` |
