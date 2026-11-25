# 이력 묶어 보기 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 경험 기록을 `기본정보 · 이력 · 경험 사례`로 바꾸고, `이력`은 대분류(경력·학력·교육 기관·대내외활동·개인·자격·어학·수상) → 프로젝트로, `경험 사례`는 같은 순서로 기관 → 프로젝트 → 사례로 묶어 보인다. 대내외활동 아래 프로젝트, 학교·교육 과정 아래 사례를 둘 수 있게 한다.

**Architecture:** 표는 그대로 두고 연결 칸 세 개(`experiences_projects.activity_id`, `experiences_scenes.education_id`·`course_id`)와 검사 제약을 넓힌다. 머리 종류(`HEAD_KINDS`)와 소속 종류(`PARENT_KINDS`)를 넓히면 저장·검사·인터뷰·판정이 그 목록을 따라간다. 화면은 순수 함수 `buildRecordTree()`가 대분류 묶음을 만들고, 두 탭이 그것을 그린다. 오른쪽 목차는 클라이언트 컴포넌트 하나다.

**Tech Stack:** Next.js 16(App Router, 서버 액션), Drizzle + Postgres(테스트는 PGlite `createTestDb()`), Vitest, Tailwind

**Spec:** `docs/superpowers/specs/2026-11-25-record-tree-design.md`

## 정한 것 (설계가 빌더에게 맡긴 것)

- **칸**: `experiences_projects.activity_id`(→ `experiences_activities.id`, `on delete set null`, 다른 소속 칸과 같다), `experiences_scenes.education_id`(→ `experiences_education.id`), `experiences_scenes.course_id`(→ `experiences_courses.id`), 사례 쪽은 지금 사례 소속 칸처럼 삭제 동작 없음(지우기는 `deleteFact`가 `has_scenes`로 막는다). 제약은 이름을 그대로 두고 식만 넓힌다: `experiences_projects_one_parent` = `num_nonnulls(job_id, education_id, course_id, activity_id) <= 1`, `experiences_scenes_one_head` = `num_nonnulls(job_id, project_id, activity_id, education_id, course_id) = 1`. 마이그레이션은 `npm run db:generate`로 만든다(0025)
- **종류 목록**: `HEAD_KINDS = ["job", "project", "activity", "education", "course"]`, `HEAD_NOUNS`에 `education: "학교"`, `course: "교육 과정"`. `PARENT_KINDS = ["job", "education", "course", "activity"]`. 옛 옮기기(`move.ts`)와 가져오기(`record-import.ts`)는 AI 답 모양을 바꾸지 않도록 `Exclude<ParentKind, "activity">`(이름 `LegacyParentKind`, `record-options.ts`에 둔다)를 쓴다
- **학교·교육 과정의 머리 기간**(사례 기간이 비었을 때 빌려 쓰는 기간): 학교는 `isOngoing = status가 enrolled 또는 leave`(카드 표시 `cardOf`와 같은 규칙), 교육 과정은 `isOngoing = 시작 월이 있고 끝 월이 없음`(공백과 같은 규칙)
- **AI에 보내는 머리 칸**(`loadHead`의 `labels`): 학교 `[["학교", 학교 이름], ["전공", 전공], ["학위", DEGREE_LABELS[학위]]]`, 교육 과정 `[["과정", 이름], ["기관", 교육 기관]]`. 소재지·학점·연락처는 보내지 않는다
- **서류 원천의 사례 소속**(`sceneOrganization`): 학교 `"학교 이름 · 전공"`(전공 없으면 학교 이름), 교육 과정 `"과정 이름 · 교육 기관"`(기관 없으면 과정 이름). 원천 종류(`kind`)는 학교 머리 `"other"`, 교육 과정 머리 `"training"`(`school`은 자소서 고르기가 걸러 내므로 쓰지 않는다). 역할은 null, 금지 표현은 머리 쪽 없음
- **이력서**: 학교·교육 과정 머리는 이력서 머리 항목을 만들지 않는다(지금처럼 코드 줄 항목만). 그래서 `Head`에 `headKind: HeadKind`를 더하고 `listRecordResumeSources`는 `job`·`project`·`activity` 머리만 돈다
- **대내외활동 소속 프로젝트**: 이력서 프로젝트 머리의 소속(`organization`)은 활동 이름, 소속이 확인됐을 때만(지금 규칙)
- **대분류**(`SectionId`)와 문구:

  | id | 제목 | 기관 | 추가 단추 |
  |---|---|---|---|
  | `job` | 경력 | 경력(공백을 날짜 순으로 섞음) | `+ 경력 추가`, `+ 공백 추가` |
  | `school` | 학력 | 학교 | `+ 학교 추가` |
  | `course` | 교육 기관 | 교육 과정 | `+ 교육 과정 추가` |
  | `activity` | 대내외활동 | 활동 | `+ 활동 추가` |
  | `personal` | 개인 | (없음, 소속 없는 프로젝트) | `+ 프로젝트 추가` |
  | `credential` | 자격·어학·수상 | 자격(취득 월 최근 순) | `+ 자격·어학·수상 추가` |

  목차와 묶음의 HTML id는 `sec-<id>`
