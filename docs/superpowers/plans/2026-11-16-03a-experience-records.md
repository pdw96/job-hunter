# Job Hunter 3-1번 계획: 경험 기록 (직접 입력 · 검증 상태 · 트랙별 사용 범위) Implementation Plan

**Goal:** 사용자가 경험 기록을 직접 쓰고 고칠 수 있다. 기록마다 검증 루브릭 다섯 항목의 상태와 검증 상태(미확인 / 부분 확인 / 확인됨)가 계산되어 보이고, 트랙마다 사용 범위(사용 / 요약만 / 제외)를 정할 수 있다. AI는 아직 쓰지 않는다.

**Architecture:** 모듈 `experiences`를 추가한다. 검증 상태를 정하는 규칙은 화면·DB와 분리된 순수 함수로 두고 테스트한다. 이 규칙이 "지원서에는 확인됨만 쓴다"의 기준이 되므로 이 계획의 중심이다. 루브릭 항목의 판정은 누가 했는지(코드 / AI / 사용자)와 무관하게 같은 표에 저장하고, 3-2번에서 AI 판정을 같은 자리에 채운다.

**Spec:** `docs/superpowers/specs/2026-11-16-job-hunter-design.md` 6.3, 8장의 3단계 중 "직접 입력과 수정"

## 3번 계획을 셋으로 나눈다

원래 3번은 "경험 기록: 인터뷰, 검증 루브릭, 가져오기"였다. 한 번에 만들기에는 크고 AI가 처음 들어오는 지점이라 나눈다. 각각 끝나면 그 자체로 써 볼 수 있다.

| 번호 | 내용 | AI |
|---|---|---|
| 3-1 (이 문서) | 기록 직접 입력·수정, 검증 상태 규칙, 트랙별 사용 범위 | 없음 |
| 3-2 | AI 루브릭 판정과 보완 방안, AI 인터뷰, "지금 보완하기", 금지 표현 후보 제안, AI 사용량 기록 | 있음 |
| 3-3 | 가져오기: 붙여 넣기, PDF, 워드. 연락처 가리기 | 있음 |

3-2를 시작하기 전에 사용자가 정할 것: 쓸 Claude 모델(품질과 비용), Anthropic API 키 발급.

## Global Constraints

- 1·2번 계획의 Global Constraints와 `docs/conventions.md`를 모두 따른다
- 사용자 데이터 함수의 첫 두 인자는 `(db, userId)`. 기록을 `experienceId`로 읽거나 고칠 때도 반드시 `userId` 조건을 함께 건다
- 트랙별 사용 범위를 저장할 때는 그 트랙이 같은 사용자의 것인지 `tracks` 모듈 함수로 확인한다
- 화면을 만들기 전에 `npm run preview:local`로 띄워 브라우저로 확인하고, 확인한 사진을 사용자에게 보낸다
- Next.js 코드를 쓰기 전에 `node_modules/next/dist/docs/`의 해당 문서를 읽는다(`AGENTS.md`)
- 커밋과 배포는 사용자 확인을 받은 뒤에 한다

## 검증 규칙 (설계 6.3을 그대로 옮긴 것)

**루브릭 항목**: 기간 `period` / 본인 역할 `role` / 수준 `level` / 수치 `metrics` / 증빙 `evidence`

**항목 상태**

| 상태 | 뜻 |
|---|---|
| `unjudged` | 아직 판정하지 않음 (3-1에서 본인 역할·수준·수치·증빙의 기본값. 3-2에서 AI가 채운다) |
| `met` | 충족 |
| `unmet` | 미달. 보완 방안 글이 함께 있을 수 있다 |
| `closed` | 사용자가 "해당 없음"으로 닫음. 수치와 증빙만 가능 |
| `na` | 구분상 처음부터 적용하지 않음 |

**구분별 적용**

| 구분 | 기간 | 본인 역할 | 수준 | 수치 | 증빙 |
|---|---|---|---|---|---|
| 재직 `job`, 프로젝트 `project`, 교육 `training`, 기타 `other` | 필수 | 필수 | 필수 | 선택 | 선택 |
| 학력 `school`, 공백 `gap` | 필수 | `na` | `na` | 선택 | 선택 |
| 자격 `certificate` | 필수 (취득일 하나로 충족) | `na` | `na` | 선택 | 선택 |

