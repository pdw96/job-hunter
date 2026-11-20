# Job Hunter 5-4번 계획: 경험 기록 개편 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 경험 기록을 메뉴(기본정보·학력·경력·자격·어학·수상·경험 사례)로 나누고 메뉴마다 새 표를 만든다. 이력 사실은 `맞음` 한 번, 장면은 지금 루브릭으로 확인한다. 지금 기록을 사용자마다 한 번 새 표로 옮기고, 자소서 고르기·이력서·채점·제출본이 새 표를 읽게 한다.

**Architecture:** `experiences` 모듈에 이력 사실 표 7개(학력, 교육 과정, 경력, 공백, 자격·어학·수상, 프로젝트, 활동)와 장면 표 1개, 새 구조의 주장 표, 옮기기 표를 더한다. 앞의 네 PR은 새 표·화면·옮기기·잇기를 **꺼진 스위치**(`newRecordsOn()`) 뒤에 합치고, 다섯째 "바꾸기" PR에서 스위치를 켠다. 자소서·이력서·채점은 지금의 `WritingSource`·`ResumeSource`·`EvidenceCandidate` 모양을 그대로 받으므로, 새 표를 그 모양으로 바꾸는 어댑터(`record-sources.ts`)와 스위치에 따라 고르는 `sources.ts`만 바꾸면 된다.

**Tech Stack:** Next.js 16(App Router), Drizzle + Postgres(테스트는 PGlite), zod, Vitest

**Spec:** `docs/superpowers/specs/2026-11-20-records-and-documents-design.md`의 5.1, 5.2, 5.9, 5.10, 5.11, 6, 9장 1번. 예시 화면(사용자 승인): https://claude.ai/artifact/Rf5Aap4uqYXkRu2384vc92 의 ①②⑥

## 정한 것 (설계가 빌더에게 맡긴 것)

- **표 10개**(새로): `experiences_education`(학교), `experiences_courses`(교육 과정), `experiences_jobs`(경력), `experiences_gaps`(공백), `experiences_credentials`(자격·어학·수상), `experiences_projects`, `experiences_activities`, `experiences_scenes`(장면), `experiences_record_claims`(새 구조의 주장), `experiences_moves`(옮기기 진행). 공백과 교육 과정은 칸이 달라 합치지 않는다. `experiences_interviews`에는 칸만 더한다
- **트랙별 사용 범위**는 표마다 `track_scopes jsonb`(`Record<trackId, Scope>`, 없는 키는 "사용") 칸으로 둔다. 머리와 장면이 둘 다 있으면 **더 좁은 쪽**을 쓴다(제외 > 요약만 > 사용)
- **머리 지우기**: 장면이 달린 경력·프로젝트·활동은 지우지 않고 "장면 N개가 있습니다. 장면을 먼저 지우거나 다른 곳으로 옮겨 주세요"를 보인다. 경력·학교·교육 과정을 지우면 거기 딸린 프로젝트의 소속은 비운다(`set null`)
- **프로젝트의 소속**(「결정」 2026-11-20, 사용자): 프로젝트는 조직 하나(경력의 회사, 학력의 학교, 교육 과정의 기관)에 딸리거나 아무 데도 딸리지 않는다(개인). 소속(`parent`)은 내용 칸이 아니다. 바꿔도 확인이 풀리지 않는다
- **학교 소재지**(「결정」 2026-11-20, 사용자): 회사 자사양식 이력서에 학교 위치를 묻는 곳이 있어 학력에 `소재지` 칸(선택)을 둔다
- **머리의 기간을 바꾸면** 기간이 빈(머리의 기간을 쓰는) 장면의 기간 판정을 다시 계산한다
- **주장**: 장면, 경력의 담당 업무 줄, 프로젝트의 한 줄 요약에만 둔다. 가져오기·옮기기로 만든 것만 주장을 갖는다. 같은 답 버튼을 쓴다
- **옮기기**: 옛 기록 하나가 한 단위다. 화면이 한 단위씩 서버 액션을 불러(시간 제한을 피함) 진행을 보인다. 프로젝트·기타는 코드가 칸에 그대로 옮기고(확인됨이었으면 확인 상태·루브릭·주장 답을 이어 감), 학력·교육·자격·공백·재직은 새 가져오기(Task 7)에 그 기록의 글을 넣어 AI가 나눈다. 옮긴 장면의 금지 표현과 "하지 않은 것"은 옛 기록의 것을 그대로 붙인다(재직에서 나온 장면 여럿에는 모두). 모든 기록을 옮긴 뒤 AI가 프로젝트의 소속(회사·학교·교육 기관)을 한 번에 제안한다. 같은 단위를 두 탭에서 동시에 돌리지 않게 `running`으로 잡고, 5분이 지난 `running`은 다시 잡을 수 있다
- **스위치**: `src/modules/experiences/switch.ts`의 `newRecordsOn()`. 바꾸기 전에는 `process.env.NEW_RECORDS === "1"`일 때만 켜진다(실서비스에는 넣지 않는다. 로컬 미리보기와 테스트만). 바꾸기 PR에서 `true`로 고정한다. 꺼져 있으면 새 화면은 `notFound()`, 새 서버 액션은 "아직 열리지 않은 기능입니다"를 돌려준다
- **어댑터의 id와 version**: 자소서용 원천은 장면 하나(id = 장면 id), 이력서용 원천은 머리 하나(경력·프로젝트·활동, 그 아래 쓸 수 있는 장면을 묶음)와 이력 사실 하나. `contentVersion`은 들어간 행들의 `(id, contentVersion)`을 이은 글의 FNV-1a 32비트 값이다(`versionHash`). 어느 행이 바뀌거나 장면이 더해지고 빠져도 값이 바뀐다
- **이력서의 이력 사실**(학력·교육 과정·자격·어학·수상·공백)은 코드가 줄을 만들고(`codeLines`) AI에 보내지 않는다. 강조 후보에도 넣지 않는다. 경력 항목의 머리에는 담당 업무 줄(`heading.duties`)을 코드가 붙인다
- **옛 기록을 가리키던 답·이력서**: 바꾼 뒤에 근거·항목의 id가 옛 표의 id이면 "기록 구조가 바뀌어 다시 만들어야 합니다"로 표시한다(`structureChanged`). 다시 만들기는 지금 있는 버튼(다시 고르기, 다시 쓰기)을 쓴다. 제출로 잠긴 공고는 건드리지 않는다
- **AI 목적(`AiPurpose`)**을 셋 더한다: `import_records`(새 가져오기), `extract_scene`(장면 인터뷰 정리), `migrate`(옮기기: 나누기·주장·소속). 판정과 인터뷰 질문은 지금 목적(`judge`, `interview`)을 그대로 쓴다

## Global Constraints

- `CLAUDE.md`, `docs/conventions.md`의 데이터 접근 규칙과 AI 사용 규칙, 앞 계획들의 Global Constraints를 따른다: AI 호출은 `runAi()`, 모델 `claude-sonnet-5-5`, 연락처는 AI에 보내지 않음, 가져온 자료는 확인이 필요한 주장, 테이블 이름은 `experiences_<이름>`
- 새 표는 모두 `user_id`가 `auth_user(id)`를 `on delete cascade`로 참조하고, repo 함수의 첫 두 인자는 `(db, userId)`, 모든 쿼리에 `userId` 조건, repo마다 "다른 사용자의 것은 읽히지 않는다" 테스트를 둔다
- 이력 사실에 서술형 칸(상황·결과)을 두지 않는다. 짧은 칸은 100자(`LIMITS.shortText`), 담당 업무는 줄마다 100자·8줄까지, 장면의 긴 칸은 4,000자(`LIMITS.longText`)
- 월은 `YYYY-MM`. 끝 월은 시작 월보다 앞설 수 없다. 재직 중·진행 중이면 끝 월이 없다
- **지원서에는 확인됨만 쓴다**: 이력 사실은 `맞음`을 누른 것, 장면은 장면이 확인됨이고 머리도 확인됨. 적합도 채점은 확인됨·부분 확인 장면(머리 확인 여부는 보지 않음)과 확인된 이력 사실
- 옛 표(`experiences_experiences` 등)는 지우지도 고치지도 않는다(지우기는 5-7 뒤 따로). 옮기기는 옛 표를 읽기만 한다
- 앞 네 PR이 합쳐진 상태에서 실서비스 동작은 바뀌지 않는다(스위치 꺼짐). 바꾸기 PR 하나로 모든 사용자에게 한 번에 켠다
- 화면을 바꾸면 `NEW_RECORDS=1 LOCAL_PREVIEW=1`로 로컬 미리보기를 띄워 확인하고 사진을 사용자에게 보낸다
- 새 AI 작업마다 프롬프트 점검(`prompt-check`)에 예시를 더한다
- 판단표 ②: 모든 PR이 새 표·`schema.ts`·`src/modules/ai/**`·`src/dev/**` 중 하나를 바꾸므로 합치기 전에 사용자에게 묻는다

## Review Focus

1. 옮기는 중에 화면을 닫거나 두 탭에서 연다 → 같은 기록이 두 번 옮겨지지 않고, 다시 들어오면 남은 것부터 이어 간다 (Task 8 테스트 "동시에 두 번 돌려도 하나만 옮긴다", "running이 5분 지나면 다시 잡는다")
2. 경력의 회사 이름·기간을 고친다 → 그 아래 장면이 자소서 원천에서 빠지고(머리 미확인), 기간이 빈 장면의 기간 판정이 바뀐다 (Task 2·Task 4 테스트)
3. 확인됐던 프로젝트를 옮긴다 → 바꾼 날 자소서 원천이 0개가 되지 않는다: 장면·머리가 확인됨이고 루브릭과 주장 답이 그대로다 (Task 8 테스트)
4. 바꾼 뒤 옛 기록을 근거로 한 자소서 답·이력서를 연다 → 화면이 깨지지 않고 "기록 구조가 바뀌어 다시 만들어야 합니다"가 보이며, 제출본은 그대로 읽힌다 (Task 11 테스트)
5. 장면이 달린 경력을 지우려 한다 / 남의 머리 id로 장면을 만든다 → 지워지지 않고 이유가 보인다 / `not_found` (Task 2·Task 4 테스트)

---