- **소속 후보 문구**: 프로젝트 `소속`은 `경력 · 회사` / `학력 · 학교` / `교육 기관 · 과정` / `대내외활동 · 활동`. 사례 `소속`은 그 넷과 `프로젝트 · 이름`(이 순서)
- **기관 아래 `+ 프로젝트`**: 이력 탭의 기관마다 `+ 프로젝트` 링크 `/records/facts/project/new?parent=<kind>:<id>`. 새 기록 화면이 `parent`를 받아 소속을 미리 고른다(타자 줄이기)
- **저장 뒤 돌아가는 곳**: 이력 사실을 저장·삭제하면 `/records#sec-<그 대분류>`(프로젝트는 소속의 대분류, 소속 없으면 `personal`, 공백은 `job`)
- **옛 주소**: `/records?tab=school|job|credential`은 `/records#sec-school|job|credential`로 보낸다. 탭 값은 `basic`과 `history`(기본)
- **목차 자리**: 화면 폭 1280px 이상(`xl`)이면 본문(768px) 오른쪽 바깥에 세로로 두고 `sticky`로 따라온다(본문 폭은 그대로). 그보다 좁으면 탭 아래에 가로줄로 두고 `sticky top-0`. 지금 보는 묶음은 굵게 표시한다. 경험 사례 탭에는 자격·어학·수상이 없다
- **경험 사례 탭의 묶음**: 기관마다 한 상자. 상자 안에 기관 바로 아래 사례, 그다음 그 기관의 프로젝트마다 들여 쓴 작은 묶음(프로젝트 머리·확인 표시·사례·`+ 사례 추가`). 개인 묶음은 기관 상자 없이 프로젝트마다 상자. 공백·자격은 없다

## Global Constraints

- `CLAUDE.md`, `docs/conventions.md`의 데이터 접근 규칙을 따른다: repo 함수의 첫 두 인자 `(db, userId)`, 모든 쿼리에 `userId` 조건, 소속·머리가 본인 것인지 확인
- 지금 행을 바꾸지 않는다. 마이그레이션은 칸 더하기와 제약 바꾸기뿐이다. 지금 기록·이력서·경력기술서·자소서·제출본의 결과가 달라지면 안 된다
- 지원서에는 확인됨만 쓴다: 학교·교육 과정 아래 사례도 사례와 머리가 모두 확인돼야 자소서에 쓴다(`sceneUsable`). 범위는 머리와 사례 중 좁은 쪽(`narrowerScope`)
- AI 지시문(`prompts.ts`)과 프롬프트 점검은 바꾸지 않는다(AI가 받는 머리 칸만 늘어난다)
- 화면을 바꾸면 `LOCAL_PREVIEW=1`로 띄워 휴대폰 폭(390px)과 넓은 폭(1440px)에서 사진을 찍어 사용자에게 보낸다
- 판단표 ②: `src/modules/experiences/schema.ts`·`drizzle/**`·`docs/superpowers/specs/**`를 바꾸므로 합치기 전에 사용자에게 묻는다

## Review Focus

1. 직접 쓴 사례를 옮겨 온 학교·교육 과정에 붙이거나, 직접 만든 프로젝트를 옮겨 온 활동에 붙인 뒤 `다시 옮기기`를 누른다 → 막히고(`in_use`) 아무것도 지워지지 않는다 (Task 3 테스트)
2. 사례가 달린 학교·교육 과정을 지운다 → `has_scenes`로 막히고 화면에 "사례가 있어 지울 수 없습니다" 류의 지금 문구가 뜬다 (Task 2 테스트 "사례가 달린 학교는 지우지 않는다")
3. 소속 학교가 미확인인 사례 → 자소서 원천에 오르지 않고, 채점 근거에는 오른다(머리 확인을 보지 않는 지금 규칙) (Task 4 테스트)
4. 남의 학교·교육 과정·활동 id로 사례·프로젝트를 만든다 → `not_found`/소속 오류이고 저장되지 않는다 (Task 1·2 테스트)
5. 재학 중인 학교에 붙인 사례가 기간을 비워 둔다 → 기간 항목이 충족이다(끝 월 없는 학교도 미충족이 되지 않음) (Task 2 테스트)

