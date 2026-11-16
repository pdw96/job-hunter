# Job Hunter 2번 계획: 설문과 트랙 (NCS 분류 · 검색 · 의존 동작) Implementation Plan

**Goal:** 처음 로그인한 사용자가 설문을 마치면 첫 트랙과 그 트랙의 희망 조건·채점 배점이 만들어진다. 직무는 NCS 분류에서 단계별 선택과 검색으로 고른다. 트랙을 더 만들 수 있고, 설문을 다시 열어 고칠 수 있다.

**Architecture:** 1번 계획의 모듈 구조를 그대로 따른다(`docs/conventions.md`). 모듈을 둘 추가한다. `ncs`는 모든 사용자가 함께 쓰는 기준 데이터(분류, 별칭)이고, `tracks`는 사용자 데이터(트랙, 트랙의 직무)다. 설문의 판단 규칙(어떤 문항을 묻는지, 입력이 올바른지, 순서를 배점으로 바꾸는 식)은 화면과 분리된 순수 함수로 두고 테스트한다. 이 계획에는 AI 호출이 없다.

**Tech Stack:** 1번과 같다. 새 라이브러리는 없다.

**Spec:** `docs/superpowers/specs/2026-11-16-job-hunter-design.md` 6.2, 8장의 2단계

## 확인된 것: NCS 데이터

설계 6.2의 "미확인" 항목을 확인했다.

- 공공데이터포털의 NCS 분류 파일을 쓴다. 이용허락범위 제한 없음, 무료. 출처와 가공 방법은 `data/ncs/README.md`
- 분류 4단계 1,201건을 `data/ncs/categories.csv`에 저장했다: 대분류 24, 중분류 79, 소분류 231, 세분류 867. 상위가 없는 코드는 없다
- 설계의 "직무"는 NCS의 **세분류**다(예: `02010101 경영기획`, `20010202 응용SW엔지니어링`)
- 세분류 이름이 겹치는 것이 5개 있다(예: 직업상담). 검색 결과에는 항상 상위 분류 경로를 함께 보여 준다

## Global Constraints

- 1번 계획의 Global Constraints와 `docs/conventions.md`를 모두 따른다
- 사용자 데이터 함수의 첫 두 인자는 `(db, userId)`. 트랙을 `trackId`로 읽거나 고칠 때도 반드시 `userId` 조건을 함께 건다
- `tracks` 모듈은 `ncs` 테이블을 직접 조회하지 않는다. `ncs` 모듈의 함수를 쓴다. 외래 키는 둘 수 있다
- 표 구조를 바꾸는 PR의 미리보기 배포는 DB를 바꾸지 않는다(1번에서 설정). 실제 DB에는 `main`에 합칠 때 적용된다
- Next.js 코드를 쓰기 전에 `node_modules/next/dist/docs/`의 해당 문서를 읽는다(`AGENTS.md`)
- 커밋과 배포는 사용자 확인을 받은 뒤에 한다

## 빌더가 정한 것 (사용자가 바꿀 수 있음)

| 항목 | 정한 내용 |
|---|---|
| 단계별 선택 | 대분류 → 중분류 → 직무 3단계. 직무 목록은 소분류 이름으로 묶어서 보여 준다(NCS는 4단계지만 클릭을 줄인다) |
| 직무 개수 | 트랙당 1~5개 |
| NCS에 없는 직무 | 직접 입력(이름만). 대분류는 반드시 고른다 |
| 순서 → 배점 | 중요도 1~5위가 30 / 25 / 20 / 15 / 10점. 합계 100 |
| 지역 | 17개 시도 + "전국 어디든". 고른 순서가 선호 순서. 1~5개 |
| 고용 형태 | 정규직 / 계약직 / 인턴 / 무관 (여러 개) |
| 희망 연봉 | 최소 금액(만원). 비워 둘 수 있다 |
| 일한 기간 | 년, 개월. 지원 유형이 경력이면 필수, 무관이면 선택, 신입·인턴이면 묻지 않는다 |
| 트랙 이름 | 첫 직무 이름으로 자동 생성. 설문 마지막에 고칠 수 있다 |
| 분야별 추가 질문 | 아래 표. 코드 안의 데이터로 관리한다 |
| 설문 중 임시 저장 | 없다. 마지막 단계에서 한 번에 저장한다 |
| 트랙 삭제 | 이번에 만들지 않는다(3번 계획 이후 트랙에 딸린 데이터가 생기면 함께 설계) |

