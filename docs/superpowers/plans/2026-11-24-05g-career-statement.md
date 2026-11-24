# Job Hunter 5-7번 계획: 경력기술서 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 확인된 경력과 그 아래 프로젝트·업무(사례)로 경력기술서를 만든다. 회사 머리는 코드가 이력 사실에서 채우고, 항목마다 한 일·성과 줄은 AI가 확인된 기록으로 쓴다. 이력서처럼 트랙마다 공통본, 지원 공고마다 맞춤본(강조할 항목을 AI가 이유와 함께 고르고 사용자가 체크)을 두고, 줄 고치기·순서·빼기·다시 쓰기와 같은 검사를 한다. 제출하면 제출본에 함께 얼린다.

**Architecture:** 새 표 `applications_careers`(이력서 표와 같은 칸: 트랙 공통본 1행, 공고 맞춤본 1행)에 `CareerContent`(회사 → 항목)를 담는다. 원천은 `experiences/record-sources.ts`의 새 함수가 경력마다 항목(경력 바로 아래 사례, 경력에 딸린 프로젝트)을 묶어 준다. 쓰기·강조·다듬기·검사·화면은 이력서(5-2) 코드의 모양을 따르되 파일을 따로 둔다(`career-*.ts`, `_career/`). 강조 고르기는 이력서의 `emphasisText`를 목적만 바꿔 다시 쓴다.

**Tech Stack:** Next.js 16(App Router, 서버 액션), Drizzle + Postgres(테스트는 PGlite `createTestDb()`), zod, Vitest

**Spec:** `docs/superpowers/specs/2026-11-20-records-and-documents-design.md`의 5.8 경력기술서, 5.1(경력·프로젝트·사례 칸), 5.2(확인 기준), 6(경력기술서 표), 9장 4번, 10(새 표로 둘지는 빌더가 정함)

## 정한 것 (설계가 빌더에게 맡긴 것)

- **새 표** `applications_careers`(「제안」 사용자 승인 필요, 판단표 ③). 칸은 `applications_resumes`와 같다: `id`, `user_id`, `track_id`, `posting_id`(공통본은 null), `version`, `selection` jsonb(`CareerSelection`, 맞춤본만), `content` jsonb(`CareerContent`), `created_at`, `updated_at`. 유일 색인 `applications_careers_common_idx`(user_id, track_id) where posting_id is null, `applications_careers_tailored_idx`(posting_id) where posting_id is not null. 이력서 표에 서류 종류 칸을 더하지 않는 까닭: 내용의 모양(회사 → 항목)이 달라 한 jsonb 칸에 두 모양이 섞이고, 이미 도는 이력서 함수마다 종류 조건을 더해야 한다
- **항목**: 경력(확인됨, 트랙에서 제외 아님)마다 회사 하나. 그 아래 항목은 ① 머리가 그 경력인 사례(업무), ② 소속이 그 경력인 확인된 프로젝트. 개인·학교·교육 과정 프로젝트와 활동은 넣지 않는다(설계: 프로젝트 기술서로 바꿔 쓰기는 하지 않음)
- **확인 기준**(이력서와 같다): 사례는 확인됨이고 머리(경력)도 확인됨. 프로젝트는 확인됨이고 소속 경력도 확인됨. 프로젝트 항목에 묶는 사례는 확인됨이고 그 트랙에서 제외 아님. 범위는 경력과 항목 중 좁은 것(`narrowerScope`). 제외면 빠지고, 요약만이면 항목 분량이 요약이다
- **항목의 재료**: 사례 항목은 그 사례의 칸(`sceneFields`와 같은 것: 상황·판단·한 일·결과·배운 점·수치·하지 않은 것·금지 표현(사례+경력)). 프로젝트 항목은 프로젝트 한 줄 요약과 그 아래 확인된 사례를 이력서의 프로젝트 원천처럼 이어 붙인 글(`[제목] 상황: … / 한 일: … / 결과: …`, 요약만이면 끝에 ` (요약만)`), 수치는 그 사례들의 수치, 금지 표현은 프로젝트+사례+경력
- **머리**: 회사 머리 `{ company, department, title, period, duties }`는 경력에서 코드가 만든다(`period`는 `formatPeriod("job", …)`). 항목 머리 `{ name, role, period, tools }`도 코드가 만든다: 사례는 이름=사례 제목, 역할=경력 직급, 기간=사례 기간(비면 경력 기간), 기술=[]. 프로젝트는 이름·역할·기간·쓴 기술·도구(`tools`)를 프로젝트에서
- **AI가 쓰는 것**: 항목마다 `done`(한 일)과 `results`(성과) 줄. 분량은 자세히 `done` 2~4줄·`results` 0~3줄, 요약 `done` 1~2줄·`results` 0~1줄. 성과는 기록의 결과·수치에 있는 것만, 없으면 빈 배열. 한 줄 150자. 목적(`AiPurpose`)은 `career_write`, `career_emphasis` 둘을 더한다
- **순서**: 회사는 입사 월 최근 순(없으면 아래, 같으면 만든 때 최근 순). 항목은 시작 월 최근 순(같은 규칙). 맞춤본은 강조한 항목이 그 회사 안에서 맨 위로 고른 순서대로 오른다. 회사 순서는 바꾸지 않는다(경력기술서는 시간 순)
- **한도**(`CAREER_LIMITS`): 항목 30개(공통본을 처음 만들 때 회사 순서대로 자른다), 줄 한도·한 줄 글자 수·직접 고칠 때 줄 수·강조 수·이유 길이는 `RESUME_LIMITS`의 값을 쓴다
- **다시 쓰기**: 이력서처럼 항목 id를 받아 다시 쓰거나 빠진 항목을 넣는다. 경력 id를 받으면 그 회사 머리를 코드로 새로 고친다(AI 없음, 회사가 없으면 항목 없이 넣는다). 다시 쓴 항목이 든 회사의 머리도 함께 새로 고친다
- **강조 고르기**: 이력서의 `emphasisText`에 `purpose` 인자(`"resume_emphasis" | "career_emphasis"`, 기본 `resume_emphasis`)를 더해 다시 쓴다. 지시문(`RESUME_EMPHASIS_SYSTEM`)은 바꾸지 않는다. 후보는 공통본에 있고 지금 "사용"인 항목
- **경력이 없을 때**: 확인된 경력(제외 아님)이 없으면 "경력이 없어 경력기술서를 만들 수 없습니다"(AI 안 부름). 경력은 있는데 항목이 없으면 AI를 부르지 않고 회사 머리만으로 공통본을 만든다
- **제출본**: `SubmissionContent.career?: SubmittedCareer | null`(옛 제출본에는 키가 없다). 공고의 서류에 경력기술서가 있을 때만 얼린다(맞춤본 → 공통본 → null, 항목·회사가 0개인 행은 없는 것으로 본다)
- **복사 글**(`careerText`):
  ```
  회사 | 부서 | 직급 | 기간
  담당: 업무1, 업무2
  ■ 항목 이름 | 역할 | 기간
  기술: a, b
  한 일
  - 줄
  성과
  - 줄
  ```
  빈 칸(부서·직급·역할)은 `|` 줄에서 빼고, 담당·기술·한 일·성과는 비면 그 줄째 뺀다. 항목 사이는 빈 줄 하나, 회사 사이는 빈 줄 둘