---

### Task 1: 대내외활동 아래 프로젝트 (DB 칸·종류 목록)

**Files:**
- Modify: `src/modules/experiences/schema.ts` (projects에 `activityId`, 두 검사 제약 식. 사례 칸은 Task 2에서 더하지만 마이그레이션을 한 번으로 하려고 여기서 함께 더한다: scenes에 `educationId`·`courseId`)
- Create: `drizzle/0025_*.sql` (+ `drizzle/meta/*`, `npm run db:generate`)
- Modify: `src/modules/experiences/record-options.ts` (`PARENT_KINDS`, `LegacyParentKind`, `HEAD_KINDS`, `HEAD_NOUNS`)
- Modify: `src/modules/experiences/facts-repo.ts` (`PARENT_KIND_TABLE`, `toValues`, `toValue`, `sceneHeadColumn`)
- Modify: `src/modules/experiences/record-import.ts`, `src/modules/experiences/move.ts` (`ParentKind` → `LegacyParentKind`, zod enum은 `["job", "education", "course"]` 그대로)
- Test: `src/modules/experiences/facts-repo.test.ts`

**Interfaces:**
- Produces: `PARENT_KINDS: readonly ["job","education","course","activity"]`, `type ParentKind`, `type LegacyParentKind = Exclude<ParentKind, "activity">`, `HEAD_KINDS: readonly ["job","project","activity","education","course"]`, `type HeadKind`, `HEAD_NOUNS: Record<HeadKind,string>`. `ProjectInput.parent`가 `{ kind: "activity", id }`를 받는다

- [ ] **Step 1: 실패하는 테스트**

`facts-repo.test.ts`에:
- `"프로젝트를 대내외활동에 딸리게 저장하고 읽는다"`: 활동을 만들고 `createFact(db, uid, "project", { ...project, parent: { kind: "activity", id: activityId } })` → `getFact`의 `value.parent`가 `{ kind: "activity", id: activityId }`
- `"남의 활동에는 딸리게 할 수 없다"`: 다른 사용자의 활동 id로 저장 → 지금 남의 경력에 대한 결과와 같은 실패(`createFact`의 기존 소속 오류 모양)
- `"활동을 지우면 프로젝트는 개인이 된다"`: 사례 없는 활동을 `deleteFact` → 프로젝트 `value.parent === null`

- [ ] **Step 2: 실패 확인** — `npx vitest run src/modules/experiences/facts-repo.test.ts` → 위 3개 FAIL(타입 오류 또는 parent null)

- [ ] **Step 3: 구현** — 스키마·마이그레이션(`npm run db:generate`, 생성된 SQL이 칸 3개 추가·외래 키·제약 2개 drop/add뿐인지 본다), 종류 목록, `facts-repo`의 소속 칸 짝(`activity` → `activityId`), `sceneHeadColumn`에 `education: scenes.educationId, course: scenes.courseId`. `record-import.ts`·`move.ts`는 `LegacyParentKind`로 바꿔 컴파일만 맞춘다. `npx tsc --noEmit`이 남기는 오류(넓어진 `HeadKind`의 `Record`/`switch`)는 Task 2의 파일이면 그 자리에서 Task 2 규칙대로 채운다

- [ ] **Step 4: 통과 확인** — 같은 명령 PASS, `npx tsc --noEmit` 오류 없음

- [ ] **Step 5: 커밋** — `feat: 프로젝트를 대내외활동에 딸릴 수 있게 한다`

### Task 2: 학교·교육 과정 아래 사례 (저장·머리 읽기·인터뷰)

**Files:**
- Modify: `src/modules/experiences/scene-head.ts` (`loadHead`, `lockHead`, `headOfRow`)
- Modify: `src/modules/experiences/scenes-repo.ts` (`headColumns`)
- Modify: `src/modules/experiences/record-input.ts` (사례 머리 오류 문구: "사례가 속할 경력·학교·교육 과정·활동·프로젝트를 골라 주세요")
- Modify: `src/modules/experiences/record-commands.ts` (인터뷰 시작 오류 문구 같은 낱말로)
- Test: `src/modules/experiences/scene-head.test.ts`(없으면 만든다), `src/modules/experiences/scenes-repo.test.ts`, `src/modules/experiences/facts-repo.test.ts`