# PR 1: 새 표 (쓰지 않음)

## Task 1: 표, 입력 검사, 선택지

**Files:**
- Modify: `src/modules/experiences/schema.ts`, `docs/conventions.md`(experiences 줄의 테이블 목록)
- Create: `src/modules/experiences/record-options.ts`, `src/modules/experiences/record-input.ts`, `src/modules/experiences/record-input.test.ts`, `src/modules/experiences/switch.ts`, `drizzle/0016_*.sql`(`npm run db:generate`)

**Interfaces:**
- Produces (`record-options.ts`):
  ```ts
  export const FACT_KINDS = ["education", "course", "job", "gap", "credential", "project", "activity"] as const;
  export type FactKind = (typeof FACT_KINDS)[number];
  export const HEAD_KINDS = ["job", "project", "activity"] as const satisfies readonly FactKind[];
  export type HeadKind = (typeof HEAD_KINDS)[number];
  export type HeadRef = { kind: HeadKind; id: string };
  export const DEGREES = ["high", "associate", "bachelor", "master", "doctor"] as const;   // 고등학교/전문학사/학사/석사/박사
  export const SCHOOL_STATUSES = ["graduated", "expected", "enrolled", "leave", "completed", "dropped"] as const; // 졸업/졸업 예정/재학/휴학/수료/중퇴
  export const GPA_SCALES = ["4.5", "4.3", "4.0"] as const;
  export const EMPLOYMENTS = ["regular", "contract", "intern", "freelance", "parttime"] as const; // 정규직/계약직/인턴/프리랜서/아르바이트
  export const CREDENTIAL_TYPES = ["license", "language", "award"] as const; // 자격증/어학/수상
  export const PARENT_KINDS = ["job", "education", "course"] as const satisfies readonly FactKind[]; // 프로젝트가 딸릴 수 있는 조직
  export type ProjectParent = { kind: (typeof PARENT_KINDS)[number]; id: string } | null; // null = 개인
  export const RECORD_LIMITS = { duties: 8, dutyLength: 100, tools: 10, summary: 200 };
  // 각 배열마다 *_LABELS: Record<값, 한국어>
  export type RecordSource = "manual" | "interview" | "import" | "migrate";
  ```
- Produces (`record-input.ts`): 메뉴마다 입력 타입과 검사 함수. 검사 함수는 `validateExperience`와 같은 모양 `(raw: unknown) => { ok: true; value: T } | { ok: false; errors: Partial<Record<keyof T, string>> }`
  ```ts
  export type EducationInput = { schoolName: string; location: string | null; degree: Degree; major: string | null; startMonth: string | null; endMonth: string | null; status: SchoolStatus; gpa: string | null; gpaScale: GpaScale | null };
  export type CourseInput = { name: string; institution: string | null; startMonth: string | null; endMonth: string | null; hours: number | null; learned: string | null };
  export type JobInput = { company: string; department: string | null; title: string | null; employment: Employment; startMonth: string | null; endMonth: string | null; isOngoing: boolean; duties: string[]; bannedPhrases: string[] };
  export type GapInput = { startMonth: string | null; endMonth: string | null; note: string | null };
  export type CredentialInput = { type: CredentialType; name: string; issuer: string | null; month: string | null; score: string | null };
  export type ProjectInput = { name: string; parent: ProjectParent; startMonth: string | null; endMonth: string | null; isOngoing: boolean; role: string | null; tools: string[]; summary: string | null; bannedPhrases: string[] };
  export type ActivityInput = { name: string; organization: string | null; startMonth: string | null; endMonth: string | null; isOngoing: boolean; role: string | null };
  export type SceneInput = { head: HeadRef; title: string; startMonth: string | null; endMonth: string | null; isOngoing: boolean; situation: string | null; judgment: string | null; actions: string | null; result: string | null; lessons: string | null; metrics: Metric[]; notDone: string | null; bannedPhrases: string[]; evidenceNote: string | null; tags: string[] };
  export type FactInputs = { education: EducationInput; course: CourseInput; job: JobInput; gap: GapInput; credential: CredentialInput; project: ProjectInput; activity: ActivityInput };
  export function validateFact<K extends FactKind>(kind: K, raw: unknown): { ok: true; value: FactInputs[K] } | { ok: false; errors: Record<string, string> };
  export function validateScene(raw: unknown): { ok: true; value: SceneInput } | { ok: false; errors: Partial<Record<keyof SceneInput, string>> };
  // 이 칸들이 바뀌면 내용이 바뀐 것(확인을 푼다). project의 parent는 들어가지 않는다
  export const FACT_CONTENT_FIELDS: { [K in FactKind]: readonly (keyof FactInputs[K])[] };
  export const SCENE_CONTENT_FIELDS: readonly (keyof SceneInput)[]; // head, title, 기간, 다섯 서술 칸, metrics, notDone
  ```
  필수: 학교 이름·학위·상태, 과정 이름, 회사 이름·고용 형태, 공백의 시작·끝 월, 자격 종류·이름, 프로젝트 이름, 활동 이름, 장면 제목·머리. 고등학교는 전공을 비워도 된다. 재학·휴학이면 졸업 월을 받지 않는다(null로 둔다). `gpa`는 `^\d(\.\d{1,2})?$`이고 `gpaScale`보다 크지 않다. `gpa`가 있으면 `gpaScale` 필수. `hours`는 1~10000 정수. `location`(학교 소재지, 예: "서울")은 선택, 100자. 문자열은 앞뒤 공백을 자르고 빈 글은 null, 목록은 빈 줄을 버리고 중복을 없앤다(`input.ts`의 `text`·`stringList`를 내보내 함께 쓴다)
- Produces (`schema.ts`): 공통 칸 묶음 `factColumns()` = `id` text pk, `user_id`(cascade, not null), `confirmed_at` timestamptz null, `content_version` int not null default 0, `source` text `RecordSource` not null default 'manual', `track_scopes` jsonb `Record<string, Scope>` not null default `{}`, `moved_from` text null(옛 기록 id, 외래 키 없음), `created_at`, `updated_at`. 표마다 `factColumns()`에 위 입력 칸을 snake_case로 더하고 `index(...).on(userId)`를 둔다. 목록 칸(`duties`, `tools`, `banned_phrases`, `metrics`, `tags`)은 jsonb not null default `[]`
  - `experiences_projects`: `job_id` → `experiences_jobs(id)`, `education_id` → `experiences_education(id)`, `course_id` → `experiences_courses(id)`, 모두 `on delete set null`, `check("experiences_projects_one_parent", sql\`num_nonnulls(job_id, education_id, course_id) <= 1\`)`
  - `experiences_scenes`: `factColumns()` + `job_id`/`project_id`/`activity_id`(각각 해당 표를 참조, 기본 동작 `no action`) + `check("experiences_scenes_one_head", sql\`num_nonnulls(job_id, project_id, activity_id) = 1\`)` + SceneInput의 나머지 칸 + `rubric` jsonb `StoredRubric` not null, `phrase_candidates`, `dismissed_phrases` jsonb default `[]`, `judged_at` timestamptz null
  - `experiences_record_claims`: `id`, `user_id`(cascade), `scene_id`/`job_id`/`project_id`(각각 `on delete cascade`, 하나만: `num_nonnulls(...) = 1`), `kind`, `quote`, `phrase`, `status`, `origin`, `position`, `created_at`, `updated_at`(지금 `experiences_claims`와 같은 칸)
  - `experiences_moves`: `id`, `user_id`(cascade), `step` text `"record" | "affiliate"`, `old_id` text null(step이 record일 때), `status` text `"pending" | "running" | "done" | "failed"` default 'pending', `attempts` int default 0, `error` text null, `started_at` timestamptz null, `updated_at`. `uniqueIndex("experiences_moves_user_old_idx").on(userId, oldId)`
  - `experiences_interviews`에 `scene_id`(→ scenes, cascade) null, `head_kind` text null, `head_id` text null을 더한다
- Produces (`switch.ts`): `export function newRecordsOn(): boolean` — 지금은 `process.env.NEW_RECORDS === "1"`

- [ ] **Step 1: 실패하는 테스트를 쓴다** (`record-input.test.ts`)
  - 메뉴마다 필수 칸이 비면 그 칸에 오류: `validateFact("education", { degree: "bachelor", status: "graduated" }).errors.schoolName`이 있다
  - 월: `"2023-13"` → 오류, 끝 월 `"2023-01"` < 시작 `"2023-03"` → `endMonth` 오류, 재직 중이면 `endMonth`가 null
  - 학력: `status: "enrolled"`이면 `endMonth`를 넣어도 null; `gpa: "4.6", gpaScale: "4.5"` → 오류; `gpa: "3.8"`에 `gpaScale` 없음 → 오류
  - 경력: 담당 업무 9줄 → 오류, 101자 줄 → 오류, 빈 줄은 버려진다
  - 프로젝트: `parent: { kind: "activity", id: "x" }` → 오류; `parent: null`은 개인으로 통과
  - 장면: `head` 없음 → 오류, `head.kind`가 `"education"` → 오류, 긴 칸 4,001자 → 오류, 수치 11개 → 오류
  - `FACT_CONTENT_FIELDS.project`에 `parent`가 없다
- [ ] **Step 2: 돌려서 실패를 본다** — `npx vitest run src/modules/experiences/record-input.test.ts`
- [ ] **Step 3: 선택지·입력 검사·표·스위치를 만들고 `npm run db:generate`로 마이그레이션을 만든다.** `src/db/test-db.test.ts`가 새 마이그레이션으로도 통과하는지 함께 본다
- [ ] **Step 4: 돌려서 통과를 본다** — 같은 명령, `npx vitest run src/db`, `npx tsc --noEmit`
- [ ] **Step 5: 커밋** — `feat: 경험 기록 개편의 새 표와 입력 검사를 더한다`

## Task 2: 이력 사실 repo

**Files:**
- Create: `src/modules/experiences/facts-repo.ts`, `src/modules/experiences/facts-repo.test.ts`