## Global Constraints

- `CLAUDE.md`, `docs/conventions.md`의 데이터 접근 규칙과 AI 사용 규칙을 따른다: AI 호출은 `runAi()`, 모델 `claude-sonnet-5-5`, 연락처·증빙 메모는 AI에 보내지 않음, 테이블 이름은 `<모듈>_<이름>`
- 새 표는 `user_id`가 `auth_user(id)`를 `on delete cascade`로 참조하고, repo 함수의 첫 두 인자는 `(db, userId)`, 모든 쿼리에 `userId` 조건, "다른 사용자의 것은 읽히지 않는다" 테스트를 둔다
- AI에게는 항목의 실제 id 대신 E1, E2 별명을 보내고, 답의 별명(또는 이름)은 `resolveAlias`로 실제 id로 바꾼다
- 지원서에는 확인됨만 쓴다(설계 5.2). 반목표: 기록에 없는 경험·수치·역할을 쓴다, 하지 않은 것을 한 것처럼 쓴다, 다른 사용자에게 보인다
- 맞춤본은 지원 공고에서만 만들고 고치며, 제출로 잠긴 공고에서는 바꾸지 않는다(`editBlock`, `withEditLock`)
- 화면을 바꾸면 `LOCAL_PREVIEW=1`로 로컬 미리보기를 띄워 확인하고 사진을 사용자에게 보낸다. 새 AI 작업에는 `src/dev/local-ai.ts`의 가짜 답을 더한다
- 새 AI 작업마다 프롬프트 점검에 예시를 더하고 관리 화면의 호출 수를 고친다(26 → 28)
- 판단표 ②: PR 1은 `schema.ts`·`drizzle/**`·`src/modules/ai/**`·`src/dev/**`·`src/app/(app)/admin/**`를, PR 2는 `src/dev/**`·`src/app/(app)/admin/**`를 바꾸므로 둘 다 합치기 전에 사용자에게 묻는다

## Review Focus

1. 경력에 딸린 프로젝트의 소속을 다른 경력으로 바꾸거나, 소속 경력의 확인이 풀린다 → 그 항목은 원래 회사 아래에서 "지금 쓸 수 없음"으로 보이고, 새 회사 아래 빠진 항목으로 넣을 수 있다 (Task 2 테스트 "소속 경력이 미확인인 프로젝트는 넣지 않는다", Task 3 테스트 "다른 회사로 옮긴 항목은 unavailable이고 새 회사의 missing이다")
2. 경력은 확인됐지만 사례·프로젝트가 하나도 없다 → AI를 부르지 않고 회사 머리(담당 업무)만으로 공통본이 만들어지고, 빈 줄 표시가 뜨지 않는다 (Task 4 테스트 "항목이 없으면 AI 없이 회사 머리만 만든다", Task 3 테스트 "항목 없는 회사는 표시하지 않는다")
3. 확인된 경력이 없는 사용자(프로젝트·교육만 있음)가 공고에서 경력기술서를 체크한다 → 공통본 화면은 "경력이 없어 경력기술서를 만들 수 없습니다", 제출 확인 창은 "경력기술서가 없습니다"를 보이고 제출은 된다 (Task 4 테스트 "확인된 경력이 없으면 no_jobs", Task 9 테스트 "경력기술서가 없으면 경고하고 career는 null")
4. AI가 한 항목의 성과에 다른 항목(같은 회사의 다른 사례)의 숫자를 섞는다 → 그 숫자는 "기록에 없는 숫자"로 표시된다 (Task 3 테스트 "다른 항목의 숫자는 이 항목의 근거가 아니다")
5. 경력기술서를 고르지 않은 공고·옛 제출본(`career` 키 없음)을 연다 → 제출본에 경력기술서가 얼려지지 않고, 옛 제출본 화면이 깨지지 않는다 (Task 9 테스트 "경력기술서를 고르지 않으면 career는 null", "옛 제출본은 career 없이 그린다")

---

# PR 1: 경력기술서 공통본

## Task 1: 표, 타입, 저장소

**Files:**
- Modify: `src/modules/applications/schema.ts`, `src/modules/applications/types.ts`, `src/modules/applications/options.ts`, `docs/conventions.md`(모듈 표에 `applications_careers`)
- Create: `src/modules/applications/career-repo.ts`, `src/modules/applications/career-repo.test.ts`, `drizzle/0024_*.sql`(`npm run db:generate`)