**기간 판정은 코드가 한다**: 시작 월이 있고, 끝 월이 있거나 "진행 중"이면 `met`. 자격은 시작 월(취득일)만 있으면 `met`. 끝이 시작보다 앞서면 `unmet`. 월은 `YYYY-MM`.

**검증 상태**

- 미확인 `unconfirmed`: 사용자가 "맞다"고 확인하지 않음
- 부분 확인 `partial`: 확인했지만 필수 항목 중 `met`이 아닌 것이 있음(`unjudged` 포함)
- 확인됨 `confirmed`: 확인했고 필수 항목이 모두 `met`
- 수치와 증빙은 어떤 상태든 확인됨을 막지 않는다

**내용을 고치면**: 본인 확인이 풀리고(미확인으로), 코드가 판정하는 기간은 다시 계산한다. 본인 역할·수준·수치·증빙 중 `met` / `unmet`이던 것은 `unjudged`로 돌아간다(내용이 바뀌었으므로 다시 판정해야 한다). `closed`는 유지한다. 이름·태그·증빙 메모·금지 표현·트랙 범위만 바뀐 경우에는 확인을 풀지 않는다.

**3-1의 한계**: AI 판정이 없으므로 본인 역할·수준이 필수인 구분(재직, 프로젝트, 교육, 기타)은 부분 확인까지만 간다. 학력·자격·공백은 확인됨까지 갈 수 있다. 화면에 "본인 역할과 수준은 다음 단계에서 AI가 확인합니다"라고 알린다.

## 빌더가 정한 것 (사용자가 바꿀 수 있음)

| 항목 | 정한 내용 |
|---|---|
| 수치 | 기록 하나에 여러 개. 각각 "수치 내용"과 "기준·산출 근거" 두 칸 |
| 금지 표현 | 3-1에서는 사용자가 직접 추가·삭제한다(추가한 것은 승인된 것으로 본다). AI 후보 제안은 3-2 |
| 태그 | 쉼표로 구분해 입력, 기록당 10개까지 |
| 트랙 범위 기본값 | 새 기록은 모든 트랙에서 "사용". 새 트랙을 만들면 기존 기록도 그 트랙에서 "사용"으로 본다(행이 없으면 "사용") |
| 기록 삭제 | 가능. 확인 창을 한 번 띄운다 |
| 글자 수 | 이름·소속·역할 100자, 상황·한 일·결과·하지 않은 것·증빙 메모 각 4,000자 |
| 목록 정렬 | 시작 월이 최근인 순, 시작 월이 없는 것은 맨 아래 |

---

### Task 1: 검증 규칙 (순수 함수)

**Files:** Create `src/modules/experiences/options.ts`, `src/modules/experiences/verification.ts`, `src/modules/experiences/verification.test.ts`

**Interfaces:**
- `options.ts`: `KINDS`와 한국어 이름, `RUBRIC_ITEMS`와 한국어 이름, `SCOPES = ["use", "summary", "exclude"]`와 한국어 이름, 글자 수 제한
- `verification.ts`:
  - `type ItemStatus = "unjudged" | "met" | "unmet" | "closed" | "na"`
  - `type Rubric = Record<RubricItem, ItemStatus>`
  - `requiredItems(kind): RubricItem[]`, `appliesTo(kind, item): boolean`
  - `judgePeriod(kind, startMonth, endMonth, isOngoing): "met" | "unmet"`
  - `initialRubric(kind, period): Rubric` — 적용하지 않는 항목은 `na`, 기간은 코드 판정, 나머지는 `unjudged`
  - `verificationState(kind, rubric, isConfirmed): "unconfirmed" | "partial" | "confirmed"`
  - `canClose(kind, item): boolean` — 수치와 증빙만
  - `rubricAfterContentEdit(kind, rubric, period): Rubric` — 위 "내용을 고치면" 규칙
  - `usableInApplications(state): boolean` — `confirmed`만 `true`. 설계의 "지원서에는 확인됨만 쓴다"