**Interfaces:**
- Consumes: Task 1의 `HEAD_KINDS`, `scenes.educationId`·`courseId`
- Produces: `loadHead(db, userId, { kind: "education" | "course", id })`가 `SceneHead`(위 "정한 것"의 labels·period)를 돌려준다. `headOfRow(row)`가 다섯 칸 중 찬 것을 돌려준다

- [ ] **Step 1: 실패하는 테스트**
- `scenes-repo.test.ts` `"학교에 사례를 붙여 저장하고 읽는다"`: `createScene(db, uid, { ...scene, head: { kind: "education", id } })` → `getScene().head`가 같다. 교육 과정도 같은 테스트 하나
- `scenes-repo.test.ts` `"남의 학교에는 사례를 붙일 수 없다"`: 다른 사용자의 학교 id → `ok: false`(지금 남의 경력일 때와 같은 reason)
- `scene-head.test.ts` `"학교 머리의 이름 칸과 기간"`: 재학(`enrolled`), 시작 2022-03, 끝 null인 학교 → `labels`가 `[["학교","가나대"],["전공","컴퓨터공학"],["학위","학사"]]`, `period.isOngoing === true`
- `scene-head.test.ts` `"교육 과정 머리는 끝 월이 없으면 진행 중"`: 시작 2024-01, 끝 null → `isOngoing true`, labels `[["과정","백엔드 부트캠프"],["기관","다라캠프"]]`
- `scenes-repo.test.ts` `"재학 중인 학교에 붙인 기간 없는 사례는 기간이 충족이다"`: 위 학교에 `startMonth: null`인 사례 → `rubric.period.status === "met"`
- `facts-repo.test.ts` `"사례가 달린 학교는 지우지 않는다"`: → `{ ok: false, reason: "has_scenes", count: 1 }`

- [ ] **Step 2: 실패 확인** — `npx vitest run src/modules/experiences/scenes-repo.test.ts src/modules/experiences/scene-head.test.ts src/modules/experiences/facts-repo.test.ts` → 새 테스트 FAIL

- [ ] **Step 3: 구현** — `loadHead`/`lockHead`에 `education`(표 `education`)·`course`(표 `courses`) 갈래. 두 표에는 `isOngoing` 칸이 없으므로 `toHead`에 넘기기 전에 위 규칙으로 `period`를 만든다. `headColumns`·`headOfRow`에 두 칸. 인터뷰(`interview.ts`)는 `HEAD_KINDS`를 따라가므로 손대지 않는다

- [ ] **Step 4: 통과 확인** — 같은 명령 PASS, `npx tsc --noEmit`

- [ ] **Step 5: 커밋** — `feat: 학교·교육 과정에 사례를 붙일 수 있게 한다`

### Task 3: 다시 옮기기를 새 연결에서도 막기

**Files:**
- Modify: `src/modules/experiences/move-repo.ts` (`resetBlock`)
- Test: `src/modules/experiences/move-repo.test.ts`

**Interfaces:**
- Consumes: Task 1·2의 칸

- [ ] **Step 1: 실패하는 테스트** (`move-repo.test.ts`의 지금 `in_use` 테스트 옆에)
- `"직접 쓴 사례가 옮겨 온 학교에 딸리면 다시 하기가 막힌다"`: `movedFrom`이 있는 학교 + 그 학교에 `movedFrom` 없는 사례 → `resetBlock` = `"in_use"`, `resetMoves` = `{ ok: false, reason: "in_use" }`이고 학교·사례가 그대로 있다
- 교육 과정도 같은 테스트 하나
- `"직접 만든 프로젝트가 옮겨 온 활동에 딸리면 다시 하기가 막힌다"`: 같은 모양
- `"옮겨 온 학교의 사례 인터뷰가 진행 중이면 막힌다"`: `interviews.headKind = "education"`, `headId = 학교 id`, `status: "active"` → `"in_use"`

- [ ] **Step 2: 실패 확인** — `npx vitest run src/modules/experiences/move-repo.test.ts` → 새 테스트 FAIL(`null` 또는 외래 키 오류)

- [ ] **Step 3: 구현** — 사례 검사의 `or(...)`에 `inArray(scenes.educationId, none(school))`, `inArray(scenes.courseId, none(course))`, 프로젝트 검사에 `inArray(projects.activityId, none(activity))`, 인터뷰 검사의 머리 id 목록에 `school`·`course`. 맨 위 설명 주석도 고친다

- [ ] **Step 4: 통과 확인** — 같은 명령 PASS

- [ ] **Step 5: 커밋** — `fix: 새 연결이 있으면 다시 옮기기를 막는다`

### Task 4: 서류 원천에 새 연결 반영

