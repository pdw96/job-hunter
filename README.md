# Job Hunter

내 경험 기록을 먼저 쌓고, 그 기록만을 근거로 지원서를 쓰는 취업 지원 도우미.
초대받은 구글 계정만 쓸 수 있다.

- 설계: `docs/superpowers/specs/2026-11-16-job-hunter-design.md`
- 데이터 접근 규칙과 모듈 목록: [`docs/conventions.md`](docs/conventions.md)

## 환경 변수

값은 `.env.local`(로컬) 또는 Vercel 프로젝트 설정에 넣는다. 저장소에는 넣지 않는다.

| 이름 | 내용 |
|---|---|
| `DATABASE_URL` | Neon Postgres 접속 주소. Vercel에서 Neon을 연결하면 자동으로 들어간다 |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | 구글 OAuth 클라이언트. 리디렉션 URI는 `<주소>/api/auth/callback/google` |
| `BETTER_AUTH_SECRET` | 무작위 문자열 (`openssl rand -base64 32`) |
| `BETTER_AUTH_URL` | 앱 주소 (예: `https://job-hunter.vercel.app`) |
| `ADMIN_EMAIL` | 관리자 이메일 한 개. 허용 목록에 없어도 항상 들어올 수 있다 |

## 명령

| 명령 | 하는 일 |
|---|---|
| `npm run dev` | 개발 서버 |
| `npm test` | 테스트 (메모리 DB에 실제 마이그레이션을 적용해 실행, 외부 서비스 불필요) |
| `npm run db:generate` | 스키마를 바꾼 뒤 마이그레이션 파일 생성 |
| `npm run db:migrate` | 마이그레이션 적용 |
| `npm run build` | 빌드만 |

## 배포

Vercel이 `main`에 올라온 코드를 배포한다. 실제 배포(production)일 때만 `vercel-build` 스크립트가
마이그레이션을 먼저 적용한 뒤 빌드한다. PR 미리보기 배포는 DB를 바꾸지 않는다.