**분야별 추가 질문 초기 목록**

| 대분류 | 질문 | 답 |
|---|---|---|
| 14 건설, 15 기계, 16 재료, 17 화학, 18 섬유ㆍ의복, 19 전기ㆍ전자, 21 식품가공, 22 인쇄ㆍ목재ㆍ가구ㆍ공예, 23 환경ㆍ에너지ㆍ안전 | 교대·야간 근무가 가능한가요? | 가능 / 불가 / 상관없음 |
| 14 건설, 23 환경ㆍ에너지ㆍ안전 | 현장 근무(지방·해외 포함)가 가능한가요? | 가능 / 불가 / 상관없음 |
| 20 정보통신 | 재택근무를 희망하나요? | 희망 / 상관없음 / 출근 선호 |
| 06 보건ㆍ의료 | 교대·야간 근무가 가능한가요? | 가능 / 불가 / 상관없음 |
| 10 영업판매 | 주말 근무가 가능한가요? | 가능 / 불가 / 상관없음 |

---

### Task 1: NCS 분류 테이블과 데이터 넣기

**Files:**
- Create: `src/modules/ncs/schema.ts`, `scripts/build-ncs-migration.ts`, `drizzle/NNNN_ncs_seed.sql`(생성물), `src/modules/ncs/seed.test.ts`
- Modify: `src/db/schema.ts`, `package.json`

**Interfaces:**
- 테이블 `ncs_categories`: `code text primary key`(2·4·6·8자리), `level integer not null`(1~4), `name text not null`, `parentCode text null references ncs_categories(code)`. `parentCode`에 인덱스
- 테이블 `ncs_aliases`: `alias text not null`, `code text not null references ncs_categories(code)`, 기본 키 `(alias, code)`
- npm 스크립트 `ncs:build` — `data/ncs/categories.csv`와 `data/ncs/aliases.csv`를 읽어 데이터 넣는 마이그레이션 SQL을 만든다

- [ ] **Step 1: 실패하는 테스트** — `createTestDb()` 후: 단계별 개수가 24 / 79 / 231 / 867, 2단계 이상은 모두 `parentCode`가 있고 그 코드가 존재, `02010101`의 이름은 `경영기획`이고 상위는 `020101`
- [ ] **Step 2: 실패 확인**
- [ ] **Step 3: 스키마 작성, `npm run db:generate`**
- [ ] **Step 4: 데이터 마이그레이션 생성** — `npx drizzle-kit generate --custom --name ncs_seed`로 빈 마이그레이션을 만들고, `ncs:build` 스크립트가 그 파일에 `insert` 문을 채운다(상위가 먼저 들어가도록 코드 순). 다시 실행해도 같은 결과가 나와야 한다
- [ ] **Step 5: 통과 확인, Commit** `feat: NCS 분류 테이블과 데이터`

---

### Task 2: NCS 조회와 검색

**Files:**
- Create: `data/ncs/aliases.csv`, `src/modules/ncs/repo.ts`, `src/modules/ncs/repo.test.ts`
- Modify: `drizzle/`(별칭이 들어간 seed 다시 생성)

**Interfaces** (모두 `src/modules/ncs/repo.ts`. 기준 데이터라 `userId`가 없다):
- `type NcsNode = { code: string; level: number; name: string }`
- `type NcsJob = { code: string; name: string; path: [NcsNode, NcsNode, NcsNode] }` — 세분류와 그 상위(대, 중, 소)
- `listMajors(db): Promise<NcsNode[]>` — 대분류 24개, 코드 순
- `listChildren(db, parentCode): Promise<NcsNode[]>`
- `listJobsUnder(db, middleCode): Promise<{ group: NcsNode; jobs: NcsNode[] }[]>` — 중분류 아래의 세분류를 소분류별로 묶음
- `getJobs(db, codes: string[]): Promise<NcsJob[]>` — 세분류가 아닌 코드나 없는 코드는 결과에서 빠진다
- `searchJobs(db, query: string, limit = 20): Promise<NcsJob[]>`
  - 앞뒤 공백을 지우고, 2글자 미만이면 빈 배열
  - 세분류 이름에 검색어가 들어 있거나, 별칭이 검색어와 같거나 검색어로 시작하면 찾는다. 영문 대소문자는 구분하지 않는다
  - 순서: 별칭이 정확히 일치 → 이름이 검색어로 시작 → 이름에 포함. 같은 순위 안에서는 코드 순
  - 검색어 안의 `%`, `_`는 글자 그대로 취급한다