**Files:**
- Modify: `src/modules/experiences/record-sources.ts` (`Head.headKind`, `headsOf`에 학교·교육 과정 머리, 프로젝트 소속 후보에 활동, `listRecordResumeSources`의 머리 거르기)
- Test: `src/modules/experiences/record-sources.test.ts`

**Interfaces:**
- Consumes: Task 1·2
- Produces: 원천 함수의 모양은 그대로다(`WritingSource`, `ResumeSource`, `EvidenceCandidate`, `CareerSource`)

- [ ] **Step 1: 실패하는 테스트**
- `"확인된 학교 아래 확인된 사례는 자소서 원천에 소속과 함께 오른다"`: 학교(가나대, 컴퓨터공학, 확인) + 확인된 사례 → `listSceneWritingSources`에 그 사례, `organization === "가나대 · 컴퓨터공학"`, `kind === "other"`
- `"교육 과정 아래 사례의 소속은 과정 · 기관"`: `organization === "백엔드 부트캠프 · 다라캠프"`, `kind === "training"`
- `"소속 학교가 미확인이면 자소서 원천에 없고 채점 근거에는 있다"`: `listSceneWritingSources`에 없음, `listRecordEvidence`에 있음
- `"학교를 그 트랙에서 제외하면 그 아래 사례도 자소서 원천에서 빠진다"`: 학교 `trackScopes[trackId] = "exclude"` → 없음
- `"학교·교육 과정 머리는 이력서 머리 항목을 만들지 않는다"`: 사례가 달린 확인된 학교 → `listRecordResumeSources`에 그 학교 id 항목이 하나뿐이고 `codeLines`가 있다(지금 코드 줄 항목)
- `"대내외활동 소속 프로젝트의 이력서 소속은 활동 이름"`: 확인된 활동(□□ 동아리) + 소속 프로젝트 → 프로젝트 항목 `organization === "□□ 동아리"`. 활동이 미확인이면 `null`
- `"학교 사례는 자소서 고르기 후보에서 걸러지지 않는다"`: `src/modules/applications/select.test.ts`에 학교 사례 원천(`kind: "other"`)이 후보에 남는지 하나(지금 `school`·`certificate` 거르기 옆)

- [ ] **Step 2: 실패 확인** — `npx vitest run src/modules/experiences/record-sources.test.ts src/modules/applications/select.test.ts` → 새 테스트 FAIL

- [ ] **Step 3: 구현** — `Head`에 `headKind: HeadKind`. `headsOf`에서 학교·교육 과정을 머리로 넣는다(위 "정한 것"의 `sceneOrganization`·`kind`, `organization: null`, `role: null`, `versionParts: [id, contentVersion]`, `bannedPhrases: []`, 기간은 Task 2와 같은 규칙. 같은 규칙을 두 곳에 쓰지 않도록 `scene-head.ts`에 `educationPeriod(v)`·`coursePeriod(v)`를 내보내 함께 쓴다). 프로젝트의 소속 후보 맵에 `facts.activity`. 이력서는 `headKind`가 `job`·`project`·`activity`인 머리만

- [ ] **Step 4: 통과 확인** — 같은 명령 PASS, 이어서 `npx vitest run src/modules/applications`로 서류 테스트가 모두 그대로인지 본다

- [ ] **Step 5: 커밋** — `feat: 학교·교육 과정 사례와 활동 소속 프로젝트를 서류 원천에 넣는다`

### Task 5: 대분류 묶음 만들기 (순수 함수)

**Files:**
- Create: `src/app/(app)/records/record-tree.ts`
- Test: `src/app/(app)/records/record-tree.test.ts`

**Interfaces:**
- Consumes: `FactsByKind`, `Fact`(`facts-repo`), `SceneSummary`(`scenes-repo`)
- Produces:
  ```ts
  export type SectionId = "job" | "school" | "course" | "activity" | "personal" | "credential";
  export const SECTIONS: { id: SectionId; label: string }[]; // 위 표의 순서·제목
  export type ProjectNode = { fact: Fact<"project">; scenes: SceneSummary[] };
  export type OrgNode = { fact: Fact<"job" | "gap" | "education" | "course" | "activity">; scenes: SceneSummary[]; projects: ProjectNode[] };
  export type Section = { id: SectionId; label: string; orgs: OrgNode[]; projects: ProjectNode[]; credentials: Fact<"credential">[] };
  export function buildRecordTree(facts: FactsByKind, scenes: SceneSummary[]): Section[];
  export function sectionOf(kind: FactKind, parent?: ProjectParent): SectionId; // 저장 뒤 돌아갈 곳
  ```
  `projects`는 `personal`에서만 차고, `credentials`는 `credential`에서만 찬다. 사례는 `head`로 그 기관·프로젝트에 붙는다