**Interfaces:**
- Produces (`types.ts`):
  ```ts
  export type CareerItemHeading = { name: string; role: string | null; period: string; tools: string[] };
  // experienceId: 사례 id 또는 프로젝트 id
  export type CareerItem = SourceRef & { kind: "scene" | "project"; heading: CareerItemHeading; detail: ResumeDetail; emphasized: boolean; done: ResumeLine[]; results: ResumeLine[]; writtenAt: string };
  export type CareerCompanyHeading = { company: string; department: string | null; title: string | null; period: string; duties: string[] };
  // experienceId: 경력 id
  export type CareerCompany = SourceRef & { heading: CareerCompanyHeading; items: CareerItem[] };
  export type CareerContent = { companies: CareerCompany[]; commonVersion: number | null }; // 맞춤본을 만들 때의 공통본 version. 공통본은 null
  export type CareerSelection = ResumeSelection; // picks의 experienceId는 항목 id
  ```
- Produces (`options.ts`): `export const CAREER_LIMITS = { items: 30, fullDone: 4, summaryDone: 2, fullResults: 3, summaryResults: 1 } as const;`
- Produces (`career-repo.ts`, `resume-repo.ts`와 같은 이름 규칙·같은 동작):
  ```ts
  export type Career = { id: string; trackId: string; postingId: string | null; version: number; selection: CareerSelection | null; content: CareerContent | null; createdAt: Date; updatedAt: Date };
  export function getCareer(db, userId, id): Promise<Career | null>;
  export function getCommonCareer(db, userId, trackId): Promise<Career | null>;
  export function getTailoredCareer(db, userId, postingId): Promise<Career | null>;
  export function insertCommonCareer(db, userId, trackId, content): Promise<{ ok: true; id: string } | { ok: false; reason: "not_found" | "exists" }>;
  export function saveTailoredCareerSelection(db, userId, postingId, trackId, selection): Promise<{ ok: true; id: string } | { ok: false; reason: "not_found" }>;
  export function saveTailoredCareerContent(db, userId, postingId, trackId, content, expectedVersion: number | null): Promise<Saved>;
  export function saveCareerContent(db, userId, id, content, expectedVersion: number): Promise<Saved>;
  ```

- [ ] **Step 1: 실패하는 테스트를 쓴다** — `career-repo.test.ts`는 `resume-repo.test.ts`의 경우를 그대로 옮긴다: "공통본은 트랙마다 하나(두 번째는 exists)", "남의 트랙에는 not_found", "다른 사용자의 것은 읽히지 않는다(get·getCommon·getTailored 모두 null)", "version이 다르면 changed, 없으면 not_found", "맞춤본 선택 저장은 행을 만들고 다시 저장하면 version이 오른다", "expectedVersion null은 내용이 빈 행에만 쓴다", "공고가 지워지면 not_found(23503)", "트랙을 지우면 함께 지워진다"
- [ ] **Step 2: 돌려서 실패를 본다** — `npx vitest run src/modules/applications/career-repo.test.ts`
- [ ] **Step 3: 구현한다.** 스키마를 고친 뒤 `npm run db:generate`로 마이그레이션을 만들고 SQL에 표 하나와 색인 둘만 있는지 본다
- [ ] **Step 4: 돌려서 통과를 본다** — 같은 명령 PASS, `npx tsc --noEmit`
- [ ] **Step 5: 커밋** — `feat: 경력기술서 표와 저장소를 더한다`

## Task 2: 경력기술서 원천

**Files:**
- Modify: `src/modules/experiences/record-sources.ts`, `src/modules/experiences/sources.ts`
- Test: `src/modules/experiences/record-sources.test.ts`

**Interfaces:**
- Consumes: `record-sources.ts` 안의 `load`, `headsOf`, `sceneFields`, `sceneMetrics`, `scenePeriod`, `byRecent`, `narrowerScope`, `versionHash`
- Produces (`record-sources.ts`, `sources.ts`가 다시 내보낸다):
  ```ts
  // WritingSource 칸(이름·소속·역할·기간·상황·한 일·결과·하지 않은 것·금지 표현·수치·contentVersion)을 그대로 가져 describeSource·knownNumbers·emphasisText에 넘길 수 있다
  export type CareerItemSource = WritingSource & { itemKind: "scene" | "project"; tools: string[]; scope: "use" | "summary" };
  export type CareerSource = {
    id: string; // 경력 id
    company: string; department: string | null; title: string | null;
    startMonth: string | null; endMonth: string | null; isOngoing: boolean;
    duties: string[];
    contentVersion: number; // 경력의 contentVersion(머리만)
    scope: "use" | "summary";
    items: CareerItemSource[]; // 최근 순
  };
  export async function listRecordCareerSources(db: Db, userId: string, trackId: string): Promise<CareerSource[]>; // 남의 트랙이면 []
  // sources.ts
  export async function listCareerSources(db: Db, userId: string, trackId: string): Promise<CareerSource[]>;
  ```
- 프로젝트 항목의 `contentVersion`은 `versionHash([...project.versionParts, ...묶은 사례마다 (id, contentVersion, scope)])`, 사례 항목은 `sceneFields`의 값. 프로젝트 항목의 `situation`은 한 줄 요약, `actions`는 이어 붙인 사례 글, `result`는 null, `organization`은 회사 이름

- [ ] **Step 1: 실패하는 테스트를 쓴다** (`createTestDb()`로 실제 표에 넣는다)
  - "확인된 경력마다 하나, 입사 월 최근 순"
  - "미확인 경력과 트랙에서 제외한 경력은 넣지 않는다"
  - "경력 바로 아래 확인된 사례는 scene 항목이고 역할은 직급, 기간이 비면 경력 기간"
  - "미확인·부분 확인 사례는 넣지 않는다"
  - "소속이 그 경력인 확인된 프로젝트는 project 항목이고 tools를 담는다"
  - "소속 경력이 미확인인 프로젝트는 넣지 않는다"(경력 미확인이면 회사째 없음), "개인·학교·교육 과정 프로젝트와 활동은 넣지 않는다"
  - "프로젝트 항목은 확인된 사례를 이어 붙이고, 요약만 사례에는 (요약만)을 붙이고 제외 사례는 뺀다"
  - "범위는 경력과 항목 중 좁은 것: 경력이 요약만이면 항목도 summary, 항목이 제외면 빠진다"
  - "프로젝트 아래 사례를 고치면 프로젝트 항목의 contentVersion이 바뀐다"
  - "금지 표현은 항목과 경력의 합", "수치는 rubric이 met인 것만"
  - "남의 트랙이면 빈 배열", "다른 사용자의 경력은 나오지 않는다"