**별칭 초기 목록** (`data/ncs/aliases.csv`, 칸은 `alias,code`): 흔히 쓰는 직무 이름 40개 안팎을 넣는다. 예: 백엔드·프론트엔드·개발자 → `20010202 응용SW엔지니어링`, 데이터분석 → `20010105 빅데이터기획ㆍ분석`, HR·인사담당 → `02020201 인사`, 재무·회계 → `02030201 회계ㆍ감사`. 각 별칭의 코드는 작성할 때 `categories.csv`에서 직접 확인한다. 맞는 세분류가 분명하지 않은 이름(예: PM, MD)은 가장 가까운 것을 고르고 주석 대신 PR 설명에 적는다.

- [ ] **Step 1: 실패하는 테스트**
  - `listMajors` 24개, 첫 번째는 `01 사업관리`
  - `listJobsUnder(db, "0201")`에 `경영기획`이 들어 있고 묶음 이름이 소분류 이름
  - `searchJobs(db, "경영기획")`의 첫 결과가 `02010101`, `path`가 `[02, 0201, 020101]`
  - `searchJobs(db, "백엔드")`에 `20010202`가 들어 있다(별칭)
  - `searchJobs(db, "sw")`가 `SW제품기획` 등을 찾는다(대소문자)
  - `searchJobs(db, "기")`는 빈 배열, `searchJobs(db, "%")`도 빈 배열
  - 이름이 겹치는 `직업상담`을 검색하면 2건이고 `path`가 서로 다르다
  - 별칭 파일의 모든 코드가 4단계 세분류로 존재한다
  - `getJobs(db, ["02010101", "0201", "99999999"])`는 1건
- [ ] **Step 2: 실패 확인**
- [ ] **Step 3: 구현, 별칭 작성, seed 다시 생성**
- [ ] **Step 4: 통과 확인, Commit** `feat: NCS 조회와 검색, 별칭`

---

### Task 3: 설문 규칙 (순수 함수)

**Files:**
- Create: `src/modules/tracks/survey.ts`, `src/modules/tracks/survey.test.ts`, `src/modules/tracks/options.ts`, `src/modules/tracks/extra-questions.ts`

**Interfaces:**
- `options.ts`: `APPLICANT_TYPES = ["new", "experienced", "intern", "any"]`(화면 표시: 신입 / 경력 / 인턴 / 무관), `EMPLOYMENT_TYPES = ["regular", "contract", "intern", "any"]`, `REGIONS`(17개 시도 + `"anywhere"`), `CRITERIA = ["jobMatch", "location", "experience", "field", "preferred"]`(직무 일치 / 근무지 / 경력 요건 / 분야 / 우대 요건). 각 값의 한국어 이름도 여기 둔다
- `extra-questions.ts`: `extraQuestionsFor(majorCode: string): { id: string; label: string; options: { value: string; label: string }[] }[]` — 위 "분야별 추가 질문" 표의 내용
- `survey.ts`:
  - `type SurveyInput = { name: string; majorCode: string; jobs: { ncsCode: string | null; customName: string | null }[]; applicantType; experienceMonths: number | null; regions: string[]; salaryMin: number | null; employmentTypes: string[]; importanceOrder: string[]; extraAnswers: Record<string, string> }`
  - `asksExperience(applicantType): "required" | "optional" | "skip"` — 경력 `required`, 무관 `optional`, 신입·인턴 `skip`
  - `weightsFromOrder(order): Record<Criterion, number>` — 30 / 25 / 20 / 15 / 10
  - `experienceMode(applicantType): "entryLevelOk" | "compareYears"` — 신입·인턴은 `entryLevelOk`(채점에서 "신입 가능 여부"), 경력·무관은 `compareYears`
  - `validateSurvey(input): { ok: true; value: SurveyInput } | { ok: false; errors: Record<string, string> }` — 값을 다듬고(공백 제거, 신입·인턴이면 `experienceMonths`를 `null`로, 대분류에 없는 추가 질문의 답은 버림) 한국어 오류 문구를 돌려준다