**Interfaces:**
- Consumes: Task 1 전부, `ownsTrack`·`listTrackIds`(tracks/repo). 주장 맞추기는 Task 3, 머리 기간이 바뀔 때 장면 다시 판정은 Task 4가 이 파일에 더한다
- Produces:
  ```ts
  export type Fact<K extends FactKind = FactKind> = { kind: K; id: string; value: FactInputs[K]; isConfirmed: boolean; contentVersion: number; source: RecordSource; trackScopes: Record<string, Scope>; movedFrom: string | null; createdAt: Date; updatedAt: Date };
  export type FactsByKind = { [K in FactKind]: Fact<K>[] }; // 메뉴마다 시작 월 최근 순, 시작 월 없음은 아래
  export async function createFact<K extends FactKind>(db, userId, kind: K, input: FactInputs[K], options?: { source?: RecordSource; movedFrom?: string; confirmed?: boolean; trackScopes?: Record<string, Scope> }): Promise<string>;
  export async function getFact<K extends FactKind>(db, userId, kind: K, id: string): Promise<Fact<K> | null>;
  export async function listFacts(db, userId): Promise<FactsByKind>;
  export async function updateFact<K extends FactKind>(db, userId, kind: K, id: string, input: FactInputs[K]): Promise<{ ok: true } | { ok: false; reason: "not_found" }>;
  export async function deleteFact(db, userId, kind: FactKind, id: string): Promise<{ ok: true } | { ok: false; reason: "not_found" } | { ok: false; reason: "has_scenes"; count: number }>;
  export async function confirmFact(db, userId, kind: FactKind, id: string): Promise<{ ok: true } | { ok: false; reason: "not_found" | "claims_pending" }>;
  export async function unconfirmFact(db, userId, kind: FactKind, id: string): Promise<{ ok: true } | { ok: false; reason: "not_found" }>;
  export async function setFactTrackScope(db, userId, kind: FactKind, id: string, trackId: string, scope: Scope): Promise<{ ok: true } | { ok: false; reason: "not_found" }>;
  export async function countRecords(db, userId): Promise<number>; // 이력 사실 + 장면 수(홈 화면용)
  ```
  표는 `FACT_TABLES: { [K in FactKind]: 표 }` 하나로 고른다. `updateFact`는 `FACT_CONTENT_FIELDS[kind]`가 바뀌었을 때만 `confirmed_at`을 비우고 `content_version`을 1 올린다. 이 작업의 `confirmFact`는 주장을 보지 않는다(Task 3이 더한다). `setFactTrackScope`는 트랙이 본인 것일 때만 jsonb에 키 하나를 쓴다(`jsonb_set`)

- [ ] **Step 1: 실패하는 테스트를 쓴다** (`facts-repo.test.ts`, `createTestDb()`)
  - 메뉴마다 만들기 → `listFacts`에 그 메뉴로 나오고 미확인; `confirmFact` → 확인됨; 이름만 아닌 내용 칸(예: 학교 전공)을 고치면 미확인으로 돌아가고 `contentVersion`이 1 오른다; 내용이 같으면 그대로
  - 프로젝트의 `parent`만 바꾸면 확인이 유지된다; 남의 경력·학교·교육 과정을 `parent`로 주면 `not_found`(`createFact`·`updateFact` 모두)
  - 장면이 없는 경력은 지워진다; 경력·학교·교육 과정을 지우면 딸린 프로젝트의 `parent`가 null(장면이 달린 경력의 `has_scenes`는 Task 4에서 시험한다)
  - 남의 트랙으로 `setFactTrackScope` → `not_found`; 내 트랙 → `trackScopes`에 들어간다
  - 다른 사용자: `u2`의 `getFact`·`listFacts`·`updateFact`·`deleteFact`·`confirmFact`는 `u1`의 것을 읽거나 바꾸지 못한다
- [ ] **Step 2: 돌려서 실패를 본다** — `npx vitest run src/modules/experiences/facts-repo.test.ts`
- [ ] **Step 3: `facts-repo.ts`를 구현한다**
- [ ] **Step 4: 돌려서 통과를 본다**
- [ ] **Step 5: 커밋** — `feat: 이력 사실을 저장하고 맞음으로 확인한다`

## Task 3: 주장 규칙을 넓히고 새 주장 repo

**Files:**
- Modify: `src/modules/experiences/claims.ts`, `src/modules/experiences/claims.test.ts`, `src/modules/experiences/claims-repo.ts`, `src/modules/experiences/import.ts`(옛 기록은 `subjectOfExperience`로 부른다), `src/modules/experiences/facts-repo.ts`(경력·프로젝트의 `updateFact`가 주장을 맞추고, `confirmFact`가 열린 주장이면 `claims_pending`)
- Create: `src/modules/experiences/record-claims-repo.ts`, `src/modules/experiences/record-claims-repo.test.ts`

**Interfaces:**
- Produces (`claims.ts`): 주장 규칙이 `ExperienceInput` 대신 "주장을 찾을 글 묶음"을 받는다. 옛 동작은 그대로다(지금 `claims.test.ts`가 그대로 통과해야 한다)
  ```ts
  export type ClaimSubject = { period: string | null; prose: (string | null)[]; other: (string | null)[]; metrics: Metric[] };
  export function subjectOfExperience(input: ExperienceInput): ClaimSubject;         // 지금 칸 그대로
  export function subjectOfScene(input: SceneInput): ClaimSubject;                   // period: 장면에 기간이 있으면 그 글, prose: 상황·판단·한 일·결과·배운 점, other: 제목·하지 않은 것·증빙 메모
  export function subjectOfJob(input: JobInput): ClaimSubject;                       // period: null, prose: 담당 업무 줄, other: [], metrics: []
  export function subjectOfProject(input: ProjectInput): ClaimSubject;               // period: null, prose: [summary], other: [], metrics: []
  // findClaims, proseContains, mergeClaims, stillPresent, claimsAfterEdit가 ClaimSubject를 받는다
  ```
- Produces (`record-claims-repo.ts`): `claims-repo.ts`와 같은 일을 `experiences_record_claims`에 한다
  ```ts
  export type ClaimOwner = { kind: "scene" | "job" | "project"; id: string };
  export async function listRecordClaims(db, userId, owner: ClaimOwner): Promise<Claim[]>;
  export async function insertRecordClaims(db, userId, owner: ClaimOwner, found: (FoundClaim & { status?: ClaimStatus })[], startPosition?: number): Promise<void>;
  export async function syncRecordClaimsAfterEdit(db, owner: ClaimOwner, subject: ClaimSubject): Promise<void>;
  export async function hasOpenRecordClaims(db, owner: ClaimOwner): Promise<boolean>;
  export async function countOpenRecordClaims(db, userId): Promise<Record<string, number>>; // 주인 id → 열린 수
  export async function answerRecordClaim(db, userId, claimId: string, answer: ClaimAnswer): Promise<{ ok: true; status: ClaimStatus } | { ok: false; reason: "not_found" | "not_allowed" | "banned_full" }>;
  ```
  `updateFact`(경력·프로젝트, `source`가 import·migrate)는 같은 트랜잭션에서 `syncRecordClaimsAfterEdit`를 부르고 열린 주장이 남으면 `confirmed_at`을 비운다. `answerRecordClaim`의 규칙은 `answerClaim`과 같다. 장면은 수치 줄 지우기·금지 표현 넣기가 그대로다. 경력·프로젝트에는 수치 줄이 없으므로 `unknown`은 `needs_fix`가 되고, `exaggerated`는 그 머리의 `banned_phrases`에 넣는다. 수치 줄을 지워 장면 내용이 바뀌면 `confirmed_at`을 비우고 `content_version`을 올리고 루브릭을 다시 계산한다(Task 4의 `sceneContentResetFields`)

- [ ] **Step 1: 실패하는 테스트를 쓴다**
  - `claims.test.ts`에 더함: `findClaims(subjectOfJob({ …, duties: ["물류센터 출고 일정 관리", "주간 보고서 30건 작성 주도"] }))`가 둘째 줄을 수치 주장(phrase "주도")으로 낸다; `subjectOfProject`의 요약에 숫자가 없고 과장 낱말도 없으면 주장이 없다; `subjectOfScene`의 `lessons` 칸 숫자도 주장이 된다
  - `record-claims-repo.test.ts`: 장면 주장에 `unknown` → 그 수치 줄이 지워지고 장면이 미확인·`contentVersion`+1; 경력 주장에 `exaggerated` → 경력의 `bannedPhrases`에 phrase가 들어가고 `needs_fix`; 경력 주장에 `unknown` → `needs_fix`; 담당 업무 줄을 고쳐 그 구절이 사라지면 `needs_fix` → `fixed`(`updateFact` 경유); 열린 주장이 있으면 `confirmFact("job")` → `claims_pending`; 남의 주장 id → `not_found`; `countOpenRecordClaims`는 주인별 수
- [ ] **Step 2: 돌려서 실패를 본다** — `npx vitest run src/modules/experiences/claims.test.ts src/modules/experiences/record-claims-repo.test.ts`
- [ ] **Step 3: `claims.ts`를 `ClaimSubject`로 바꾸고(옛 호출부는 `subjectOfExperience`로) `record-claims-repo.ts`를 만든다.** Task 2의 경력·프로젝트 주장 맞추기를 잇는다
- [ ] **Step 4: 돌려서 통과를 본다** — 같은 명령과 `npx vitest run src/modules/experiences`
- [ ] **Step 5: 커밋** — `feat: 주장 규칙을 장면·담당 업무·프로젝트 요약에도 쓴다`

## Task 4: 장면 repo, 확인 규칙, AI 판정

**Files:**
- Create: `src/modules/experiences/scene-rules.ts`, `src/modules/experiences/scene-rules.test.ts`, `src/modules/experiences/scenes-repo.ts`, `src/modules/experiences/scenes-repo.test.ts`, `src/modules/experiences/scene-judge.ts`, `src/modules/experiences/scene-judge.test.ts`
- Modify: `src/modules/experiences/prompts.ts`(`describeScene` 추가), `src/modules/experiences/facts-repo.ts`(머리의 기간이 바뀌면 같은 트랜잭션에서 그 머리의 장면 중 `start_month`가 빈 것의 `rubric.period`를 `scenePeriodStatus`로 다시 계산. 장면이 달린 머리 지우기는 `has_scenes`)