- [ ] **Step 1: 실패하는 테스트** — 위 표의 모든 칸을 하나씩 확인한다. 특히:
  - 확인하지 않으면 필수 항목이 모두 `met`이어도 미확인
  - 확인했고 필수 중 하나가 `unjudged`이면 부분 확인
  - 수치가 `unmet`이거나 `closed`여도 확인됨이 된다
  - 학력은 기간만 `met`이면 확인됨. 자격은 취득 월 하나로 기간 충족
  - 필수 항목과 `na` 항목은 닫을 수 없다
  - 내용을 고치면 `met`이던 본인 역할이 `unjudged`로, `closed`이던 수치는 그대로
  - 끝 월이 시작 월보다 앞서면 기간 미달. `2024-13` 같은 월은 미달
- [ ] **Step 2~4: 실패 확인, 구현, 통과 확인, Commit** `feat: 경험 기록 검증 규칙`

---

### Task 2: 기록 저장

**Files:** Create `src/modules/experiences/schema.ts`, `src/modules/experiences/input.ts`, `src/modules/experiences/input.test.ts`, `src/modules/experiences/repo.ts`, `src/modules/experiences/repo.test.ts`. Modify `src/db/schema.ts`, `drizzle/`, `docs/conventions.md`

**Interfaces:**
- 테이블 `experiences_experiences`: `id`, `userId`(→ `auth_user`, cascade), `name`, `kind`, `organization`, `role`, `startMonth`, `endMonth`, `isOngoing`, `situation`, `actions`(본인이 한 일), `result`, `metrics jsonb`(`{ text, basis }[]`), `notDone`(하지 않은 것), `bannedPhrases jsonb`(`string[]`), `evidenceNote`, `tags jsonb`, `rubric jsonb`(항목별 `{ status, note }`), `confirmedAt timestamptz null`, `createdAt`, `updatedAt`. `userId`에 인덱스
- 테이블 `experiences_track_scopes`: `experienceId`(→ experiences, cascade), `trackId`(→ `tracks_tracks`, cascade), `scope`, 기본 키 `(experienceId, trackId)`. 행이 없으면 "사용"
- `input.ts`: `validateExperience(input: unknown): { ok: true; value: ExperienceInput } | { ok: false; errors }` — 공백 정리, 글자 수, 월 형식, 구분, 수치·태그·금지 표현 개수와 중복. 한국어 오류 문구
- `repo.ts`:
  - `createExperience(db, userId, input): Promise<string>` — `rubric`은 `initialRubric`으로
  - `updateExperience(db, userId, id, input): Promise<{ ok: true } | { ok: false; reason: "not_found" }>` — 내용 칸(구분, 소속, 역할, 기간, 상황, 한 일, 결과, 수치, 하지 않은 것)이 바뀌었으면 `confirmedAt`을 비우고 `rubricAfterContentEdit` 적용. 아니면 그대로
  - `getExperience(db, userId, id)`, `listExperiences(db, userId)` — 각 항목에 계산된 검증 상태 포함
  - `deleteExperience(db, userId, id)`
  - `confirmExperience(db, userId, id)` / `unconfirmExperience(db, userId, id)` — 사용자의 "맞다"
  - `closeRubricItem(db, userId, id, item)` / `reopenRubricItem(...)` — `canClose`가 아니면 `not_allowed`
  - `setTrackScope(db, userId, experienceId, trackId, scope)` — 기록과 트랙이 모두 본인 것인지 확인. 아니면 `not_found`
  - `getTrackScopes(db, userId, experienceId): Promise<Record<trackId, Scope>>`
- `tracks` 모듈에 `ownsTrack(db, userId, trackId): Promise<boolean>` 추가

- [ ] **Step 1: 실패하는 테스트** (준비: 사용자 `u1`, `u2`와 각자의 트랙)
  - 만든 기록을 본인이 다시 읽으면 입력과 같다
  - 다른 사용자의 기록은 읽히지 않고, 목록에 없고, 고치기·지우기·확인·닫기·범위 설정이 모두 `not_found`이며 원래 값이 그대로다
  - 확인한 뒤 "한 일"을 고치면 미확인으로 돌아간다. 태그만 고치면 확인이 유지된다
  - 학력 기록은 기간을 채우고 확인하면 확인됨. 재직 기록은 확인해도 부분 확인(3-1의 한계)
  - 수치는 닫을 수 있고 본인 역할은 닫을 수 없다
  - 남의 트랙에는 범위를 설정할 수 없다. 범위를 정하지 않은 트랙은 "사용"으로 읽힌다
  - 트랙을 지우면 범위 행이, 사용자를 지우면 기록과 범위 행이 함께 지워진다
  - 목록은 시작 월이 최근인 순
