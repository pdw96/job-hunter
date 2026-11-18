# 운영 DB 연결 오류 다시 보기 (원인 확인, 고치는 중)

**상태:** 원인 확인됨(2026-11-18, Neon 작업 기록). 아래 "고치는 방법"대로 구현한다.

**앞선 수정:** `docs/superpowers/plans/2026-11-17-db-connection-drops.md`. `@neondatabase/serverless`의 WebSocket 풀을 `pg` 풀과 `attachDatabasePool`로 바꿨다. 그 뒤에도 같은 증상이 났으므로, 그때 짐작한 원인(함수가 멈춘 사이 끊긴 연결)은 전부가 아니거나 틀렸다.

## 증상 (2026-11-18, 시각은 UTC)

배포 `dpl_7tABssZc2UX66FVVM9htJSUZ7kJx`(PR #20 시점, `pg` 풀 코드), 함수 지역 `icn1`, DB는 Neon `ap-southeast-1`의 풀러 주소(`ep-damp-morning-…-pooler`).

| 시각 | 일 |
|---|---|
| 05:57:04 ~ 05:58:06 | 요청 여러 건 정상(05:57:04에 새 함수가 뜸) |
| (5분 32초 동안 요청 없음) | |
| 06:03:38 | `GET /postings` 정상 기록(정적 껍데기일 수 있다) |
| 06:03:39 | `GET /`: 세션 조회 실패 여러 건. 원인 `Authentication timed out`(코드 `08P01`). 요청 시작 뒤 약 0.2초 만에 실패. 이어서 풀 `error` 경고 "DB 풀의 쉬던 연결이 끊겼습니다: Connection terminated unexpectedly" |
| 06:05:09 | `GET /admin`: 세션 조회 실패 7건. 원인 `Connection terminated unexpectedly`. 같은 함수가 다시 쓰였다(새로 뜬 표시 없음) |
| 06:10:48 ~ | 정상 |

- 실패는 모두 Better Auth의 세션 조회(`auth_session`, `auth_user` 조회)였다. 한 요청 안에서 세션 조회가 동시에 여러 번 일어나 실패 줄이 여러 개다
- 11-16 ~ 11-17에는 예전 드라이버로 `socket hang up`(ECONNRESET), `Connection terminated unexpectedly`가 흩어져 났다(08:20, 09:16, 09:26, 09:53, 15:43 등). Vercel 무료 요금제는 실행 기록을 1시간만 남겨서, 그 앞뒤 요청 간격은 볼 수 없다

## 짐작 (확인되지 않음)

1. **Neon이 5분 쉬면 DB를 멈춘다(scale to zero, 기본 5분).** 06:03의 실패는 5분 32초 쉰 직후, 연결을 맺는 인증 단계에서 났다. 깨어나는 동안 풀러가 인증을 시간 초과로 돌려준 것으로 보인다. 예전 드라이버의 흩어진 실패도 사용자가 한동안 쉬었다 돌아온 때일 수 있다
2. 06:05의 실패는 DB가 깨어난 지 90초 뒤라 1번만으로는 설명되지 않는다. 연결을 맺다가 끊긴 것인지, 풀에 남은 연결로 쿼리를 보내다 끊긴 것인지 기록으로는 가릴 수 없다(두 경우 모두 `pg`가 같은 문구를 낸다)

## 확인된 원인 (Neon 작업 기록, 프로젝트 `bold-resonance-64262985`, compute `ep-damp-morning-b3ytr18o`)

| 시각(UTC) | Neon | 앱 |
|---|---|---|
| 05:57:07 | `start_compute` | 요청 정상 |
| 06:03:32 | `suspend_compute`(5분 쉼) | |
| 06:03:39 | (멈춘 채, 시작 기록 없음) | `Authentication timed out` |
| 06:05:09 | | `Connection terminated unexpectedly` 7건 |
| 06:05:10 | `start_compute`(0.46초) | |
| 06:10:48 ~ | | 정상 |

- compute 설정은 `suspend_timeout_seconds: 0`(기본 5분), 0.25 CU 고정. 무료 요금제(Vercel이 관리하는 조직)
- 두 번의 실패 모두 compute가 멈춘 직후나 깨어나는 도중에 **연결을 맺다가** 났다. 깨어나는 데 0.4~0.5초가 걸리는데 앱은 다시 시도하지 않는다
- 앞선 계획의 짐작(함수가 멈춘 사이 쉬던 연결이 끊김)은 원인이 아니었다

## 고치는 방법

- `src/db/index.ts`의 풀에서 **연결을 맺는 단계**의 일시적인 실패만 짧게 기다렸다가 다시 시도한다(최대 2번, 0.5초 뒤와 1.5초 뒤). 쿼리를 보내기 전이라 쓰기가 두 번 되지 않는다
- 일시적인 실패: 코드 `08P01`, `57P01`, `57P03`, `ECONNRESET`, `ECONNREFUSED`, `ETIMEDOUT`, 또는 문구 `Connection terminated unexpectedly`, `timeout expired`, `Couldn't connect to compute node`. 비밀번호가 틀림(`28P01`) 같은 오류는 다시 시도하지 않는다
- 다시 시도할 때마다 오류 코드와 몇 번째인지를 경고로 남긴다(다음에 또 나면 기록으로 본다)
- 확인: 배포 뒤 5분 넘게 쉬었다가 첫 요청을 보내고, Neon 기록의 `start_compute` 시각과 Vercel 기록을 맞춰 본다

## 처음에 적은 다음 단계 (끝남)

1. Neon 도구로 이 프로젝트의 compute 설정(`suspend_timeout_seconds`, 자동 크기)과 2026-11-18 05:55~06:15 UTC의 작업 기록(compute 시작·멈춤)을 본다. 06:03 직전에 compute가 멈춰 있었고 06:03에 시작했는지, 06:05 무렵 다시 멈추거나 재시작했는지 확인한다
2. 1번이 맞으면 고칠 길(아직 정하지 않음):
   - 연결을 맺는 도중의 실패(쿼리를 보내기 전)는 짧게 기다렸다 한 번 더 시도하고, 실패 내용을 기록으로 남긴다(쓰기가 두 번 되지 않는다)
   - 한 요청 안에서 세션 조회가 여러 번 동시에 일어나지 않게 한다(요청마다 한 번만 읽기)
   - Neon의 scale to zero를 끄거나 늘리기(사용자가 Neon 콘솔에서 직접. 요금제에 따라 못 끌 수 있다)
3. 고친 뒤에는 5분 넘게 쉬었다가 첫 요청을 보내는 방식으로 실제 서비스에서 확인한다

## 구현하면서 달라진 점

- `src/db/connect-retry.ts`: `isTransientConnectError()`(위의 코드와 문구만 일시적인 실패로 본다)와 `connectWithRetry()`(기본 0.5초, 1.5초 뒤 최대 2번). 일시적이지 않은 오류는 바로 던지고, 다 실패하면 마지막 오류를 던진다. 다시 시도할 때 `DB 연결을 다시 시도합니다(1/2): 08P01 Authentication timed out`처럼 코드와 문구만 경고로 남긴다(연결 문자열은 남기지 않는다)
- `src/db/index.ts`: pg `Pool`을 이은 `RetryingPool`이 `connect`를 덮어써 약속 방식과 콜백 방식을 모두 받는다. pg-pool의 `query`는 안에서 `this.connect(콜백)`을 부르므로 drizzle의 일반 쿼리와 트랜잭션(`pool.connect()`)이 모두 다시 시도를 거친다. 쿼리를 보낸 뒤의 실패는 다시 보내지 않는다
- `attachDatabasePool`은 인스턴스의 `connect`를 한 겹 더 감싸고 `options.idleTimeoutMillis`(pg-pool이 기본 10000을 넣는다)를 보므로 그대로 동작한다. 감싼 쪽이 바깥, 다시 시도가 안쪽이다
- 시험: `connect-retry.test.ts`(분류표, 기다리는 간격, 마지막 오류, 경고 문구), `index.test.ts`(부모 `connect`를 바꿔 `pool.query`가 두 번 실패 뒤 쿼리를 한 번만 보내는지, Vercel에 맡긴 뒤 `pool.connect()`가 다시 시도하는지, `28P01`은 다시 시도하지 않는지, 실제로 거부되는 포트에서 두 번 다시 시도한 뒤 `ECONNREFUSED`를 내는지)