- [ ] **Step 1: 실패하는 테스트**
- `"대분류는 경력·학력·교육 기관·대내외활동·개인·자격 순서다"`: 빈 기록 → `ids = ["job","school","course","activity","personal","credential"]`, 제목이 표와 같다
- `"프로젝트는 소속 기관 아래, 소속 없으면 개인에"`: 경력 A, 학교 S, 과정 C, 활동 V와 각각에 딸린 프로젝트 하나, 소속 없는 프로젝트 하나 → 각 기관의 `projects`에 하나씩, `personal.projects`에 하나
- `"경력 묶음은 공백을 시작 월 최근 순으로 섞는다"`: 경력 2023-01, 공백 2025-01, 경력 2020-03 → 공백, 경력(2023), 경력(2020)
- `"기관과 프로젝트는 시작 월 최근 순, 월이 없으면 아래"`
- `"자격은 취득 월 최근 순"`
- `"사례는 머리로 기관이나 프로젝트에 붙는다"`: 경력 바로 아래 사례 1, 그 경력의 프로젝트 사례 2, 학교 사례 1 → 각각 그 자리 `scenes` 길이
- `"소속 기관이 목록에 없는 프로젝트는 개인에 둔다"`: parent id가 없는 기관을 가리키는 프로젝트 → `personal`
- `sectionOf`: `("gap") → "job"`, `("project", { kind: "activity", id }) → "activity"`, `("project", null) → "personal"`, `("credential") → "credential"`

- [ ] **Step 2: 실패 확인** — `npx vitest run "src/app/(app)/records/record-tree.test.ts"` → FAIL(모듈 없음)

- [ ] **Step 3: 구현** — 정렬은 시작 월 내림차순, 없는 것은 아래, 같으면 `createdAt` 최근 순(`record-sources.ts`의 `byRecent`와 같은 규칙. 화면 파일이라 그 함수를 가져오지 말고 같은 비교를 이 파일에 둔다)

- [ ] **Step 4: 통과 확인** — 같은 명령 PASS

- [ ] **Step 5: 커밋** — `feat: 경험 기록을 대분류로 묶는 함수를 더한다`

### Task 6: 이력 탭과 오른쪽 목차

**Files:**
- Modify: `src/app/(app)/records/page.tsx` (탭 `basic`·`history`, 이력 탭을 `buildRecordTree`로 그림, 옛 탭 값 보내기)
- Create: `src/app/(app)/records/section-nav.tsx` (클라이언트, 목차)
- Create: `src/app/(app)/records/section-nav-active.ts` + `.test.ts` (지금 보는 묶음 고르기, 순수 함수)
- Create: `src/app/(app)/records/record-tabs.tsx` (세 탭 줄. 이력 탭과 경험 사례 탭이 함께 쓴다)
- Modify: `src/app/(app)/records/parent-options.ts` (활동, 문구)
- Modify: `src/app/(app)/records/fact-form.tsx` (`TAB_OF_KIND` → `sectionOf`로 `/records#sec-…`, `initialParent` 받기)
- Modify: `src/app/(app)/records/facts/[kind]/new/page.tsx` (`searchParams.parent`를 후보에 있을 때만 `FactForm`에 넘김)

**Interfaces:**
- Consumes: Task 5의 `buildRecordTree`, `SECTIONS`, `sectionOf`; `listScenes(db, userId)`(사례 수)
- Produces: `SectionNav({ sections: { id: SectionId; label: string }[] })`, `RecordTabs({ current: "basic" | "history" | "scenes" })`, `activeSection(tops: { id: string; top: number }[], line: number): string | null`

- [ ] **Step 1: 실패하는 테스트** (`section-nav-active.test.ts`)
- `"기준선 위로 올라간 마지막 묶음이 지금 묶음"`: tops `[{a,0},{b,500},{c,900}]`, line 600 → `"b"`
- `"아직 첫 묶음 위면 첫 묶음"`: line -10 → `"a"`
- `"빈 목록이면 null"`

- [ ] **Step 2: 실패 확인** — `npx vitest run "src/app/(app)/records/section-nav-active.test.ts"` → FAIL