- [ ] **Step 1: 실패하는 테스트**
  - 신입·인턴은 기간을 묻지 않고, 넣어 보내도 `null`로 저장된다
  - 경력인데 기간이 없으면 오류 `일한 기간을 입력해 주세요`
  - 직무가 0개면 오류, 6개면 오류, `ncsCode`와 `customName`이 둘 다 없거나 둘 다 있으면 오류, 같은 직무를 두 번 넣으면 한 번만 남는다
  - 지역이 0개면 오류, 목록에 없는 지역이면 오류, 순서가 유지된다. `anywhere`를 고르면 다른 지역은 버린다
  - 중요도 순서가 5개 항목을 한 번씩 담고 있지 않으면 오류
  - `weightsFromOrder`의 합은 항상 100이고 1위가 30, 5위가 10
  - 정보통신(20)을 고르면 추가 질문에 재택이 있고, 경영(02)이면 추가 질문이 없다. 대분류에 없는 질문의 답은 버려진다
  - 희망 연봉이 음수거나 숫자가 아니면 오류, 비우면 `null`
  - 트랙 이름이 비어 있으면 오류, 50자를 넘으면 오류
- [ ] **Step 2: 실패 확인**
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인, Commit** `feat: 설문 규칙과 배점 계산`

---

### Task 4: 트랙 저장

**Files:**
- Create: `src/modules/tracks/schema.ts`, `src/modules/tracks/repo.ts`, `src/modules/tracks/repo.test.ts`
- Modify: `src/db/schema.ts`, `drizzle/`, `docs/conventions.md`(모듈 목록에 `ncs`, `tracks` 추가)

**Interfaces:**
- 테이블 `tracks_tracks`: `id text primary key`(무작위), `userId text not null references auth_user(id) on delete cascade`, `name text not null`, `majorCode text not null references ncs_categories(code)`, `applicantType text not null`, `experienceMonths integer`, `regions jsonb not null`(순서 있는 배열), `salaryMin integer`, `employmentTypes jsonb not null`, `importanceOrder jsonb not null`, `weights jsonb not null`, `extraAnswers jsonb not null`, `createdAt`, `updatedAt`. `userId`에 인덱스
- 테이블 `tracks_jobs`: `id text primary key`, `trackId text not null references tracks_tracks(id) on delete cascade`, `ncsCode text references ncs_categories(code)`, `customName text`, `position integer not null`. `ncsCode`와 `customName` 중 정확히 하나만 채워지도록 check 제약
- `type Track = SurveyInput & { id: string; weights: Record<Criterion, number>; createdAt: Date; updatedAt: Date }`
- `createTrack(db, userId, input: SurveyInput): Promise<{ ok: true; id: string } | { ok: false; reason: "invalid_job" | "invalid_major" }>` — NCS 코드가 세분류로 존재하는지 `ncs` 모듈 함수로 확인하고, 트랙과 직무를 한 트랜잭션으로 저장한다. `weights`는 `weightsFromOrder`로 계산해 함께 저장한다
- `listTracks(db, userId): Promise<{ id: string; name: string; jobNames: string[]; createdAt: Date }[]>` — 만든 순
- `getTrack(db, userId, trackId): Promise<Track | null>`
- `updateTrack(db, userId, trackId, input): Promise<{ ok: true } | { ok: false; reason: "not_found" | "invalid_job" | "invalid_major" }>` — 직무 목록은 통째로 바꾸고 `weights`를 다시 계산한다
- `countTracks(db, userId): Promise<number>`

배점을 계산해서 저장해 두는 이유: 나중에 계산식을 바꿔도 이미 만든 트랙의 채점 기준이 조용히 바뀌지 않게 하기 위해서다. 설문을 다시 열어 저장하면 그때의 식으로 다시 계산된다.

- [ ] **Step 1: 실패하는 테스트** (준비: `auth_user`에 `u1`, `u2`)
  - 만든 트랙을 본인이 다시 읽으면 입력과 같고 `weights`가 순서대로 30~10
  - 다른 사용자의 트랙은 `getTrack`으로 읽히지 않고 `listTracks`에 나오지 않는다
  - 다른 사용자의 `trackId`로 `updateTrack`하면 `not_found`이고 원래 값이 그대로다
  - 없는 NCS 코드나 세분류가 아닌 코드는 `invalid_job`이고 트랙이 만들어지지 않는다(트랜잭션)
  - 직접 입력한 직무와 NCS 직무가 섞여 있어도 순서대로 저장된다
  - `updateTrack` 후 직무 목록이 새 것으로 바뀌고, 중요도 순서를 바꾸면 `weights`도 바뀐다
  - 사용자를 지우면 트랙과 직무가 함께 지워진다
  - `countTracks`는 본인 것만 센다