- [ ] **Step 2: 돌려서 실패를 본다** — `npx vitest run src/modules/experiences/record-sources.test.ts`
- [ ] **Step 3: 구현한다.** `listRecordResumeSources`와 같은 `load` 결과로 만든다(DB를 한 번 더 읽지 않는다)
- [ ] **Step 4: 돌려서 통과를 본다** — 같은 명령 PASS
- [ ] **Step 5: 커밋** — `feat: 경력마다 사례·프로젝트 항목을 묶은 경력기술서 원천을 더한다`

## Task 3: 경력기술서 항목 함수와 검사

**Files:**
- Create: `src/modules/applications/career-entries.ts`, `career-entries.test.ts`, `career-check.ts`, `career-check.test.ts`

**Interfaces:**
- Consumes: Task 1 타입, Task 2 `CareerSource`/`CareerItemSource`, `cleanLines`·`parseLines`(`resume-entries.ts`), `knownNumbers`(`check.ts`), `numbersIn`, `formatPeriod`
- Produces (`career-entries.ts`, 순수 함수):
  ```ts
  export function buildCompany(source: CareerSource): CareerCompany; // items는 []
  export function buildItem(item: CareerItemSource, detail: ResumeDetail, emphasized: boolean, lines: { done: string[]; results: string[] }, now: Date): CareerItem;
  export const lineCaps = (detail: ResumeDetail) => ({ done: number, results: number }); // CAREER_LIMITS에서
  // 회사 머리는 source로 바꾸고(없으면 회사를 원천 순서 자리에 넣는다), 항목은 있으면 그 자리, 없으면 그 회사 끝에
  export function upsertItems(content: CareerContent, sources: CareerSource[], items: { companyId: string; item: CareerItem }[]): CareerContent;
  export function refreshCompany(content: CareerContent, source: CareerSource): CareerContent; // 머리만 바꾸거나 빈 회사로 넣는다
  export function moveItem(content: CareerContent, itemId: string, direction: "up" | "down"): CareerContent; // 같은 회사 안에서만
  export function removeItem(content: CareerContent, id: string): CareerContent; // 경력 id면 회사째 뺀다
  export function replaceItemLines(content: CareerContent, itemId: string, field: "done" | "results", lines: string[]): CareerContent; // 글이 같은 줄은 edited를 지킨다
  // 고른 항목을 각 회사 맨 위로 고른 순서대로 올린다(회사 순서는 그대로)
  export function emphasizeItems(common: CareerContent, chosen: { companyId: string; item: CareerItem }[], sources: CareerSource[], commonVersion: number): CareerContent;
  export function careerText(content: CareerContent): string; // "정한 것"의 복사 글
  export const itemCount = (content: CareerContent) => number;
  ```
- Produces (`career-check.ts`):
  ```ts
  export type CareerItemCheck = { unavailable: boolean; empty: boolean; stale: boolean; scopeChanged: boolean; banned: string[]; ungrounded: string[] };
  export type CareerCompanyCheck = { unavailable: boolean; stale: boolean; items: CareerItemCheck[] };
  // missing: 넣을 수 있는데 없는 회사(id=경력 id, companyId도 같은 값)와 항목
  export type CareerCheck = { companies: CareerCompanyCheck[]; missing: { id: string; name: string; companyId: string }[]; commonChanged: boolean };
  // currentCommonVersion이 null이면 공통본, 숫자면 맞춤본
  export function checkCareer(content: CareerContent, sources: CareerSource[], currentCommonVersion: number | null): CareerCheck;
  ```
  항목은 **그 회사의** `items`에서 찾는다(없으면 `unavailable`). `empty`는 `detail === "full"`이고 `done`이 0줄. `scopeChanged`는 공통본에서만. `ungrounded`는 직접 고치지 않은 `done`·`results` 줄의 숫자 중 `knownNumbers(그 항목 원천)`에 없는 것. 회사의 `stale`은 머리의 contentVersion이 경력과 다를 때

- [ ] **Step 1: 실패하는 테스트를 쓴다**
  - entries: "buildCompany는 경력 머리와 formatPeriod 기간을 만든다", "buildItem은 줄을 cleanLines로 자르고 edited false", "upsertItems는 없는 회사를 원천 순서 자리에 넣는다", "moveItem은 회사 경계를 넘지 않는다", "removeItem에 경력 id를 주면 회사째 빠진다", "replaceItemLines는 같은 글의 줄만 edited를 지킨다", "emphasizeItems는 강조 항목을 회사 맨 위로 올리고 공통본의 같은 항목은 뺀다", "careerText는 빈 칸·빈 구역을 빼고 정한 모양으로 쓴다"(기대 글을 그대로 비교)
  - check: "다른 회사로 옮긴 항목은 unavailable이고 새 회사의 missing이다", "다른 항목의 숫자는 이 항목의 근거가 아니다", "직접 고친 줄의 숫자는 보지 않는다", "금지 표현을 띄어쓰기와 상관없이 찾는다", "항목 없는 회사는 표시하지 않는다", "기록이 바뀌면 stale, 경력 머리가 바뀌면 회사 stale", "공통본에서만 scopeChanged", "맞춤본은 공통본 version이 다르면 commonChanged", "없는 경력은 회사 unavailable"
- [ ] **Step 2: 돌려서 실패를 본다** — `npx vitest run src/modules/applications/career-entries.test.ts src/modules/applications/career-check.test.ts`
- [ ] **Step 3: 구현한다**
- [ ] **Step 4: 돌려서 통과를 본다** — 같은 명령 PASS
- [ ] **Step 5: 커밋** — `feat: 경력기술서 항목을 만들고 옮기고 검사하는 함수를 더한다`

## Task 4: AI 쓰기와 공통본 만들기·다시 쓰기

**Files:**
- Modify: `src/modules/ai/client.ts`(`AiPurpose`에 `"career_write" | "career_emphasis"`), `src/modules/applications/prompts.ts`, `src/dev/local-ai.ts`
- Create: `src/modules/applications/career-write.ts`, `career-write.test.ts`