- [ ] **Step 2~4: 실패 확인, 스키마·마이그레이션·구현, 통과 확인, Commit** `feat: 경험 기록 저장과 사용자 격리`

---

### Task 3: 기록 화면

**Files:** Create `src/modules/experiences/actions.ts`, `src/app/(app)/experiences/page.tsx`, `src/app/(app)/experiences/new/page.tsx`, `src/app/(app)/experiences/[id]/page.tsx`, `src/app/(app)/experiences/experience-form.tsx`(클라이언트), `src/app/(app)/experiences/rubric-panel.tsx`. Modify `src/app/(app)/layout.tsx`(메뉴 `경험 기록`), `src/app/(app)/page.tsx`(트랙 카드에 기록 수와 링크)

**화면**
- `/experiences`: 기록 목록. 각 줄에 이름, 구분, 소속, 기간, 검증 상태 배지. 위에 `기록 추가`. 기록이 없으면 `아직 기록이 없습니다. 첫 기록을 추가해 보세요`
- `/experiences/new`, `/experiences/[id]`: 같은 폼
  - 기본: 이름, 구분, 소속·기관, 직무·역할, 기간(시작 월, 끝 월, `진행 중`). 구분이 자격이면 끝 월과 `진행 중`을 숨기고 시작 월의 이름을 `취득 월`로 바꾼다
  - 내용: 상황, 본인이 한 일, 결과
  - 수치: 줄 추가·삭제. 줄마다 `수치 내용`, `기준·산출 근거`
  - 하지 않은 것, 쓰면 안 되는 표현(칩으로 추가·삭제), 증빙·확인 메모, 태그
  - 트랙별 사용 범위: 트랙마다 사용 / 요약만 / 제외 (트랙이 둘 이상일 때도 한눈에)
  - `저장`
- 기록 화면 옆(모바일은 아래)에 **검증 패널**: 다섯 항목의 상태와 설명. 수치·증빙에는 `해당 없음으로 닫기` / `다시 열기`. 아래에 검증 상태와 `내용이 맞습니다`(확인) / `확인 취소` 버튼. 구분에 따라 "본인 역할과 수준은 다음 단계에서 AI가 확인합니다" 안내
- 저장하지 않은 변경이 있는 채로 확인 버튼을 누르지 못하게 한다(먼저 저장하라고 알림)
- 삭제 버튼은 기록 화면 맨 아래, 확인 창 한 번

- [ ] **Step 1: 서버 액션** (모두 `requireUser()` → 검사 → repo → `revalidatePath`)
- [ ] **Step 2: 목록과 폼**
- [ ] **Step 3: 검증 패널**
- [ ] **Step 4: 로컬 미리보기로 브라우저 확인** — 재직 기록 작성 → 저장 → 확인 → 부분 확인 표시, 학력 기록 → 확인됨, "한 일" 수정 → 미확인으로 돌아감, 수치 닫기, 트랙 범위 변경, 삭제. 사진을 사용자에게 보낸다
- [ ] **Step 5: 전체 테스트·빌드·린트, Commit** `feat: 경험 기록 화면`

---

### Task 4: 배포와 직접 확인

- [ ] PR을 만들고 사용자 확인 후 `main`에 합친다. 배포 기록에서 마이그레이션 적용을 확인한다
- [ ] 사용자가 실제 주소에서 기록 하나를 만들고 저장되는지 확인한다
- [ ] 3-2번 계획을 작성한다. 그 전에 사용자에게 모델과 API 키를 묻는다

## 이 계획에서 하지 않는 것

- AI 인터뷰, AI 루브릭 판정, 보완 방안, 금지 표현 후보 제안, 증빙 할 일 목록: 3-2
- 가져오기: 3-3
- 기록을 지원서에 쓰는 것: 5번 계획. 이 계획은 그때 쓸 판정 함수 `usableInApplications`를 만들어 둔다
