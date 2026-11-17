# DB 연결 끊김 고치기 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 실제 서비스에서 세션 조회가 DB 연결 끊김(`socket hang up`, `Connection terminated unexpectedly`)으로 실패하는 것을 없앤다.

**원인:** `src/db/index.ts`가 `@neondatabase/serverless`의 `Pool`(WebSocket)을 모듈 맨 위에 만들어 모든 요청이 같이 쓴다. Vercel이 요청 사이에 함수를 멈추는 동안 쉬던 연결이 끊기고, 풀은 다음 요청에 끊긴 연결을 내준다. Neon 문서는 이 드라이버의 풀을 요청 사이에 다시 쓰지 말라고 하고, Vercel에서는 `pg` + `@vercel/functions`의 `attachDatabasePool`을 권한다(쉬는 연결을 함수가 멈추기 전에 정리한다). 2026-11-16~17에 사용자 2명, 약 50번.

**Architecture:** `src/db/index.ts`만 `pg`의 `Pool` + `drizzle-orm/node-postgres`로 바꾸고 `attachDatabasePool(pool)`을 부른다. `Db` 타입, 테스트 DB(PGlite), 로컬 미리보기는 그대로다.

**Tech Stack:** `pg` 8, `@vercel/functions` 3, drizzle-orm 0.45

**Spec:** 없음(버그 수정). 방법은 사용자가 2026-11-17에 골랐다(1번: `pg` + `attachDatabasePool`)

## Global Constraints

- 바꾸는 코드는 `src/db/index.ts` 하나. 쓰지 않게 되는 `@neondatabase/serverless`, `ws`, `@types/ws`는 뺀다
- Better Auth가 트랜잭션을 쓰므로 풀 방식을 유지한다
- 빌드할 때 DB에 접속하지 않는다(`pg`의 `Pool`도 첫 쿼리 때 연결한다)

## Review Focus

1. **마이그레이션 드라이버가 바뀐다.** drizzle-kit은 `pg`가 설치돼 있으면 `@neondatabase/serverless`보다 먼저 고른다(`bin.cjs`에서 확인). 실제 서비스 빌드의 `drizzle-kit migrate`가 WebSocket 대신 TCP로 `DATABASE_URL_UNPOOLED`에 붙는다. Neon 주소에는 `sslmode=require`가 들어 있어 그대로 된다. 합친 뒤 빌드 기록에서 마이그레이션 단계가 성공했는지 본다(판단표 ④)
2. **풀의 `error` 이벤트.** `pg`는 쉬던 연결이 끊기면 풀에서 `error`를 낸다. 듣는 쪽이 없으면 프로세스가 죽는다. `attachDatabasePool`이 이것을 처리하는지 Task 1 Step 3에서 `@vercel/functions`의 코드로 확인한다

---

### Task 1: 운영 DB 연결을 `pg` + `attachDatabasePool`로

**Files:**
- Modify: `src/db/index.ts`
- Create: `src/db/index.test.ts`
- Modify: `package.json`, `package-lock.json`

- [x] **Step 1: 실패하는 테스트**

`src/db/index.test.ts`: `@vercel/functions`를 `vi.mock`으로 바꿔 `attachDatabasePool`이 불린 인자를 잡는다. `DATABASE_URL`을 가짜 주소로 둔 뒤 `./index`를 불러온다.
- `attachDatabasePool`이 한 번 불리고, 인자가 `pg`의 `Pool` 인스턴스다
- `db`가 있고 `db.transaction`이 함수다
- 불러오는 동안 DB에 접속하지 않는다(가짜 주소라 접속하면 실패한다)

- [x] **Step 2: 테스트가 실패하는지 본다**

Run: `npx vitest run src/db/index.test.ts`
Expected: FAIL (`attachDatabasePool`이 불리지 않는다)

- [x] **Step 3: `src/db/index.ts`를 고친다**

`new Pool({ connectionString: process.env.DATABASE_URL })`(`pg`), `attachDatabasePool(pool)`, `export const db: Db = drizzle({ client: pool, schema })`(`drizzle-orm/node-postgres`). 주석에 왜 이 방식인지 적는다. `attachDatabasePool`이 풀의 `error`를 듣는지 `node_modules/@vercel/functions`에서 확인하고, 듣지 않으면 `pool.on("error", ...)`로 기록만 한다.

- [x] **Step 4: 테스트가 통과하는지 본다**

Run: `npx vitest run src/db/index.test.ts`
Expected: PASS

- [x] **Step 5: 전체 확인 뒤 커밋**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: 모두 통과

## 구현하면서 달라진 점

- `@vercel/functions`의 `attachDatabasePool`은 함수가 멈추기 전에 쉬는 연결이 정리될 때까지 기다리게만 하고, 풀의 `error`는 듣지 않는다(`db-connections/index.js`에서 확인). 그래서 `pool.on("error", ...)`로 기록만 하게 했다. 이것을 빼면 테스트가 "Connection terminated unexpectedly" 예외로 실패하는 것을 확인했다
- 쓰지 않게 된 `@neondatabase/serverless`, `ws`, `@types/ws`를 뺐다. drizzle-kit은 이제 `pg`로 마이그레이션한다
- 확인: `npx tsc --noEmit`, `npm run lint`, `npm test`(35파일 337개) 통과