- [ ] **Step 2: 실패 확인**
- [ ] **Step 3: 스키마, 마이그레이션, 구현**
- [ ] **Step 4: 통과 확인, Commit** `feat: 트랙 저장과 사용자 격리`

---

### Task 5: 설문 화면

**Files:**
- Create: `src/modules/tracks/actions.ts`, `src/modules/ncs/actions.ts`, `src/app/(app)/tracks/new/page.tsx`, `src/app/(app)/tracks/survey-form.tsx`(클라이언트), `src/app/(app)/tracks/job-picker.tsx`(클라이언트)

**Interfaces:**
- `ncs/actions.ts`(서버 액션, 모두 `requireUser()` 후): `listMajorsAction()`, `listChildrenAction(parentCode)`, `listJobsUnderAction(middleCode)`, `searchJobsAction(query)`
- `tracks/actions.ts`: `createTrackAction(input: unknown): Promise<{ ok: true } | { ok: false; errors: Record<string, string> }>` — `requireUser()` → `validateSurvey` → `createTrack`. 성공하면 `/`로 이동

**화면** (`/tracks/new`, 한 페이지 안에서 단계 이동. 위쪽에 "3 / 6" 같은 진행 표시, `이전` / `다음`)

1. **분야와 직무** — 검색 칸(입력을 멈추면 결과 표시, 결과마다 `대분류 > 중분류 > 소분류` 경로)과 단계별 선택(대분류 → 중분류 → 소분류로 묶인 직무)을 함께 둔다. 검색 결과를 고르면 단계별 선택의 대분류·중분류가 그 직무의 것으로 채워진다. 대분류를 바꾸면 중분류와 직무 목록이 비워지고 다시 불러온다. 고른 직무는 아래에 칩으로 쌓이고 지울 수 있다. 맨 아래에 `목록에 없어요` → 직무 이름 직접 입력
2. **지원 유형** — 신입 / 경력 / 인턴 / 무관
3. **일한 기간** — 경력·무관일 때만 나온다. 년, 개월
4. **근무 가능 지역** — 누른 순서대로 번호가 붙는다
5. **희망 연봉, 고용 형태** — 그리고 고른 대분류의 추가 질문이 있으면 여기에 함께 나온다
6. **중요도 순서** — 다섯 항목을 위·아래 버튼으로 옮긴다. 옆에 그 순서의 배점을 바로 보여 준다
7. **확인** — 트랙 이름(자동 제안, 수정 가능)과 답변 요약, `만들기`

단계마다 `다음`을 누를 때 그 단계의 오류만 보여 준다(같은 `validateSurvey`의 오류를 단계별로 나눠 쓴다). 서버에서도 전체를 다시 검사한다.

- [ ] **Step 1: 서버 액션 작성**
- [ ] **Step 2: 직무 고르기 작성** (검색 → 상위 자동 채움, 대분류 변경 → 하위 초기화)
- [ ] **Step 3: 설문 단계 작성** (지원 유형에 따라 3단계 건너뜀, 대분류에 따라 추가 질문)
- [ ] **Step 4: 빌드 확인** — `npm run build`와 규칙 테스트로 확인한다. PR 미리보기 배포는 실제 DB를 바꾸지 않으므로 새 표가 없어 화면이 동작하지 않는다. 화면 확인은 `main`에 합친 뒤 실제 주소에서 사용자가 한다(Task 7의 표)
- [ ] **Step 5: Commit** `feat: 트랙 설문 화면`

---

### Task 6: 첫 로그인 연결, 트랙 목록, 설문 다시 열기

**Files:**
- Create: `src/app/(app)/tracks/[trackId]/edit/page.tsx`
- Modify: `src/app/(app)/page.tsx`, `src/app/(app)/layout.tsx`, `src/modules/tracks/actions.ts`

**Interfaces:**
- `updateTrackAction(trackId: string, input: unknown)` — `requireUser()` → `validateSurvey` → `updateTrack`. 남의 트랙이면 `not_found`