**Interfaces:**
- Consumes: Task 1~3, `describeSource`·`postingTextOf`·`requirementsOf`(`select.ts`), `resolveAlias`, `editBlock`·`withEditLock`, `getPosting`, `ownsTrack`
- Produces (`prompts.ts`): `CAREER_WRITE_SYSTEM`. `RESUME_WRITE_SYSTEM`의 사실 규칙(기록에 있는 것만, 수치는 수치 칸과 본문만, 하지 않은 것·금지 표현, 팀과 본인 구분, 줄 안에 별명 금지, exp에는 별명만)을 그대로 두고, 쓰기 규칙을 바꾼다: 항목마다 `done`(본인이 한 일, 명사형으로 끝나는 짧은 줄)과 `results`(결과·성과. 기록의 결과·수치에 있는 것만, 없으면 빈 배열)를 따로 쓴다 / 이름·역할·기간·기술·회사는 코드가 머리에 넣으므로 되풀이하지 않는다 / 분량 "자세히" done 2~4줄·results 0~3줄, "요약" done 1~2줄·results 0~1줄 / 한 항목의 줄에 다른 항목의 내용을 섞지 않는다 / "공고에 맞춰 강조: 예"인 항목만 공고와 맞닿는 내용을 앞에 둔다
- Produces (`career-write.ts`):
  ```ts
  export type CareerRequest = { companyId: string; item: CareerItemSource; detail: ResumeDetail; emphasize: boolean };
  export type CareerLines = { done: string[]; results: string[] };
  // 저장하지 않는다. 프롬프트 점검도 쓴다. 요청이 없으면 AI를 부르지 않는다. answered: AI가 답에 적은 항목 id
  export async function writeCareerItems(db, ai, userId, input: { requests: CareerRequest[]; posting: ResumePostingContext | null }, now?): Promise<{ ok: true; value: Record<string, CareerLines>; answered: Set<string> } | { ok: false; reason: "over_limit" | AiFailure }>;
  export async function startCommonCareer(db, ai, userId, trackId, now?): Promise<{ ok: true; id: string } | { ok: false; reason: "not_found" | "exists" | "no_jobs" | "over_limit" | AiFailure }>;
  // ids: 항목 id(다시 쓰기·넣기) 또는 경력 id(머리 새로 고침·회사 넣기)
  export async function rewriteCareerItems(db, ai, userId, careerId, ids: string[], expectedVersion: number, now?): Promise<{ ok: true; value: CareerContent } | { ok: false; reason: "not_found" | "not_apply" | "submitted" | "changed" | "none_selected" | "full" | "over_limit" | AiFailure }>;
  ```
- AI 답 스키마: `z.object({ items: z.array(z.object({ exp: z.string(), done: z.array(z.string()), results: z.array(z.string()) })) })`, `purpose: "career_write"`, `effort: "medium"`, `maxTokens: 16000`. 메시지는 공고가 있으면 `[공고]`, `[공고 요구 사항]`, 그리고 `[경력기술서 항목]`에 항목마다 `describeSource("E{n}", item, true)` + `- 분량: 자세히(한 일 2~4줄, 성과 0~3줄)` 또는 `요약(한 일 1~2줄, 성과 0~1줄)` + 강조면 `- 공고에 맞춰 강조: 예`. 없는 별명·중복은 버리고, 맞은 항목이 0개면 `invalid`
- `rewriteCareerItems`의 규칙은 `rewriteEntries`와 같다: 맞춤본이면 공고가 지원이고 잠기지 않았는지 보고, version이 다르면 `changed`, 새 항목은 30개까지 남은 자리만큼, 다시 쓸 것이 없으면 `none_selected`(자리가 없어 못 넣으면 `full`), AI가 답에서 뺀 기존 항목은 그대로, 맞춤본은 `withEditLock` 안에서 저장. 공통본은 지금 범위로, 맞춤본의 있는 항목은 그 항목의 분량과 강조로 쓴다. 경력 id만 받았으면 AI를 부르지 않는다
- `local-ai.ts`: `career_write`면 받은 별명마다 `{ exp, done: ["(가짜) 한 일 줄"], results: [] }`

- [ ] **Step 1: 실패하는 테스트를 쓴다** (`createFakeAi()`)
  - "확인된 경력이 없으면 no_jobs이고 AI를 부르지 않는다"
  - "항목이 없으면 AI 없이 회사 머리만 만든다"
  - "항목마다 done·results를 저장하고 분량 한도로 자른다"(가짜 답이 5줄을 줘도 자세히 4줄)
  - "AI에 보내는 글에 실제 id·증빙 메모가 없다"
  - "답에 없는 별명은 버리고, 모두 없으면 invalid"
  - "경력 이름 대신 항목 이름을 적어도 받는다"(resolveAlias)
  - "이미 있으면 exists"
  - "다시 쓰기: version이 다르면 changed", "빠진 항목을 그 회사 끝에 넣는다", "경력 id만 주면 AI 없이 머리를 새로 고친다", "AI가 뺀 기존 항목은 그대로 둔다", "30개가 차면 새 항목은 full"
  - "맞춤본 다시 쓰기는 지원이 아니면 not_apply, 제출로 잠기면 submitted"
  - "한도를 넘으면 over_limit"
- [ ] **Step 2: 돌려서 실패를 본다** — `npx vitest run src/modules/applications/career-write.test.ts`
- [ ] **Step 3: 구현한다**
- [ ] **Step 4: 돌려서 통과를 본다** — 같은 명령 PASS, `npx tsc --noEmit`
- [ ] **Step 5: 커밋** — `feat: 확인된 기록으로 경력기술서 공통본을 쓰고 다시 쓴다`

## Task 5: 다듬기와 서버 액션

**Files:**
- Create: `src/modules/applications/career-edit.ts`, `career-edit.test.ts`, `career-actions.ts`