- [ ] **Step 3: 구현**
- `activeSection`, 그리고 `SectionNav`: 스크롤마다(`requestAnimationFrame`으로 묶어) 각 `sec-<id>`의 `getBoundingClientRect().top`을 모아 `activeSection(tops, 120)`. 링크는 `href="#sec-<id>"`. 위 "정한 것"의 목차 자리대로 그린다(`xl` 이상 본문 오른쪽 바깥 세로·`sticky`, 그 아래 가로줄·`sticky top-0`·배경색)
- `RecordTabs`: `기본정보`(`/records?tab=basic`) · `이력`(`/records`) · `경험 사례`(`/records/scenes`)
- 이력 탭: 대분류마다 `<section id="sec-…">` 제목, 기관 카드(지금 `FactCard`, 경력 탭의 열린 주장 그대로), 기관 아래 들여 쓴 프로젝트 줄(이름·기간·확인 표시·`사례 N개`, 누르면 `/records/facts/project/<id>`), 기관 카드 아래 `+ 프로젝트` 링크(`?parent=`), 대분류 끝 추가 단추(표의 문구). 기관에 바로 딸린 사례 수도 카드 제목 옆에 `사례 N개`(0이면 안 보임). 자격은 들여쓰기 없이 `FactCard`
- 옛 탭: `tab`이 `school`·`job`·`credential`이면 `redirect("/records#sec-<tab>")`. 이력 탭에서만 `ResetMovesButton`과 옮기기 알림(지금 자리)
- `parentOptionsOf`: 문구를 "정한 것"대로, 활동 더함
- `fact-form`: 저장·삭제 뒤 `router.push(`/records#sec-${sectionOf(kind, parent)}`)`(프로젝트는 지금 고른 소속). `initialParent?: string`(`"job:<id>"` 모양)을 받아 새 프로젝트의 `소속` 기본값으로

- [ ] **Step 4: 확인** — 테스트 PASS, `npx tsc --noEmit`, `npm run lint`. 로컬 미리보기(`LOCAL_PREVIEW=1 npx next build` → `LOCAL_PREVIEW=1 npx next start -p 3210` 백그라운드)에서 가짜 기록에 경력+프로젝트, 학교+프로젝트, 과정, 활동, 개인 프로젝트, 자격을 넣고 `/records`를 390px·1440px로 찍는다. 목차를 눌러 그 묶음으로 가는지, 스크롤하면 굵은 표시가 바뀌는지, 경력 아래 `+ 프로젝트`로 만든 프로젝트가 그 경력 아래에 보이는지 본다

- [ ] **Step 5: 커밋** — `feat: 이력 탭에 대분류 묶음과 오른쪽 목차를 둔다`

### Task 7: 경험 사례 탭을 같은 묶음으로

**Files:**
- Modify: `src/app/(app)/records/scenes/page.tsx` (`buildRecordTree`로 묶음, `RecordTabs`, `SectionNav`)
- Modify: `src/app/(app)/records/scenes/heads.ts` (`headOptionsOf`에 학교·교육 과정, 순서·문구)
- Modify: `src/app/(app)/records/scenes/[id]/page.tsx` (머리 주장은 `job`·`project`일 때만 읽음)
- Modify: `src/app/(app)/records/scenes/new/page.tsx` (안내 문구·링크: "사례는 경력, 학교, 교육 과정, 활동, 프로젝트에 붙입니다. 먼저 이력에서 만들어 주세요", 링크 `/records`)
- Test: `src/app/(app)/records/scenes/heads.test.ts`(없으면 만든다)

**Interfaces:**
- Consumes: Task 5·6의 `buildRecordTree`, `SECTIONS`, `SectionNav`, `RecordTabs`

- [ ] **Step 1: 실패하는 테스트** (`heads.test.ts`)
- `"사례 소속 후보는 경력·학력·교육 기관·대내외활동·프로젝트 순서"`: 각 하나씩 → labels `["경력 · ○○커머스", "학력 · 가나대", "교육 기관 · 백엔드 부트캠프", "대내외활동 · □□ 동아리", "프로젝트 · 물류 대시보드"]`, values `"education:<id>"` 모양

- [ ] **Step 2: 실패 확인** — `npx vitest run "src/app/(app)/records/scenes/heads.test.ts"` → FAIL

- [ ] **Step 3: 구현**
- `headOptionsOf`(학교·교육 과정 더함, 위 순서)
- 사례 탭: `credential` 대분류를 빼고, 대분류마다 `<section id="sec-…">`와 제목. 기관 상자(지금 그룹 상자 모양: 머리 줄·확인 표시·미확인이면 `HeadConfirm`(경력은 지금처럼 빼고, 학교·교육 과정은 넣는다)·사례 목록·`+ 사례 추가`) 안에 프로젝트마다 들여 쓴 작은 묶음(같은 요소). 개인은 프로젝트마다 상자. 공백은 상자를 만들지 않는다. 맨 아래 `+ 프로젝트`·`+ 활동`은 없앤다(이력 탭에서 만든다)
- `[id]/page.tsx`: `head.kind === "job" || head.kind === "project" ? listRecordClaims(...) : []`