**Interfaces:**
- Consumes: Task 1~3, `verification.ts`의 `initialRubric`·`verificationState`·`rubricAfterContentEdit`·`canClose`(장면은 `kind: "project"` 규칙과 같다: 기간·본인 역할·수준 필수, 수치·증빙은 닫을 수 있음), `JUDGE_SYSTEM`·`judgementSchema`(judge.ts)
- Produces (`scene-rules.ts`, 순수 함수):
  ```ts
  export type HeadPeriod = { startMonth: string | null; endMonth: string | null; isOngoing: boolean };
  export function scenePeriodStatus(scene: HeadPeriod, head: HeadPeriod): "met" | "unmet"; // 장면의 시작 월이 비면 머리의 기간으로 판정
  export function sceneState(rubric: Rubric, isConfirmed: boolean): VerificationState;
  export function sceneUsable(state: VerificationState, headConfirmed: boolean): boolean; // 확인됨 && 머리 확인됨
  export function narrowerScope(a: Scope, b: Scope): Scope; // exclude > summary > use
  export function versionHash(parts: (string | number)[]): number; // FNV-1a 32비트, 0 이상 정수
  ```
- Produces (`scenes-repo.ts`):
  ```ts
  export type Scene = SceneInput & { id: string; rubric: StoredRubric; isConfirmed: boolean; state: VerificationState; contentVersion: number; phraseCandidates: string[]; dismissedPhrases: string[]; judgedAt: Date | null; source: RecordSource; trackScopes: Record<string, Scope>; movedFrom: string | null; createdAt: Date; updatedAt: Date };
  export type SceneSummary = Pick<Scene, "id" | "head" | "title" | "startMonth" | "endMonth" | "isOngoing" | "state" | "source">;
  export async function createScene(db, userId, input: SceneInput, options?: { source?: RecordSource; movedFrom?: string; carry?: { rubric: StoredRubric; confirmedAt: Date | null }; trackScopes?: Record<string, Scope> }): Promise<{ ok: true; id: string } | { ok: false; reason: "not_found" }>; // 머리가 본인 것이 아니면 not_found
  export async function getScene(db, userId, id): Promise<Scene | null>;
  export async function listScenes(db, userId): Promise<SceneSummary[]>;
  export async function updateScene(db, userId, id, input: SceneInput): Promise<{ ok: true } | { ok: false; reason: "not_found" }>;
  export async function deleteScene(db, userId, id): Promise<{ ok: true } | { ok: false; reason: "not_found" }>;
  export async function confirmScene(db, userId, id, options?: { withHead?: boolean }): Promise<{ ok: true } | { ok: false; reason: "not_found" | "claims_pending" | "head_claims_pending" }>;
  export async function unconfirmScene(db, userId, id): Promise<{ ok: true } | { ok: false; reason: "not_found" }>;
  export async function closeSceneRubricItem(db, userId, id, item: RubricItem): Promise<{ ok: true } | { ok: false; reason: "not_found" | "not_allowed" }>;
  export async function reopenSceneRubricItem(db, userId, id, item: RubricItem): Promise<{ ok: true } | { ok: false; reason: "not_found" | "not_allowed" }>;
  export async function setSceneTrackScope(db, userId, id, trackId, scope: Scope): Promise<{ ok: true } | { ok: false; reason: "not_found" }>;
  export function sceneContentResetFields(rubric: StoredRubric, period: "met" | "unmet"): {…}; // rubric-store.ts의 contentResetFields와 같은 일을 장면 표에
  ```
  `confirmScene(withHead: true)`는 한 트랜잭션에서 머리를 먼저 확인하고(`confirmFact`, 머리에 열린 주장이 있으면 `head_claims_pending`이고 아무것도 바꾸지 않음) 장면을 확인한다. `closeSceneRubricItem`은 `repo.ts`의 `setClosed`처럼 그 항목 하나만 `jsonb_set`으로 바꾼다. 장면의 머리를 바꾸는 것은 내용 변경이다
- Produces (`scene-judge.ts`): `judgeScene(db, ai, userId, sceneId, now?)`, `approveScenePhrase(db, userId, id, phrase)`, `dismissScenePhrase(db, userId, id, phrase)`, `listSceneEvidenceTodos(db, userId)` — `judge.ts`의 같은 이름 함수와 같은 규칙(목적 `judge`, `JUDGE_SYSTEM`, `contentVersion`이 그대로일 때만 반영, 닫은 항목은 건드리지 않음). 보내는 글은 `describeScene(scene, head)`: 장면 칸과 머리(회사·부서·직급 또는 프로젝트 이름·역할 또는 활동 이름·기관)와 판정에 쓸 기간

- [ ] **Step 1: 실패하는 테스트를 쓴다**
  - `scene-rules.test.ts`: 장면 기간 없음 + 머리 `2022-03 ~ 2024-08` → met; 장면 기간 없음 + 머리 시작 월 없음 → unmet; 장면 `2023-05 ~ 2023-02` → unmet; `sceneUsable("confirmed", false)` → false; `narrowerScope("summary", "exclude")` → exclude; `versionHash(["a", 1]) !== versionHash(["a", 2])`, 같은 입력은 같은 값
  - `facts-repo.test.ts`에 더함: 경력의 시작 월을 지우면 그 경력 아래 기간이 빈 장면의 `rubric.period.status`가 `unmet`이 되고 기간이 있는 장면은 그대로; 장면이 달린 경력 지우기 → `{ reason: "has_scenes", count: 1 }`이고 남아 있다
  - `scenes-repo.test.ts`: 만들면 미확인·루브릭 period가 머리로 판정됨; 남의 머리 id → `not_found`; 내용을 고치면 미확인·`contentVersion`+1·닫은 수치는 유지; `confirmScene` 뒤 state는 루브릭에 따라 partial/confirmed; `withHead`면 머리도 확인됨; 머리에 열린 주장 → `head_claims_pending`이고 장면도 그대로 미확인; 장면에 열린 주장 → `claims_pending`; 다른 사용자는 읽고 바꾸지 못한다
  - `scene-judge.test.ts`(`createFakeAi`): 판정이 role·level에 반영되고 `judgedAt`이 찬다; 판정하는 사이 내용을 고치면 `changed`; 보낸 글에 머리의 회사 이름이 있고 증빙 메모와 금지 표현은 없다(`describeExperience`와 같은 범위)
- [ ] **Step 2: 돌려서 실패를 본다** — `npx vitest run src/modules/experiences/scene-rules.test.ts src/modules/experiences/scenes-repo.test.ts src/modules/experiences/scene-judge.test.ts src/modules/experiences/facts-repo.test.ts`
- [ ] **Step 3: 구현한다**
- [ ] **Step 4: 돌려서 통과를 본다** — 같은 명령, `npx tsc --noEmit`, `npm run lint`
- [ ] **Step 5: 커밋** — `feat: 장면을 저장하고 루브릭으로 확인한다`
- [ ] **Step 6: PR 1을 올린다** — `/ship`. ②에서 사용자에게 묻는다(새 표)

# PR 2: 메뉴 화면 (스위치 뒤)

## Task 5: 경험 기록 메뉴와 이력 사실 화면

**Files:**
- Create: `src/modules/experiences/record-actions.ts`, `src/modules/experiences/record-actions.test.ts`, `src/app/(app)/records/page.tsx`, `src/app/(app)/records/fact-card.tsx`, `src/app/(app)/records/fact-form.tsx`, `src/app/(app)/records/facts/[kind]/new/page.tsx`, `src/app/(app)/records/facts/[kind]/[id]/page.tsx`, `src/app/(app)/records/head-claims.tsx`

**Interfaces:**
- Consumes: Task 2, 3. `ClaimsPanel`(`experiences/claims-panel.tsx`)의 버튼 모양을 따른다
- Produces (`record-actions.ts`, `"use server"`, `SimpleResult = { ok: true } | { ok: false; message: string }`, 모두 `requireUser()` 뒤 `newRecordsOn()`이 꺼져 있으면 `{ ok: false, message: "아직 열리지 않은 기능입니다" }`):
  ```ts
  export async function saveFactAction(kind: FactKind, id: string | null, input: unknown, scopes: unknown): Promise<{ ok: true; id: string } | { ok: false; errors: Record<string, string>; message?: string }>;
  export async function deleteFactAction(kind: FactKind, id: string): Promise<SimpleResult>;   // has_scenes면 "장면 N개가 있습니다. 장면을 먼저 지우거나 다른 곳으로 옮겨 주세요"
  export async function setFactConfirmedAction(kind: FactKind, id: string, confirmed: boolean): Promise<SimpleResult>; // claims_pending이면 "줄 확인이 남아 있습니다"
  export async function answerRecordClaimAction(claimId: string, answer: ClaimAnswer): Promise<SimpleResult>;
  ```
  저장 뒤 `revalidatePath("/records")`, `revalidatePath("/records/scenes")`
- 화면 `/records?tab=basic|school|job|credential` (스위치가 꺼져 있으면 `notFound()`):
  - 탭: 기본정보 / 학력 / 경력 / 자격·어학·수상 / 경험 사례(`/records/scenes`로 가는 링크). 기본값 학력
  - 기본정보: `/settings/contact`로 가는 카드 하나("AI에 보내지 않음")
  - 학력: "학교" 구역과 "교육 과정" 구역, 경력: 경력과 공백을 시작 월 최근 순으로 섞어 보인다, 자격·어학·수상: 한 목록(종류 표시)
  - 카드: 짧은 칸 모두, 상태(미확인·확인됨), 미확인이면 `맞음`·`고치기`, 확인됨이면 `고치기`. 경력·프로젝트에 열린 주장이 있으면 `맞음`이 꺼지고 "줄 확인이 남아 있습니다 N개"와 줄마다 답 버튼(`head-claims.tsx`: 맞음 / 과장임 / 숫자 모름 / 틀림·고칠게요)
  - 아래에 `+ 학교 추가`처럼 구역마다 추가 링크(`/records/facts/education/new`)
  - 고치기 화면(`fact-form.tsx`): 메뉴마다 칸, 선택지는 버튼·드롭다운, 트랙별 사용 범위(지금 기록 화면과 같은 모양), 저장·지우기. 프로젝트는 소속(내 경력·학교·교육 과정 중 하나 고르기 / 개인), 학력은 소재지 칸