**Interfaces:**
- Consumes: Task 3·4
- Produces (`career-edit.ts`):
  ```ts
  export type CareerEdit =
    | { type: "lines"; itemId: string; field: "done" | "results"; text: string }
    | { type: "move"; itemId: string; direction: "up" | "down" }
    | { type: "remove"; itemId: string }; // 경력 id면 회사째
  export async function editCareer(db, userId, careerId, edit: CareerEdit, expectedVersion: number): Promise<{ ok: true; value: CareerContent } | { ok: false; reason: "not_found" | "not_apply" | "submitted" | "changed" | "too_long" | "too_many_lines" }>;
  ```
  규칙은 `editResume`과 같다(줄 수 `RESUME_LIMITS.editLines`, 한 줄 `RESUME_LIMITS.line`, 옮길 것이 없으면 저장하지 않음, 맞춤본은 지원·잠금 확인과 `withEditLock`)
- Produces (`career-actions.ts`, `"use server"`, `resume-actions.ts`와 같은 모양과 문구, 결과 `{ ok: true } | { ok: false; message: string }`):
  `startCommonCareerAction(trackId)`, `rewriteCareerItemsAction(careerId, ids, expectedVersion)`, `editCareerAction(careerId, edit, expectedVersion)`. 새 문구: `no_jobs: "경력이 없어 경력기술서를 만들 수 없습니다"`, `full: "경력기술서 항목은 30개까지입니다. 항목을 빼고 넣어 주세요"`, `no_common`(PR 2): `"트랙의 경력기술서 공통본을 먼저 만들어 주세요"`. 끝나면 공통본은 `/tracks/{trackId}/career`, 맞춤본은 `/postings/{id}/career`와 `/postings/{id}`를 다시 그린다

- [ ] **Step 1: 실패하는 테스트를 쓴다** — "한 일 줄을 고치면 그 줄만 edited", "9줄이면 too_many_lines", "151자면 too_long", "회사 경계에서 옮기기는 저장하지 않고 version 그대로", "경력 id로 빼면 회사째 빠진다", "없는 항목 id면 changed", "맞춤본은 제출로 잠기면 submitted"
- [ ] **Step 2: 돌려서 실패를 본다** — `npx vitest run src/modules/applications/career-edit.test.ts`
- [ ] **Step 3: 구현한다** (액션의 입력은 zod로 모양부터 검사한다: `field`는 `z.enum(["done", "results"])`)
- [ ] **Step 4: 돌려서 통과를 본다** — 같은 명령 PASS, `npx tsc --noEmit`, `npm run lint`
- [ ] **Step 5: 커밋** — `feat: 경력기술서 줄 고치기·옮기기·빼기와 서버 액션을 더한다`

## Task 6: 공통본 화면

**Files:**
- Create: `src/app/(app)/tracks/[trackId]/career/page.tsx`, `src/app/(app)/tracks/[trackId]/career/start-career.tsx`, `src/app/(app)/_career/editor-data.ts`, `src/app/(app)/_career/editor-data.test.ts`, `src/app/(app)/_career/career-editor.tsx`
- Modify: `src/app/(app)/page.tsx`(트랙 줄에 `경력기술서 공통본` 링크를 `이력서 공통본` 옆에)

**Interfaces:**
- Consumes: Task 3 `checkCareer`·`careerText`, Task 4·5 액션, `useRun`·`ErrorLine`(`postings/[id]/application/use-run`), `recordHrefs`
- Produces (`editor-data.ts`):
  ```ts
  export type CareerItemView = { item: CareerItem; check: CareerItemCheck; href: string | null };
  export type CareerCompanyView = { company: CareerCompany; check: CareerCompanyCheck; items: CareerItemView[] };
  export type CareerEditorData = { careerId: string; version: number; companies: CareerCompanyView[]; missing: { id: string; name: string; companyName: string }[]; commonChanged: boolean; full: boolean; copyText: string };
  export function careerEditorData(career: Career, sources: CareerSource[], currentCommonVersion: number | null, hrefs: Map<string, string>): CareerEditorData | null; // content가 없으면 null
  ```
- 화면(`ResumeEditor`의 배치·문구를 따른다): 회사마다 머리 한 줄(`회사 · 부서 · 직급 · 기간`)과 `담당: …`, 회사 머리가 바뀌었으면 "경력 기록이 바뀌었습니다 · 머리 새로 고침"(경력 id로 다시 쓰기), 회사가 쓸 수 없으면 "이 경력은 지금 쓸 수 없습니다(확인 풀림, 제외, 지움) · 빼기". 항목마다 `이름 · 역할 · 기간`, `기술: …`, "한 일"·"성과" 줄 목록, 표시 줄(이력서와 같은 문구), `한 일 고치기`·`성과 고치기`(textarea 한 줄에 한 줄), `위로`·`아래로`·`빼기`·`다시 쓰기`(직접 고친 줄이 있으면 덮어쓰기 확인). 아래에 "빠진 항목"(회사 이름 · 항목 이름, 체크해서 `넣기`), `글로 복사`
- 페이지: 확인된 경력이 없으면 "경력이 없어 경력기술서를 만들 수 없습니다"와 경험 기록 링크(`AddRecordLink`), 공통본이 없으면 `StartCareer`("경력 n개, 항목 m개로 경력기술서를 씁니다 · 만들기", 1분쯤 걸림 안내), 있으면 편집 화면. 설명 줄: "확인된 경력과 그 아래 프로젝트·업무로 씁니다. 회사 정보는 기록에서 그대로 가져옵니다"