**동작**
- `/`(홈): 트랙이 하나도 없으면 `/tracks/new`로 보낸다. 있으면 트랙 목록(이름, 직무, 만든 날)과 `트랙 추가`, 트랙마다 `설문 다시 하기`. 경험 기록 자리는 `다음 단계에서 열립니다`로 둔다
- `/tracks/new`: 첫 트랙일 때는 위에 `처음이시네요. 몇 가지만 여쭤볼게요` 안내
- `/tracks/[trackId]/edit`: 같은 설문에 기존 답이 채워져 있다. 마지막 버튼은 `저장`. 없는 트랙이나 남의 트랙이면 404
- 상단 메뉴에 `트랙`(`/`) 추가

- [ ] **Step 1: 홈과 메뉴 수정**
- [ ] **Step 2: 수정 화면과 액션**
- [ ] **Step 3: 전체 테스트, 빌드, 린트**
- [ ] **Step 4: Commit** `feat: 첫 로그인 설문 연결과 트랙 목록`

---

### Task 7: 배포와 직접 확인

- [ ] **Step 1: PR을 만들고 사용자 확인 후 `main`에 합친다.** 배포 기록에서 마이그레이션이 적용됐는지 확인한다
- [ ] **Step 2: 사용자가 실제 주소에서 확인**

| 확인할 것 | 기대 결과 |
|---|---|
| 로그인 | 트랙이 없으므로 설문으로 이동 |
| 검색 칸에 `백엔드` | `응용SW엔지니어링`이 경로와 함께 나옴. 고르면 대분류가 `정보통신`으로 채워짐 |
| 대분류를 `경영ㆍ회계ㆍ사무`로 바꿈 | 중분류와 직무 목록이 바뀜 |
| 지원 유형 `신입` | 일한 기간 단계가 나오지 않음 |
| 지원 유형 `경력` | 일한 기간을 묻고, 비우면 넘어가지 않음 |
| 대분류 `정보통신` | 재택근무 질문이 나옴 |
| 중요도 순서 바꾸기 | 옆의 배점이 30 / 25 / 20 / 15 / 10으로 따라 바뀜 |
| `만들기` | 홈에 트랙이 보임 |
| `트랙 추가` | 같은 설문으로 두 번째 트랙 생성 |
| `설문 다시 하기` | 기존 답이 채워져 있고, 고쳐 저장하면 반영됨 |
| 다른 계정으로 로그인 | 그 계정의 설문부터 시작. 남의 트랙은 보이지 않음 |

- [ ] **Step 3: 문제를 고치고 3번 계획(경험 기록)을 작성한다**

## 이 계획에서 하지 않는 것

- 제외 조건의 기준값과 적합도 채점: 4번 계획. 이 계획은 그때 쓸 답(지역, 고용 형태, 경력, 배점)을 저장해 둔다
- 직무에 따른 인터뷰 질문: 3번 계획
- 트랙 삭제, 설문 임시 저장
- NCS 능력단위(8,425건): 원본에는 있으나 지금은 쓰지 않는다. 3번 계획에서 인터뷰 질문에 쓸지 검토한다

## 구현하면서 달라진 점

- **트랙이 없을 때 홈에서 바로 설문을 보여 준다.** 계획은 `/tracks/new`로 보내는 것이었으나, 브라우저가 "홈 → 설문" 이동을 기억해 트랙을 만든 뒤에도 설문 첫 단계로 되돌아가는 문제가 있었다. `/tracks/new`는 두 번째 트랙부터 쓴다
- **저장하는 서버 액션은 `revalidatePath`를 부른다.** 브라우저가 기억해 둔 예전 화면을 버리게 한다(트랙, 내 정보, 허용 이메일 모두)
- **로컬 미리보기 추가** (`npm run preview:local`). 외부 DB와 구글 로그인 없이 메모리 DB와 가짜 사용자로 화면을 띄운다. `next.config.ts`가 `LOCAL_PREVIEW=1`일 때만 `@/db`와 `@/lib/session`을 `src/dev/`의 것으로 바꿔 끼우며, 배포 환경에서는 켤 수 없다. Task 5의 "화면은 합친 뒤에만 확인할 수 있다"는 제약이 없어졌다
- 데이터 넣는 스크립트는 `scripts/build-ncs-migration.mjs`다(실행 도구를 더 설치하지 않으려고 `.ts` 대신 `.mjs`)
- 검색 순위에 "별칭이 검색어로 시작"을 네 번째로 추가했다
- 분야(`majorCode`)는 처음 고른 NCS 직무의 대분류를 따른다. 직접 입력한 직무뿐이면 단계별 선택에서 고른 대분류를 쓴다