- [ ] **Step 4: 확인** — 테스트 PASS, `npx tsc --noEmit`, `npm run lint`. 로컬 미리보기에서 `/records/scenes`를 390px·1440px로 찍고, 학교 상자에서 `직접 쓰기`로 사례를 만들어 그 학교 아래에 보이는지, 사례 화면의 `소속`을 교육 과정으로 바꾸면 그 과정 아래로 옮겨 가는지 본다

- [ ] **Step 5: 커밋** — `feat: 경험 사례 탭을 이력과 같은 묶음으로 보인다`

### Task 8: 마무리

- [ ] `npm test`, `npx tsc --noEmit`, `npm run lint` 모두 통과
- [ ] 사진(이력 탭·경험 사례 탭, 390px·1440px)을 사용자에게 보낸다
- [ ] `docs/conventions.md`의 experiences 줄은 표가 그대로라 바꾸지 않는다. 이 문서 끝에 "구현하며 달라진 점"을 적는다
- [ ] `docs/status.md`: 끝난 것에 이 계획을 더하고, 다음 할 일을 "사용자가 이력 묶음에서 연결을 고쳤는지 확인 → 옛 표 지우기"로 고친다. 판단표 점검을 이 문서 끝에 적는다
- [ ] `/ship`으로 올린다(PR [#57](https://github.com/pdw96/job-hunter/pull/57)에 더한다)

## 구현하면서 달라진 점

- Task 1: `facts-repo`의 `setProjectParentIfUnset`에도 활동 칸을 더하고 "아직 소속이 없을 때" 조건에 `activity_id`를 넣었다(계획에 없던 곳). 가져오기 AI 답의 소속 종류는 `["job","education","course"]` 그대로 적었다
- Task 1: 넓어진 머리 종류로 컴파일이 깨진 `scene-judge.ts`(머리 표 목록)와 `scenes/[id]/page.tsx`(머리 주장은 경력·프로젝트만)를 그 자리에서 맞췄다
- Task 5: 프로젝트는 소속 id가 있고 종류도 맞을 때만 그 기관 아래에 두고, 아니면 개인에 둔다
- Task 6: 목차의 맨 아래 짧은 묶음(대내외활동·개인)은 눌러도 기준선까지 못 올라가므로, 누른 묶음을 굵게 둔다. 이력 탭의 프로젝트 줄에는 `맞음` 단추를 두지 않았다(프로젝트 화면에서 확인)
- Task 7: 기관 상자 안의 `+ 사례 추가`는 기관에 바로 딸린 사례 바로 뒤, 프로젝트 묶음 앞에 둔다(설계 그림은 상자 끝). 비어 있는 대분류는 "아직 없습니다. 이력에서 만들어 주세요"와 이력의 그 묶음 링크를 보인다. 확인 표시(`ConfirmBadge`)를 한 파일로 모아 세 화면이 함께 쓴다
- (검토) 브랜치 전체 검토: 사례 탭의 머리 기간을 `educationPeriod`·`coursePeriod`로 다시 쓰고, 졸업 예정이고 끝 월이 없는 학교도 진행 중으로 본다. 인터뷰 시작 오류 문구를 "경력·학교·교육 과정·활동·프로젝트"로, 지운 뒤 돌아갈 묶음은 저장된 소속으로 정한다
- 미룬 것: 이력 탭의 프로젝트 줄에 가져온 프로젝트의 열린 주장 수를 보이지 않는다(프로젝트 화면에서 본다)

## 판단표 점검 (2026-11-25)

- ③ 계획 승인: 설계를 사용자와 정한 뒤(승인 2026-11-25) 새 표가 없어 묻지 않고 구현했다. 맞았다
- 설계 대화에서 사용자가 "내 말이 다 맞다는 전제로 하지 말고 너도 생각해봐"라고 했다. 요구를 받아 적기만 하지 않고 득실과 반대 의견을 함께 낸다. 판단표에는 넣지 않는다(일하는 방식)
- 하위 에이전트가 일하는 동안 "커밋하지 않은 변경" 알림이 되풀이됐다. 에이전트 작업 중에는 커밋하지 않고, 끝나고 검토한 뒤 올렸다
- 직접 만든 장치: `related-test.sh`, `/ship`, `vercel-ignore`는 여전히 쓸모가 있다. 판단표는 바꾸지 않는다