- [ ] **Step 1: 실패하는 테스트를 쓴다** — `editor-data.test.ts`: "검사 결과를 회사·항목 순서에 맞춰 붙인다", "missing에 회사 이름을 붙인다", "30개면 full", "content가 없으면 null"
- [ ] **Step 2: 돌려서 실패를 본다** — `npx vitest run "src/app/(app)/_career"`
- [ ] **Step 3: 구현한다**
- [ ] **Step 4: 돌려서 통과를 본다** — 같은 명령 PASS, `npx tsc --noEmit`, `npm run lint`
- [ ] **Step 5: 로컬 미리보기로 본다** — `LOCAL_PREVIEW=1 npx next build` 뒤 `LOCAL_PREVIEW=1 npx next start -p 3210`(백그라운드). 가짜 기록에 확인된 경력이 없으면 `src/dev/local-*.ts`의 씨앗에 확인된 경력 하나·그 아래 사례 하나·딸린 프로젝트 하나를 더한다. 홈 → 경력기술서 공통본 → 만들기 → 한 일 고치기를 Playwright로 누르고 화면 사진(deviceScaleFactor 2, 폰 너비 390과 데스크톱)을 사용자에게 보낸다
- [ ] **Step 6: 커밋** — `feat: 트랙의 경력기술서 공통본 화면을 더한다`

## Task 7: 쓰기 프롬프트 점검

**Files:**
- Create: `src/modules/applications/career-prompt-check.ts`, `career-prompt-check.test.ts`
- Modify: `src/modules/experiences/actions.ts`(점검 목록에 `runCareerCheck`, 주석의 호출 수 27), `src/app/(app)/admin/prompt-check.tsx`(호출 수 27)

**Interfaces:**
- Consumes: Task 4 `writeCareerItems`, Task 3 `checkCareer`·`buildItem`, `CheckRow`
- Produces: `export async function runCareerCheck(db: Db, ai: AiClient, userId: string, now?: Date): Promise<CheckRow[]>` (이 PR에서는 호출 1번)
- 예시: 경력 "한빛소프트 · 백엔드팀 · 주임" 아래 ① 사례 "주문 API 응답 시간 개선"(수치 "응답 시간 1.2초 → 0.4초", 하지 않은 것 "인프라 설계", 금지 표현 "주도") ② 프로젝트 "사내 정산 시스템"(tools ["Kotlin", "Spring"], 사례 하나, 수치 없음)
- 점검 줄: "①의 한 일이 비지 않는다", "①의 성과에 1.2초·0.4초 말고 다른 숫자가 없다", "쓰면 안 되는 표현(주도)이 없다", "인프라 설계를 했다고 쓰지 않는다", "②의 성과에 숫자가 없다", "②의 줄에 ①의 내용(응답 시간)이 섞이지 않는다", 그리고 진단용 "AI가 보낸 답(진단용)"(늘 통과, 600자)

- [ ] **Step 1: 실패하는 테스트를 쓴다** — 가짜 AI로 "좋은 답이면 모든 줄이 통과", "②에 숫자가 있으면 그 줄이 실패", "AI 실패면 줄마다 실패: (사유)"
- [ ] **Step 2: 돌려서 실패를 본다** — `npx vitest run src/modules/applications/career-prompt-check.test.ts`
- [ ] **Step 3: 구현한다**
- [ ] **Step 4: 돌려서 통과를 본다** — 같은 명령 PASS
- [ ] **Step 5: 커밋** — `feat: 경력기술서 쓰기 프롬프트 점검을 더한다`

PR 1을 올린다(`/ship`). 합친 뒤 관리 화면 프롬프트 점검을 사용자에게 부탁한다(호출 27번).

---

# PR 2: 맞춤본과 제출본

## Task 8: 강조 고르기와 맞춤본 만들기

**Files:**
- Modify: `src/modules/applications/resume-tailor.ts`(`emphasisText`에 `purpose` 인자), `src/modules/applications/career-actions.ts`, `src/dev/local-ai.ts`, `src/modules/applications/career-prompt-check.ts`(+테스트), `src/modules/experiences/actions.ts`·`src/app/(app)/admin/prompt-check.tsx`(호출 수 28)
- Create: `src/modules/applications/career-tailor.ts`, `career-tailor.test.ts`

**Interfaces:**
- Consumes: Task 1~5
- Produces:
  ```ts
  // resume-tailor.ts: 기본값이 resume_emphasis라 부르는 곳은 그대로다
  export async function emphasisText(db, ai, userId, input: EmphasisInput, now?, onRaw?, purpose: "resume_emphasis" | "career_emphasis" = "resume_emphasis");
  // career-tailor.ts
  export async function selectCareerEmphasis(db, ai, userId, postingId, now?): Promise<{ ok: true; value: CareerSelection } | { ok: false; reason: "not_found" | "not_apply" | "submitted" | "no_common" | "over_limit" | AiFailure }>;
  export async function buildTailoredCareer(db, ai, userId, postingId, itemIds: string[], expectedVersion: number | null, now?): Promise<{ ok: true; value: CareerContent } | { ok: false; reason: "not_found" | "not_apply" | "submitted" | "no_common" | "changed" | "too_many_selected" | "over_limit" | AiFailure }>;
  // career-actions.ts
  export async function selectCareerEmphasisAction(postingId: string): Promise<Result>;
  export async function buildTailoredCareerAction(postingId: string, itemIds: string[], expectedVersion: number | null): Promise<Result>;
  ```
- 규칙은 `selectEmphasis`·`buildTailored`와 같다: 후보는 공통본에 있고 지금 "사용"인 항목(공통본 순서), 고른 것은 `withEditLock` 안에서 `saveTailoredCareerSelection`. 만들기는 보낸 id 중 지금 쓸 수 있는 항목만(요약만도 받음, 5개 넘으면 `too_many_selected`), 읽은 version과 다르면 AI 전에 `changed`, 0개면 공통본을 그대로 복사(AI 없음), 고른 것은 자세히·강조로 공고와 함께 다시 쓰고 `emphasizeItems`, AI가 뺀 항목은 공통본 항목에 강조만 켠다. 공통본에 없는 항목은 그 회사(없으면 회사 머리를 만들어) 맨 위에 넣는다
- `local-ai.ts`: `career_emphasis`는 `resume_emphasis`와 같은 가짜 답
- 프롬프트 점검에 강조 1번 더함: 공고 "주문 API 성능 개선 경험자", 후보 ①② → "①을 강조한다", "②를 강조하지 않는다", "①의 이유가 비지 않는다"