- [ ] **Step 1: 실패하는 테스트를 쓴다** (`record-actions.test.ts`. 액션 테스트는 지금 다른 모듈의 액션 테스트처럼 `requireUser`를 `vi.mock`하고 `vi.stubEnv("NEW_RECORDS", "1")`)
  - 스위치가 꺼져 있으면 `saveFactAction` → "아직 열리지 않은 기능입니다"이고 아무것도 저장되지 않는다
  - 잘못된 입력 → 칸별 `errors`; 올바른 입력 → `ok`와 id, 범위가 저장된다
  - 장면이 달린 경력 지우기 → 위 문구
- [ ] **Step 2: 돌려서 실패를 본다** — `npx vitest run src/modules/experiences/record-actions.test.ts`
- [ ] **Step 3: 액션과 화면을 만든다**
- [ ] **Step 4: 돌려서 통과를 본다.** `npx tsc --noEmit`, `npm run lint`. `NEW_RECORDS=1 LOCAL_PREVIEW=1 npx next build` 뒤 `NEW_RECORDS=1 LOCAL_PREVIEW=1 npx next start -p 3210`을 백그라운드로 띄우고 학력·경력·자격 탭에서 추가 → `맞음`을 눌러 본 뒤 사진(학력 탭, 경력 탭)을 사용자에게 보낸다
- [ ] **Step 5: 커밋** — `feat: 경험 기록 메뉴와 이력 사실 화면을 만든다(스위치 뒤)`

## Task 6: 경험 사례 화면

**Files:**
- Modify: `src/modules/experiences/record-actions.ts`(장면 액션), `src/app/(app)/experiences/rubric-panel.tsx`(액션을 props로 받게)
- Create: `src/app/(app)/records/scenes/page.tsx`, `src/app/(app)/records/scenes/new/page.tsx`, `src/app/(app)/records/scenes/[id]/page.tsx`, `src/app/(app)/records/scenes/scene-form.tsx`, `src/app/(app)/records/scenes/confirm-scene.tsx`

**Interfaces:**
- Consumes: Task 4, 5
- Produces (`record-actions.ts`에 더함): `saveSceneAction(id: string | null, input: unknown, scopes: unknown, interviewId?: string)`(인터뷰로 만든 초안이면 인터뷰를 끝내고 `judgeScene`을 한 번 돌린다. 실패해도 저장은 됨), `deleteSceneAction(id)`, `confirmSceneAction(id, withHead: boolean)`(`head_claims_pending`이면 "회사 정보에 줄 확인이 남아 있습니다"), `unconfirmSceneAction(id)`, `judgeSceneAction(id)`, `setSceneRubricClosedAction(id, item, closed)`, `decideScenePhraseAction(id, phrase, approve)`
- `RubricPanel`은 액션 셋(판정, 닫기, 후보 결정, 확인)을 props `actions`로 받는다. 옛 기록 화면은 지금 액션을 넘긴다(동작 그대로)
- 화면 `/records/scenes`(스위치가 꺼져 있으면 `notFound()`): 머리마다 묶음(머리 이름, 구분·기간·장면 수, 머리 상태: 확인됨 / "회사 정보 미확인"), 그 아래 장면(제목, 기간 또는 "기간은 회사 기간을 씀", 상태, 열린 주장 수). 묶음 아래 `+ 장면 추가 (AI 인터뷰 또는 직접 쓰기)`, 맨 아래 `+ 프로젝트`·`+ 활동`(경력은 경력 탭에서 만든다). 경력·프로젝트·활동 중 장면이 없는 머리도 묶음으로 보인다
- 장면 화면 `/records/scenes/[id]`: 주장 패널(장면 주장), 장면 폼, `RubricPanel`. 장면을 확인할 때 머리가 미확인이면 `confirm-scene.tsx`가 "회사 정보도 맞나요?"와 머리의 짧은 칸을 함께 보이고 `둘 다 맞음` / `장면만 맞음` / `고치기`를 둔다
- 장면 폼: 머리 고르기(드롭다운, 새 장면이면 `?head=job:<id>`로 미리 고름), 제목, 기간(비우면 "머리의 기간을 씀"), 상황·판단·한 일·결과·배운 점, 수치(기준), 하지 않은 것, 쓰면 안 되는 표현, 증빙 메모, 태그, 트랙별 사용 범위

- [ ] **Step 1: 실패하는 테스트를 쓴다** (`record-actions.test.ts`에 더함): `confirmSceneAction(id, true)`가 머리와 장면을 모두 확인; 머리에 열린 주장 → 문구와 함께 실패하고 둘 다 미확인; 스위치가 꺼져 있으면 모든 장면 액션이 거절
- [ ] **Step 2: 돌려서 실패를 본다** — `npx vitest run src/modules/experiences/record-actions.test.ts`
- [ ] **Step 3: 액션과 화면을 만든다.** `RubricPanel`을 props로 바꾼 뒤 옛 기록 화면이 그대로 동작하는지 로컬 미리보기에서 본다
- [ ] **Step 4: 돌려서 통과를 본다.** 로컬 미리보기에서 경력 하나에 장면 둘을 만들고, 미확인 머리로 장면 확인 → `둘 다 맞음`을 눌러 본 뒤 사진(경험 사례, 장면 확인 창)을 보낸다
- [ ] **Step 5: 커밋** — `feat: 경험 사례 화면과 장면 확인을 만든다(스위치 뒤)`

## Task 7: 장면 인터뷰와 새 가져오기

**Files:**
- Create: `src/modules/experiences/scene-interview.ts`, `src/modules/experiences/scene-interview.test.ts`, `src/modules/experiences/record-import.ts`, `src/modules/experiences/record-import.test.ts`, `src/modules/experiences/record-prompt-check.ts`, `src/modules/experiences/record-prompt-check.test.ts`, `src/app/(app)/records/interview/[interviewId]/page.tsx`, `src/app/(app)/records/import/page.tsx`
- Modify: `src/modules/experiences/prompts.ts`(`SCENE_INTERVIEW_CONTEXT`, `SCENE_EXTRACT_SYSTEM`, `RECORD_IMPORT_SYSTEM`), `src/modules/experiences/record-actions.ts`, `src/modules/ai/client.ts`(`AiPurpose`에 `"import_records" | "extract_scene" | "migrate"`), `src/dev/local-ai.ts`(세 목적의 가짜 답), `src/modules/experiences/actions.ts`(`runPromptCheckAction`에 `runRecordCheck`를 더함), `src/app/(app)/experiences/interview/chat.tsx`·`import/import-form.tsx`·`import/zip-import.tsx`(인터뷰·가져오기 액션과 결과 화면을 props로 받게 해 새 화면이 다시 쓴다)

**Interfaces:**
- Consumes: Task 1~4, `interview.ts`의 `answerInterview` 흐름(질문 턴은 목적 `interview`, `INTERVIEW_SYSTEM` 그대로), `import.ts`의 `fitDraft`·숫자 검사·금지 표현 거르기 규칙, `notion-export.ts`
- Produces (`scene-interview.ts`):
  ```ts
  export async function startSceneInterview(db, ai, userId, options: { head?: HeadRef; sceneId?: string; trackId?: string }, now?): Promise<{ ok: true; id: string } | { ok: false; reason: "not_found" | "over_limit" | AiFailure }>;
  export async function draftSceneFromInterview(db, ai, userId, interviewId, now?): Promise<{ ok: true; draft: SceneInput; warnings: Partial<Record<keyof SceneInput, string>> } | { ok: false; reason: "not_found" | "empty" | "no_head" | "over_limit" | AiFailure }>;
  ```
  인터뷰는 머리가 정해진 뒤에만 시작한다(`head` 또는 `sceneId`의 머리). 머리 정보를 대화 앞머리에 넣어 그 회사·프로젝트 안의 한 장면을 묻게 한다. 보완 인터뷰(`sceneId`)는 장면의 `needs_fix` 주장과 미달 루브릭을 함께 넣는다(지금 `buildContext`와 같다). 정리는 목적 `extract_scene`, 스키마는 SceneInput에서 `head`·`bannedPhrases`를 뺀 칸(빈 칸은 빈 글). 대화에 없던 숫자는 경고로 돌려준다(`ungroundedNumbers`)
- Produces (`record-import.ts`):
  ```ts
  export type PreparedClaims = (FoundClaim & { status: "pending" | "needs_fix" })[];
  export type PreparedScene = { input: Omit<SceneInput, "head">; claims: PreparedClaims };
  export type ImportPlan = {
    education: EducationInput[]; courses: CourseInput[]; credentials: CredentialInput[]; gaps: GapInput[];
    jobs: { input: JobInput; claims: PreparedClaims; scenes: PreparedScene[] }[];
    projects: { input: ProjectInput; claims: PreparedClaims; parentIndex: { kind: "job" | "education" | "course"; index: number } | null; scenes: PreparedScene[] }[];
    activities: { input: ActivityInput; scenes: PreparedScene[] }[];
  };
  export async function requestRecordImport(db, ai, userId, sourceText: string, options?: { purpose?: "import_records" | "migrate"; hint?: Kind }, now?): Promise<{ ok: true; plan: ImportPlan; skipped: number; more: boolean } | { ok: false; reason: "over_limit" | "nothing_found" | AiFailure }>;
  export async function saveImportPlan(db, userId, plan: ImportPlan, options: { source: "import" | "migrate"; movedFrom?: string; trackScopes?: Record<string, Scope>; carry?: { notDone: string | null; bannedPhrases: string[] } }): Promise<{ created: { kind: FactKind | "scene"; id: string; name: string }[] }>;
  export async function importRecords(db, ai, userId, sourceText, now?): Promise<{ ok: true; created: …; skipped: number; more: boolean } | { ok: false; reason: … }>;
  ```
  AI 답 스키마는 위 묶음과 같은 모양이다(빈 칸은 빈 글, 경력·프로젝트는 `roleClaims`, 장면은 `roleClaims`와 `bannedPhrases`, 프로젝트는 `parentIndex`). 코드 검사는 지금 `requestImport`와 같다: 한도에 맞춰 자르기(`fitDraft`), 메뉴별 검사 함수를 통과한 것만(아니면 `skipped`), 원본에 없던 숫자가 든 구절은 `needs_fix`, 금지 표현은 원본에 글자 그대로 있는 것만. 한 번에 머리·이력 사실 합쳐 30개, 머리마다 장면 8개까지. `hint`가 있으면(옮기기) 메시지 앞에 "이 글은 예전 기록의 '(구분)' 한 건입니다"를 붙인다. `saveImportPlan`은 한 트랜잭션에서 모두 만들고(모두 미확인), `carry`가 있으면 모든 장면의 "하지 않은 것"(비어 있을 때만)과 금지 표현(합침)에 넣는다. `parentIndex`는 같은 묶음에서 만든 경력·학교·교육 과정의 id로 바꾼다