- [ ] **Step 1: 실패하는 테스트를 쓴다** — "공통본이 없으면 no_common", "후보가 없으면 AI 없이 noMatch", "AI가 고른 것을 이유와 함께 저장한다(purpose career_emphasis로 사용량에 남는다)", "0개면 공통본을 그대로 복사한다", "고른 항목이 회사 맨 위로 오르고 강조가 켜진다", "공통본에 없는 항목은 그 회사 맨 위에 넣는다", "6개면 too_many_selected", "version이 다르면 AI 전에 changed", "제출로 잠기면 submitted", "다른 사용자의 공고면 not_found", "emphasisText의 기본 purpose는 resume_emphasis 그대로"
- [ ] **Step 2: 돌려서 실패를 본다** — `npx vitest run src/modules/applications/career-tailor.test.ts src/modules/applications/resume-tailor.test.ts src/modules/applications/career-prompt-check.test.ts`
- [ ] **Step 3: 구현한다**
- [ ] **Step 4: 돌려서 통과를 본다** — 같은 명령 PASS
- [ ] **Step 5: 커밋** — `feat: 공고에 맞춰 경력기술서 항목을 강조한 맞춤본을 만든다`

## Task 9: 맞춤본 화면과 제출본

**Files:**
- Modify: `src/app/(app)/postings/[id]/resume/emphasis-picker.tsx`(액션·문구를 props로), `src/app/(app)/postings/[id]/resume/page.tsx`(이력서 액션을 넘긴다), `src/app/(app)/postings/[id]/documents-section.tsx`, `src/app/(app)/postings/[id]/page.tsx`, `src/app/(app)/postings/[id]/submit-panel.tsx`, `src/app/(app)/postings/[id]/submissions/[number]/page.tsx`, `src/modules/applications/types.ts`, `src/modules/applications/submit.ts`, `src/modules/applications/submit.test.ts`
- Create: `src/app/(app)/postings/[id]/career/page.tsx`

**Interfaces:**
- Consumes: Task 3·6·8
- Produces (`types.ts`): `export type SubmittedCareer = { from: "tailored" | "common"; content: CareerContent };` `SubmissionContent`에 `career?: SubmittedCareer | null`
- Produces (`submit.ts`): `freeze(posting, questions, resume, names, answerNames, career: SubmittedCareer | null = null)`가 `career`를 담는다. `submitPosting`은 고른 서류에 `career`가 있을 때만 `pickCareer`(맞춤본 → 공통본, 회사 0개는 없음). `submitPreview`의 반환에 `careerFrom: "tailored" | "common" | null`, 경고 "경력기술서가 없습니다", "경력기술서 맞춤본이 없어 트랙 공통본으로 냅니다", "경력기술서에 표시가 남은 항목: n개"(항목·회사 표시를 센다)
- `EmphasisPicker` props에 `select: (postingId: string) => Promise<Result>`, `build: (postingId: string, ids: string[], version: number | null) => Promise<Result>`, `noun: "경험" | "항목"`, `limit: number`를 더한다(서버 액션을 서버 컴포넌트에서 넘긴다). `OtherView.fact`는 경력기술서에서 늘 false
- 맞춤본 화면(`/postings/[id]/career`): 이력서 맞춤본 화면과 같은 갈래(잠김 안내, 지원 아님 안내, 공통본 없음 → `/tracks/{trackId}/career` 링크, 확인된 경력 없음 → "경력이 없어 경력기술서를 만들 수 없습니다", 고르기, 편집 화면 `readOnly={!canAct}`). 다른 항목의 이름은 `회사 · 항목 이름`
- `documents-section.tsx`: `career`면 `/postings/{id}/career` 링크(`잠김이면 "보기"`, 아니면 `"경력기술서 맞춤본"`). `page.tsx`의 지원 아닌 공고 링크 줄에 맞춤본이 있으면 "경력기술서 맞춤본 보기". `SubmitPanel`에 `withCareer` prop과 얼릴 목록의 `경력기술서(맞춤본|트랙 공통본|없음)`
- 제출본 화면: `career`가 있으면 "경력기술서 · 맞춤본|트랙 공통본" 구역(복사 단추 `careerText`, 회사·항목을 편집 화면과 같은 모양으로 읽기만). 키가 없거나 null이면 구역을 그리지 않는다

- [ ] **Step 1: 실패하는 테스트를 쓴다** (`submit.test.ts`) — "경력기술서를 고르면 맞춤본을 얼린다", "맞춤본이 없으면 공통본을 얼린다", "경력기술서를 고르지 않으면 career는 null", "경력기술서가 없으면 경고하고 career는 null", "표시가 남은 항목을 센다", "freeze의 career 기본값은 null(옛 호출 그대로)", "옛 제출본은 career 없이 그린다"(career 키가 없는 `SubmissionContent`로 제출본 화면의 데이터 함수를 부를 때 깨지지 않는다. 화면이 데이터 함수를 따로 두지 않으면 `careerText`·구역을 고르는 작은 함수를 페이지 옆에 두고 그것을 시험한다)
- [ ] **Step 2: 돌려서 실패를 본다** — `npx vitest run src/modules/applications/submit.test.ts`
- [ ] **Step 3: 구현한다**
- [ ] **Step 4: 돌려서 통과를 본다** — `npm test`(전체), `npx tsc --noEmit`, `npm run lint`
- [ ] **Step 5: 로컬 미리보기로 본다** — 지원 공고에서 서류에 경력기술서 체크 → 경력기술서 맞춤본 → 강조 고르기 → 맞춤본 만들기 → 공고 화면 `제출함` → 제출본 화면의 경력기술서 구역. 사진(폰·데스크톱)을 사용자에게 보낸다
- [ ] **Step 6: 커밋** — `feat: 경력기술서 맞춤본 화면을 더하고 제출본에 얼린다`

PR 2를 올린다(`/ship`). 합친 뒤 `docs/status.md`를 고치고(5-7 끝, 다음 할 일은 옛 표 지우기), 이 문서 끝에 판단표 점검을 적는다.

---

## 구현하며 달라진 점

(구현하며 적는다)

## 검토에서 고친 것

(검토 뒤 적는다)

## 판단표 점검

(계획이 끝날 때 적는다)