- Produces (`record-prompt-check.ts`): `runRecordCheck(db, ai, userId, now?): Promise<CheckRow[]>` — 장면 정리 예시 2개(대화의 장면 하나만 정리, 대화에 없던 숫자 경고), 가져오기 예시 1개(학력·자격·경력+장면 2개·프로젝트가 섞인 글: 메뉴별 개수, 학력에 상황 칸이 없음, 원본에 없는 숫자 없음, 경력 장면이 2개 이상)
- 화면: `/records/scenes`의 `+ 장면 추가`가 `AI 인터뷰` / `직접 쓰기`를 고르게 한다. `/records/interview/[id]`는 지금 채팅 화면을 다시 쓰고 정리하면 장면 폼(Task 6)을 띄운다. `/records/import`는 지금 가져오기 화면(붙여 넣기·파일·노션 zip)을 다시 쓰고 결과에 메뉴별로 만든 것을 보인다

- [ ] **Step 1: 실패하는 테스트를 쓴다** (`createFakeAi`)
  - `scene-interview.test.ts`: 머리 없이 시작 → `not_found`; 남의 머리 → `not_found`; 시작한 인터뷰의 첫 메시지에 머리의 회사 이름이 있다; 정리한 초안의 `head`가 인터뷰의 머리; 대화에 없던 숫자 → 그 칸 경고
  - `record-import.test.ts`: 학력 1·자격 1·경력 1(장면 2)·프로젝트 1(`parentIndex: { kind: "job", index: 0 }`)인 가짜 답 → 계획의 개수가 맞고 프로젝트가 경력을 가리킴; 원본에 없던 숫자가 든 장면 구절 → `needs_fix`; 학력 이름이 비면 `skipped` 1; 원본에 없는 금지 표현은 버려짐; `saveImportPlan` 뒤 모두 미확인이고 `source: "import"`, 주장이 장면·경력에 저장; `carry`를 주면 모든 장면에 금지 표현이 들어간다; AI 실패 → 그 사유, 아무것도 저장 안 됨
  - `record-prompt-check.test.ts`: 기대대로 답하는 가짜 AI면 모든 줄 통과, 학력에 상황을 넣은 답이면 그 줄 실패
- [ ] **Step 2: 돌려서 실패를 본다** — `npx vitest run src/modules/experiences/scene-interview.test.ts src/modules/experiences/record-import.test.ts src/modules/experiences/record-prompt-check.test.ts`
- [ ] **Step 3: 구현한다.** `src/dev/local-ai.ts`에 `import_records`(붙여 넣은 글에서 학력 1·경력 1+장면 1을 만드는 고정 답), `extract_scene`(대화의 첫 답을 상황·한 일로 옮긴 답), `migrate`(Task 8에서 채움, 지금은 `import_records`와 같은 답)를 더한다
- [ ] **Step 4: 돌려서 통과를 본다.** 로컬 미리보기에서 가져오기에 글을 붙여 넣고 결과 화면과 만들어진 메뉴를, 경력에 `AI 인터뷰`로 장면을 하나 만들어 보고 사진을 보낸다
- [ ] **Step 5: 커밋** — `feat: 장면 인터뷰와 새 구조로 가져오기를 만든다(스위치 뒤)`
- [ ] **Step 6: PR 2를 올린다** — `/ship`. ②에서 묻는다(`src/modules/ai/**`, `src/dev/**`)

# PR 3: 기록 옮기기 (스위치 뒤)

## Task 8: 옮기기

**Files:**
- Create: `src/modules/experiences/move.ts`, `src/modules/experiences/move.test.ts`, `src/modules/experiences/move-repo.ts`, `src/modules/experiences/move-repo.test.ts`
- Modify: `src/modules/experiences/prompts.ts`(`MOVE_CLAIMS_SYSTEM`, `AFFILIATE_SYSTEM`), `src/modules/experiences/record-prompt-check.ts`(옮기기 예시), `src/dev/local-ai.ts`(`migrate`의 세 메시지)

**Interfaces:**
- Consumes: Task 2~4, 7. 옛 표는 `repo.ts`의 `getExperience`·`listExperiences`·`getTrackScopes`와 `claims-repo.ts`의 `listClaims`로 읽기만 한다
- Produces (`move-repo.ts`):
  ```ts
  export type MoveProgress = { total: number; done: number; failed: { id: string; name: string; error: string }[]; pending: number };
  export async function planMoves(db, userId): Promise<void>;        // 옛 기록마다 record 행(없는 것만), 프로젝트와 조직이 될 기록(재직·학력·교육)이 모두 있으면 affiliate 행 하나. 몇 번 불러도 같다
  export async function needsMove(db, userId): Promise<boolean>;     // 행이 없는 옛 기록이 있거나 pending·running이 있음
  export async function claimNextMove(db, userId, now: Date): Promise<{ id: string; step: "record" | "affiliate"; oldId: string | null } | null>;
  // pending이거나 started_at이 5분 넘은 running 하나를 한 문장의 update … returning으로 running으로 잡는다. affiliate는 record 행이 모두 done·failed일 때만
  export async function finishMove(db, userId, id: string, result: { ok: true } | { ok: false; error: string }): Promise<void>; // attempts+1
  export async function retryMove(db, userId, id: string): Promise<{ ok: true } | { ok: false; reason: "not_found" }>; // failed → pending
  export async function moveProgress(db, userId): Promise<MoveProgress>;
  ```
- Produces (`move.ts`):
  ```ts
  export async function moveRecord(db, ai, userId, oldId: string, now?): Promise<{ ok: true } | { ok: false; error: string }>;
  export async function affiliateProjects(db, ai, userId, now?): Promise<{ ok: true } | { ok: false; error: string }>;
  export async function runNextMove(db, ai, userId, now?): Promise<MoveProgress>; // 하나 잡아 옮기고 진행을 돌려준다. 잡을 것이 없으면 진행만
  ```
  `moveRecord`는 옛 구분에 따라:
  - `project`·`other`: 코드가 옮긴다. 머리(프로젝트: 이름·역할·기간, 소속 없음(개인), 요약 null / 활동: 이름·기관(organization)·역할·기간)와 장면 하나(제목 = 옛 이름, 상황·한 일·결과·수치·하지 않은 것·금지 표현·증빙 메모·태그를 글자 그대로, 판단·배운 점은 비움, 기간은 비워 머리의 기간을 씀). 옛 기록이 **확인됨**이면 장면에 옛 루브릭·`confirmedAt`을 `carry`로 넘기고, 머리도 확인됨으로 만들고, 옛 주장을 상태 그대로 장면 주장으로 복사한다. 아니면 장면은 미확인이고 루브릭은 새로(닫은 수치·증빙은 유지), 주장은 `findClaims(subjectOfScene)` + AI 역할 주장(목적 `migrate`, 첫 줄 `[옮기기: 주장]`, 스키마 `{ quotes: string[] }`)을 `mergeClaims`로 합친다. 옛 주장 답은 옮기지 않는다
  - `school`·`training`·`certificate`·`gap`·`job`: `requestRecordImport(…, describeExperience(옛 기록), { purpose: "migrate", hint: 옛 구분 })` 뒤 기대한 메뉴에 하나 이상 나왔는지 본다(학력→education, 교육→course, 자격→credential, 공백→gap, 재직→job). 아니면 `{ ok: false, error: "나눌 내용을 찾지 못했습니다" }`. 나왔으면 `saveImportPlan(…, { source: "migrate", movedFrom: oldId, trackScopes: 옛 범위, carry: { notDone, bannedPhrases } })`. 모두 미확인
  - 모든 경우 옛 기록의 트랙별 범위를 새 행들의 `trackScopes`로 복사하고 `movedFrom`에 옛 id를 적는다. 한 기록의 저장은 한 트랜잭션이다(실패하면 아무것도 남지 않는다). 이미 `movedFrom`이 그 옛 id인 행이 있으면 저장하지 않고 ok(두 번 옮기지 않음)
  `affiliateProjects`: 옮긴 프로젝트(소속 없음)와 경력·학교·교육 과정의 이름·기관·기간을 별명(P1, J1, S1, C1)으로 보내(목적 `migrate`, 첫 줄 `[옮기기: 소속]`, 스키마 `{ links: { project: string; parent: string }[] }`) 받은 짝마다 프로젝트의 `parent`를 쓴다. 프로젝트 기간이 그 조직의 기간 밖이면 버린다

- [ ] **Step 1: 실패하는 테스트를 쓴다** (옛 기록은 `createExperience`·`confirmExperience`·`insertClaims`로 넣는다)
  - 확인된 프로젝트(루브릭 모두 met, 주장 하나 confirmed) → 프로젝트 머리 확인됨, 장면 확인됨이고 state confirmed, 루브릭·주장 상태가 같다, AI를 부르지 않는다(가짜 AI 답 0개)
  - 미확인 프로젝트 → 장면 미확인, 주장이 새로 생기고 모두 pending, 금지 표현·하지 않은 것이 그대로
  - 재직 하나(가짜 AI가 경력 1 + 장면 2) → 경력 1·장면 2, 모두 미확인, 두 장면 모두 옛 금지 표현을 가진다, `moved_from`이 옛 id
  - 학력인데 AI가 학력을 하나도 안 냄 → `ok: false`, 새 행 없음
  - 같은 옛 기록을 두 번 → 둘째는 저장 없이 ok
  - `move-repo.test.ts`: `planMoves` 두 번 → 행 수 같음; "동시에 두 번 돌려도 하나만 옮긴다": `Promise.all([claimNextMove, claimNextMove])`가 같은 행을 둘 다 잡지 않는다; "running이 5분 지나면 다시 잡는다": `now`를 6분 뒤로 주면 다시 잡힌다, 4분이면 안 잡힌다; affiliate는 record가 하나라도 pending이면 잡히지 않는다; `retryMove` → pending; `needsMove`는 모두 done·failed면 false; 다른 사용자의 행은 잡지도 보지도 못한다
  - `affiliateProjects`: 기간 안의 짝은 쓰이고 기간 밖은 버려진다; 학교에 딸린 짝도 쓰인다; 확인된 프로젝트에 소속을 써도 확인이 유지된다
- [ ] **Step 2: 돌려서 실패를 본다** — `npx vitest run src/modules/experiences/move.test.ts src/modules/experiences/move-repo.test.ts`
- [ ] **Step 3: 구현한다.** 프롬프트 점검에 옮기기 예시를 더한다(재직 기록 하나 → 경력 1 + 장면 2개 이상, 원본에 없는 숫자 없음 / 프로젝트 2·경력 1·학교 1의 소속 짝)
- [ ] **Step 4: 돌려서 통과를 본다** — 같은 명령과 `npx vitest run src/modules/experiences`
- [ ] **Step 5: 커밋** — `feat: 예전 기록을 새 구조로 옮긴다(스위치 뒤)`

## Task 9: 옮기기 화면과 첫 진입

**Files:**
- Create: `src/app/moving/page.tsx`, `src/app/moving/mover.tsx`, `src/modules/experiences/move-actions.ts`, `src/modules/experiences/move-actions.test.ts`
- Modify: `src/app/(app)/layout.tsx`, `src/app/(app)/records/page.tsx`(옮기지 못한 기록 띠)

**Interfaces:**
- Consumes: Task 8
- Produces (`move-actions.ts`): `moveNextAction(): Promise<{ ok: true; progress: MoveProgress } | { ok: false; message: string }>`(한도에 닿으면 "이번 달 AI 사용 한도에 닿았습니다…"를 돌려주고 그 행은 failed로 둔다), `retryMoveAction(id: string): Promise<SimpleResult>`
- `layout.tsx`: `newRecordsOn()`이고 `await planMoves(db, user.id)` 뒤 `await needsMove(db, user.id)`이면 `redirect("/moving")`. `/moving`은 `(app)` 밖에 두어 되돌아오지 않는다(자체로 `requireUser()`를 부르고 스위치가 꺼져 있으면 `notFound()`)
- `/moving`: "기록을 새 구조로 옮기는 중" 제목, 진행 막대(`role="progressbar"`, N개 중 M개), 클라이언트가 `moveNextAction`을 `pending`이 0이 될 때까지 차례로 부른다(한 번에 하나). 끝나면 옛 구분별 결과 줄, 옮기지 못한 것마다 `다시 시도`, 안내 "확인됐던 기록은 내용을 그대로 옮겨 확인 상태를 이어 갑니다. 학력·자격은 칸이 바뀌어 `맞음`을 한 번 눌러 주세요", `기록 보기`(→ `/records`)
- `/records`: 실패한 행이 있으면 위에 "옮기지 못한 기록 N개 · 다시 시도"(→ `/moving`)

- [ ] **Step 1: 실패하는 테스트를 쓴다** (`move-actions.test.ts`): 스위치가 꺼져 있으면 거절; 옛 기록 2개(프로젝트 확인됨, 학력)를 `moveNextAction` 세 번 → 마지막 진행이 `{ total: 2, done: 2, pending: 0 }`; 한도 초과 → 문구와 함께 그 행 failed, `retryMoveAction` 뒤 pending
- [ ] **Step 2: 돌려서 실패를 본다** — `npx vitest run src/modules/experiences/move-actions.test.ts`
- [ ] **Step 3: 구현한다**
- [ ] **Step 4: 돌려서 통과를 본다.** 로컬 DB는 프로세스마다 새로 만들어지므로 스위치를 켠 채 한 번 띄운다. `/experiences/new`로 옛 기록(확인된 프로젝트, 재직, 학력)을 만든 뒤 주소창에서 `/records`를 새로 불러오면(레이아웃은 전체 불러오기 때 돈다) `/moving`으로 가고, 끝나면 `/records`에 옮긴 것이 보이는지 본다. 사진(옮기는 중, 끝난 결과)을 보낸다
- [ ] **Step 5: 커밋** — `feat: 첫 진입 때 기록을 옮기는 화면을 만든다(스위치 뒤)`
- [ ] **Step 6: PR 3을 올린다** — `/ship`. ②에서 묻는다

# PR 4: 기존 기능을 새 표에 잇기 (스위치 뒤)

## Task 10: 새 표를 지금 원천 모양으로 바꾸는 어댑터

**Files:**
- Create: `src/modules/experiences/record-sources.ts`, `src/modules/experiences/record-sources.test.ts`, `src/modules/experiences/sources.ts`, `src/modules/experiences/sources.test.ts`
- Modify: `src/modules/experiences/writing.ts`(`WritingSource`·`ResumeSource` 타입에 칸 더함), 원천을 부르는 곳 모두(`src/modules/applications/{select,write,check,resume-write,resume-tailor,resume-entries,resume-check,submit}.ts`, `src/modules/postings/{analyze,apply}.ts`, `src/app/(app)/postings/page.tsx`, `src/app/(app)/postings/[id]/page.tsx`, `src/app/(app)/postings/[id]/application/page.tsx`, `src/app/(app)/postings/[id]/resume/page.tsx`, `src/app/(app)/tracks/[trackId]/resume/page.tsx`, `src/app/(app)/_resume/editor-data.ts`): import를 `writing`·`evidence`에서 `sources`로 바꾼다

**Interfaces:**
- Produces (`writing.ts` 타입): `ResumeSource`에 `codeLines?: string[]`(있으면 이력 사실: 코드가 쓴 줄, AI에 보내지 않음)와 `duties?: string[]`(경력 머리의 담당 업무)를 더한다. 옛 원천은 두 칸이 없다
- Produces (`record-sources.ts`):
  ```ts
  export async function listSceneWritingSources(db, userId, trackId): Promise<WritingSource[]>;
  export async function listRecordResumeSources(db, userId, trackId): Promise<ResumeSource[]>;
  export async function listRecordEvidence(db, userId, trackId): Promise<EvidenceCandidate[]>;
  export async function recordNames(db, userId): Promise<Map<string, string>>; // 장면 id → 제목, 이력 사실 id → 이름(제출본 얼리기용)
  ```
  - 자소서 원천: `sceneUsable`인 장면 중 `narrowerScope(머리 범위, 장면 범위) === "use"`. `id` = 장면 id, `name` = 제목, `kind` = 머리가 경력이면 `"job"`, 프로젝트면 `"project"`, 활동이면 `"other"`, `organization` = 회사(경력이면 "회사 · 부서") / 프로젝트 이름(소속이 있으면 "프로젝트 이름 · 소속 조직 이름") / 활동 이름, `role` = 직급·직책 / 프로젝트 역할 / 활동 역할, 기간 = 장면 기간(비면 머리 기간), `situation`·`actions`·`result`·`notDone`·`bannedPhrases`는 장면 것(판단은 `actions` 앞에 "판단: …"으로, 배운 점은 `result` 뒤에 "배운 점: …"으로 붙인다), `metrics`는 루브릭 수치가 met일 때만, `contentVersion` = `versionHash([장면 id, 장면 version, 머리 id, 머리 version])`. 순서는 기간 시작 월 최근 순
  - 이력서 원천: 확인된 머리마다 하나(범위가 제외가 아닌 것, `scope`는 머리 범위). 그 아래 장면 중 확인됨이고 장면 범위가 제외가 아닌 것을 `actions`에 "[장면 제목] 상황: … / 한 일: … / 결과: …" 덩어리로 잇는다(장면 범위가 요약만이면 덩어리 끝에 "(요약만)"). 장면이 없어도 머리 하나로 들어간다. 프로젝트의 `organization`은 소속 조직 이름(회사·학교·교육 과정, 없으면 null). 경력은 `duties`, `bannedPhrases`는 머리와 장면의 합, `metrics`는 장면들의 합(루브릭 met만). `contentVersion` = 머리와 들어간 장면들의 `(id, version)`으로 만든 `versionHash`. 확인된 이력 사실(학력·교육 과정·자격·공백, 범위가 제외가 아닌 것)은 하나씩, `kind`는 school / training / certificate / gap, `codeLines`:
    - 학력: `[전공, 학위 이름, 상태 이름].filter(Boolean).join(" · ")` + 학점이 있으면 `" · 학점 3.8/4.5"`
    - 교육 과정: 기관·교육 시간(`"600시간"`) 한 줄, 배운 것이 있으면 둘째 줄
    - 자격·어학·수상: `[종류 이름, 기관, 점수·등급].filter(Boolean).join(" · ")`
    - 공백: 한 일이 있으면 그 한 줄, 없으면 `[]`
    `name`은 학교 이름 / 과정 이름 / 자격 이름 / "공백 기간". 자격의 기간은 취득 월(`kind: "certificate"`라 `formatPeriod`가 "취득"으로 쓴다)
  - 채점 근거: 장면 중 `sceneState`가 confirmed·partial이고 범위가 제외가 아닌 것(머리 확인 여부는 보지 않음, 위 자소서 원천과 같은 칸) + 확인된 이력 사실(학력·교육 과정·자격, 경력 머리: `actions`에 담당 업무를 줄로, `situation`·`result`는 null, `state: "confirmed"`)
- Produces (`sources.ts`): 스위치에 따라 고른다
  ```ts
  export async function listWritingSources(db, userId, trackId): Promise<WritingSource[]>;   // 켜짐: listSceneWritingSources, 꺼짐: writing.ts의 것
  export async function listResumeSources(db, userId, trackId): Promise<ResumeSource[]>;
  export async function listEvidenceCandidates(db, userId, trackId): Promise<EvidenceCandidate[]>;
  export async function sourceNames(db, userId): Promise<Map<string, string>>;             // 켜짐: recordNames, 꺼짐: listExperiences의 이름
  export type { WritingSource, ResumeSource, EvidenceCandidate };
  ```
  `submit.ts`의 `listExperiences`로 이름을 만들던 곳은 `sourceNames`로 바꾼다

- [ ] **Step 1: 실패하는 테스트를 쓴다**
  - `record-sources.test.ts`: 확인된 장면 + 미확인 머리 → 자소서 원천에 없음, 채점 근거에 있음; 머리를 확인하면 자소서 원천에 있고 `organization`이 회사 이름; 머리 범위 요약만 + 장면 범위 사용 → 자소서 원천에 없음(요약만); 장면의 수치는 루브릭 수치가 met일 때만; 머리 이름을 고치면 그 장면의 `contentVersion`이 바뀐다
  - 이력서 원천: 확인된 경력에 확인된 장면 2개(하나는 요약만) → 원천 하나, `actions`에 두 제목과 "(요약만)", `duties`가 담당 업무; 장면 하나를 지우면 `contentVersion`이 바뀐다; 장면 없는 확인된 프로젝트도 나온다; 학력 `{ major: "산업공학과", degree: "bachelor", status: "graduated", gpa: "3.8", gpaScale: "4.5" }` → `codeLines` `["산업공학과 · 학사 · 졸업 · 학점 3.8/4.5"]`; 미확인 학력은 없다
  - 채점 근거: 확인된 학력·자격이 들어가고 부분 확인 장면도 들어간다; 제외한 것은 없다
  - 다른 사용자의 트랙 → 셋 모두 `[]`
  - `sources.test.ts`: 스위치를 끄면 옛 원천, 켜면 새 원천(`vi.stubEnv`)
- [ ] **Step 2: 돌려서 실패를 본다** — `npx vitest run src/modules/experiences/record-sources.test.ts src/modules/experiences/sources.test.ts`
- [ ] **Step 3: 구현하고 원천을 부르는 곳의 import를 `sources`로 바꾼다**
- [ ] **Step 4: 돌려서 통과를 본다** — 같은 명령과 `npm test`(스위치가 꺼져 있으므로 기존 테스트가 모두 그대로 통과해야 한다), `npx tsc --noEmit`
- [ ] **Step 5: 커밋** — `feat: 새 기록을 자소서·이력서·채점 원천 모양으로 바꾼다(스위치 뒤)`

## Task 11: 이력서의 코드 줄·담당 업무와 옛 기록 표시

**Files:**
- Modify: `src/modules/applications/types.ts`(`ResumeHeading`에 `duties?: string[]`), `src/modules/applications/resume-entries.ts`·`resume-write.ts`·`resume-tailor.ts`·`resume-check.ts`·`check.ts`와 각 `.test.ts`, `src/app/(app)/_resume/resume-editor.tsx`, `src/app/(app)/postings/[id]/application/draft-view.tsx`, `src/app/(app)/postings/[id]/resume/emphasis-picker.tsx`, `src/modules/experiences/sources.ts`(`oldRecordIds`)

**Interfaces:**
- Consumes: Task 10
- Produces:
  - `buildEntry(source, …)`: `source.codeLines`가 있으면 `lines`를 그 줄(`edited: false`)로 채우고, `source.duties`가 있으면 `heading.duties`에 넣는다
  - `startCommonResume`·`rewriteEntries`·`buildTailored`: `codeLines`가 있는 원천은 AI에 보내지 않고 `buildEntry`로 바로 만든다. AI에 보낼 원천이 하나도 없으면 AI를 부르지 않는다
  - 강조 후보(`resume-tailor.ts`): `codeLines`가 있는 원천은 후보에서 뺀다(지금의 학력·자격 빼기를 이 규칙으로 바꾼다). 사용자가 직접 올리면 맨 위로만 옮긴다(AI 다시 쓰기 없음)
  - `resumeText()`와 편집 화면: 머리 아래에 담당 업무를 "담당: A, B, C" 한 줄로 보인다
  - `export async function oldRecordIds(db, userId): Promise<Set<string>>`(`sources.ts`): 스위치가 켜져 있으면 옛 표의 그 사용자 기록 id, 꺼져 있으면 빈 집합
  - `checkDraft(…, options?: { oldIds?: Set<string> })`: 문단 근거가 `oldIds`에 있으면 그 문단에 `structureChanged: true`(`staleSource` 대신). `checkResume(…, options?: { oldIds?: Set<string> })`: 항목 id가 `oldIds`에 있으면 `structureChanged: true`(`unavailable` 대신). 화면 문구 "기록 구조가 바뀌어 다시 만들어야 합니다". 자소서는 그 문항의 `다시 고르기`, 이력서는 `다시 쓰기`를 함께 보인다. 제출 전 확인(`submitPreview`)의 "표시가 남은" 판정에도 들어간다

- [ ] **Step 1: 실패하는 테스트를 쓴다**
  - `resume-entries.test.ts`: `codeLines`·`duties`가 있는 원천 → 항목의 lines와 `heading.duties`; `resumeText`에 "담당: " 줄
  - `resume-write.test.ts`: 이력 사실만 있는 트랙 → 공통본이 만들어지고 가짜 AI 요청이 0개; 머리 1 + 학력 1 → AI 요청의 글에 학교 이름이 없다
  - `resume-tailor.test.ts`: 강조 후보에 `codeLines` 원천이 없다
  - `check.test.ts`·`resume-check.test.ts`: `oldIds`에 든 근거 → `structureChanged`, `staleSource`·`unavailable`은 false; `oldIds`가 없으면 지금과 같다
- [ ] **Step 2: 돌려서 실패를 본다** — `npx vitest run src/modules/applications`
- [ ] **Step 3: 구현한다.** 화면이 `oldRecordIds`를 불러 검사에 넘긴다
- [ ] **Step 4: 돌려서 통과를 본다** — `npm test`, `npx tsc --noEmit`, `npm run lint`
- [ ] **Step 5: 커밋** — `feat: 이력서의 이력 사실을 코드가 쓰고, 옛 기록을 가리키는 답을 표시한다`
- [ ] **Step 6: PR 4를 올린다** — `/ship`. ②에서 묻는다

# PR 5: 바꾸기

## Task 12: 스위치를 켜고 옛 메뉴를 닫는다

**Files:**
- Modify: `src/modules/experiences/switch.ts`(`return true`), `src/app/(app)/layout.tsx`(메뉴 "경험 기록" → `/records`), `src/app/(app)/page.tsx`(`countExperiences` → `countRecords`, 링크 `/records`), `src/modules/experiences/actions.ts`(옛 기록의 쓰기 액션: 저장·지우기·확인·닫기·판정·후보·인터뷰·가져오기·주장 답이 "경험 기록이 새 구조로 바뀌었습니다"를 돌려준다. `runPromptCheckAction`은 옛 판정·정리·가져오기 예시를 빼고 새 예시를 돈다), `src/modules/experiences/prompt-check.ts`(옛 예시 제거), `src/app/(app)/admin/prompt-check.tsx`(호출 수 문구), `docs/conventions.md`, `docs/status.md`, 이 계획 문서 끝
- Create: `src/app/(app)/experiences/page.tsx`·`[id]/page.tsx`·`new/page.tsx`·`import/page.tsx`·`interview/[interviewId]/page.tsx`를 `redirect("/records")`만 하는 페이지로 바꾼다(옛 화면 부품 `experience-form.tsx` 등은 다른 곳에서 쓰지 않으면 지운다. 새 화면이 다시 쓰는 `chat.tsx`·`import-form.tsx`·`zip-import.tsx`·`rubric-panel.tsx`·`claims-panel.tsx`·`state-badge.tsx`는 `src/app/(app)/records/_shared/`로 옮긴다)
- Test: `src/modules/experiences/actions.test.ts`(없으면 만든다), 스위치를 전제로 한 테스트의 `vi.stubEnv` 정리

**Interfaces:**
- Consumes: Task 1~11 전부
- 옛 표 읽기 함수(`repo.ts`의 `getExperience`·`listExperiences`·`getTrackScopes`, `claims-repo.ts`의 `listClaims`)와 옛 표 정의는 남긴다(옮기기가 쓴다). 옛 표를 지우는 일은 이 계획 밖이다

- [ ] **Step 1: 실패하는 테스트를 쓴다**: 옛 `saveExperienceAction` → 위 문구이고 옛 표에 행이 생기지 않는다; `newRecordsOn()`이 환경 변수 없이 true; 홈의 기록 수가 새 표 수
- [ ] **Step 2: 돌려서 실패를 본다** — `npx vitest run src/modules/experiences`
- [ ] **Step 3: 구현한다.** 테스트의 `vi.stubEnv("NEW_RECORDS", …)`를 지운다. 스위치를 끈 경우를 보던 테스트("아직 열리지 않은 기능입니다")는 지운다
- [ ] **Step 4: 돌려서 통과를 본다** — `npm test`, `npx tsc --noEmit`, `npm run lint`. 로컬 미리보기(환경 변수 없이)에서 처음부터 끝까지 걷는다: 옛 경로 `/experiences` → `/records`; 학력 추가·`맞음`; 경력 + 장면 2개(하나는 AI 인터뷰) 확인; 공고 하나를 `지원`으로 정해 자소서 고르기에 장면이 후보로 나오는지, 트랙 공통본에 학력이 코드 줄로·경력에 담당 업무가 나오는지, 채점에 학력이 근거로 쓰이는지. 사진(메뉴, 경험 사례, 자소서 고르기, 이력서)을 보낸다
- [ ] **Step 5: `docs/status.md`를 고친다**: 끝난 것에 5-4, 다음 할 일 5-5, 남은 확인에 "바꾼 뒤 사용자가 처음 들어와 옮기기가 끝났는지, 옮기지 못한 것이 있는지, 확인됐던 프로젝트가 그대로 확인됨인지 본다". `docs/conventions.md`의 experiences 줄(맡는 일, 테이블). 이 계획 끝에 "구현하다 달라진 점"과 판단표 점검
- [ ] **Step 6: 커밋** — `feat: 경험 기록을 새 구조로 바꾼다`
- [ ] **Step 7: PR 5를 올린다** — `/ship`. ②에서 묻는다. 합친 뒤 ④로 배포를 확인하고, 사용자에게 "앱에 들어가면 기록 옮기기가 한 번 돕니다. 끝난 뒤 학력·자격에 `맞음`을 눌러 주세요"를 알린다

---

## 구현하다 달라진 점

(구현하면서 적는다)

## 판단 기록

(PR마다 PR 본문에 적고, 끝나면 여기에 모은다)
