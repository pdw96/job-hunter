# Job Hunter 5-3번 계획: 제출본 얼리기 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 지원 공고에서 `제출함`을 누르면 그 시점의 공고 원문, 이력서(맞춤본, 없으면 트랙 공통본), 자소서 문항과 답을 통째로 복사해 얼린다. 얼린 제출본은 다시 고쳐지지 않는다. 제출한 뒤 그 공고의 자소서와 맞춤본은 잠기고, 고치려면 `새 버전 만들기`로 풀어 고친 뒤 다시 `제출함`을 누른다(제출 2, 3 …).

**Architecture:** 새 테이블 `applications_submissions` 하나(「결정」 2026-11-19, 사용자). 공고마다 제출 번호(1, 2, …)로 한 행씩 쌓고, 내용(`SubmissionContent`)은 jsonb로 통째 복사한다. 행에서 바뀌는 것은 `reopened_at` 하나뿐이다(새 버전을 만들면 채운다). 공고의 "잠김" = 마지막 제출이 있고 그 `reopened_at`이 비어 있음. 지금 자소서·맞춤본을 고치는 모든 길에 있는 `posting.status !== "apply"` 검사를 한 함수(`editBlock`)로 바꿔 잠김도 함께 본다.

**Tech Stack:** Next.js 16(App Router), Drizzle + Postgres(테스트는 PGlite), zod, Vitest

**Spec:** `docs/superpowers/specs/2026-11-16-job-hunter-design.md`의 6.5 "제출본 보존"(「결정」 "제출함"을 누르면 그 시점의 이력서, 자소서, 공고 원문이 얼려진다 / 이후 경험 기록을 고쳐도 제출본은 바뀌지 않는다, 「제안」 제출 후 고치려면 새 버전을 만든다), 6.6(연락처는 파일을 만들 때만 → 제출본에도 넣지 않는다), 6.7(진행 상태는 7번 계획. 이번에는 지원 판단을 바꾸지 않는다). 5-1 `docs/superpowers/plans/2026-11-18-05a-cover-letter.md`, 5-2 `docs/superpowers/plans/2026-11-18-05b-resume.md`의 함수를 다시 쓴다

## 정한 것

- 「결정」(2026-11-19, 사용자) 새 테이블은 `applications_submissions` 하나
- 제출은 지원 판단이 "지원"인 공고에서만 한다. 잠겨 있으면(이미 제출하고 새 버전을 만들지 않음) 제출할 수 없다
- 얼리는 것: 공고(회사, 직무, 주소, 마감, 상시 여부, 원문, 인재상 글), 이력서(맞춤본에 내용이 있으면 맞춤본, 없으면 공고 트랙의 공통본, 둘 다 없으면 비움. 어느 쪽인지 적는다), 자소서 문항 전부(문항 순서대로 문항 글·글자 수 제한·공백 기준과 답의 문단. 답이 없는 문항은 문단 없이). 답 문단의 근거는 경험 id와 함께 **그때의 경험 이름**을 적어 둔다(경험을 지워도 이름이 남는다). 이력서 항목의 머리에는 이미 이름이 있다
- 얼리지 않는 것: 연락처, 고르기 결과(후보·이유), 점수(지원할 때 이미 얼려 둠), 경험 기록 자체
- 제출 전 확인 창에 "얼리는 것"과 걱정되는 점을 보인다. 막지는 않는다: 문항이 없음, 답이 없는 문항(번호), 글자 수를 넘은 문항, 표시가 남은 문항(금지 표현·기록에 없는 숫자·근거 없는 문단·바뀐 경험), 이력서 없음, 맞춤본 없이 공통본으로 냄, 이력서에 표시가 남은 항목 수
- 잠김: 제출한 공고의 자소서(문항 더하기·고치기·지우기, 고르기, 승인과 쓰기, 부분 수정, 직접 고치기·쓰기)와 맞춤본(강조 고르기, 만들기, 다듬기, 다시 쓰기)이 `submitted`로 거절되고 화면은 읽기만이다. 트랙 공통본은 잠그지 않는다(여러 공고가 함께 쓴다. 제출본에는 복사본이 있다)
- `새 버전 만들기`: 마지막 제출의 `reopened_at`을 채워 잠금을 푼다. 고친 뒤 `제출함`을 다시 누르면 다음 번호의 제출본이 생긴다. 이전 제출본은 그대로 남는다
- 두 번 누르기와 동시 제출: 화면이 본 마지막 제출 번호(`expectedNumber`, 없으면 0)를 보내고, 서버의 마지막 번호와 다르면 `changed`. `(posting_id, number)` 고유 색인이 마지막 그물이다
- 공고를 지우면 제출본도 지워진다(외래 키 cascade). 제출본이 있는 공고의 지우기 확인 문구에 "제출본 N개도 함께 지워집니다"를 붙인다
- 제출본 화면 `/postings/[id]/submissions/[number]`: 읽기만. 이력서는 `resumeText`로 복사, 자소서는 문항마다 답 복사와 글자 수(공백 포함/제외), 공고 원문. 경험 기록 링크는 두지 않는다(그때와 지금이 다를 수 있다)
- AI는 쓰지 않는다

## Global Constraints

- 앞 계획들의 Global Constraints, `docs/conventions.md`의 데이터 접근 규칙과 AI 사용 규칙을 모두 따른다
- 테이블은 `src/modules/applications/schema.ts`에 두고 `auth_user(id)`, `postings_postings(id)`를 `on delete cascade`로 참조한다. 모든 repo 함수의 첫 두 인자는 `(db, userId)`이고 모든 쿼리에 `userId` 조건이 있다. "다른 사용자의 것은 읽히지 않는다" 테스트를 둔다
- 제출본 행의 `content`, `number`, `submitted_at`은 넣은 뒤 고치는 코드가 없다. 고치는 함수는 `reopened_at`만 채운다
- 연락처는 제출본에 넣지 않는다
- 화면은 로컬 미리보기로 확인하고 사진을 사용자에게 보낸다

## Review Focus

1. 제출한 뒤 경험을 고치거나 지우고, 공고 원문을 고치고, 맞춤본·공통본·답을 고침(새 버전 뒤) → 제출본 화면은 그대로다 (Task 2 테스트 "얼린 뒤 원본을 고쳐도 제출본은 그대로")
2. 제출한 공고에서 자소서·맞춤본을 고치는 모든 길(10곳) → `submitted`, 새 버전을 만든 뒤에는 다시 된다 (Task 3 테스트)
3. `제출함`을 두 번 빨리 누름, 잠긴 공고에 오래된 화면으로 제출 → 둘째는 `changed`이고 제출본은 하나 (Task 2 테스트)
4. 맞춤본이 없음 / 공통본도 없음 / 문항이 없음 / 답 없는 문항 → 제출은 되고 확인 창에 걱정되는 점이 보이며 제출본에 어느 이력서인지(또는 없음) 적힌다 (Task 2 테스트)
5. 남의 공고 id로 제출·새 버전·보기, 보류로 바꾼 공고 → `not_found` / `not_apply`, 보류로 바꿔도 이미 얼린 제출본은 읽힌다 (Task 1, Task 2 테스트)

---

## Task 1: 테이블과 제출본 저장

**Files:**
- Modify: `src/modules/applications/schema.ts`(테이블 `submissions`), `src/modules/applications/types.ts`(제출본 타입), `docs/conventions.md`(applications 줄: 맡는 일에 "제출본", 테이블에 `applications_submissions`)
- Create: `src/modules/applications/submission-repo.ts`, `src/modules/applications/submission-repo.test.ts`, `drizzle/0015_*.sql`(`npm run db:generate`)

**Interfaces:**
- Produces (`types.ts`):
  ```ts
  export type SubmittedPosting = { company: string; title: string; url: string | null; deadline: string | null; isRolling: boolean; rawText: string; companyNote: string | null };
  export type SubmittedParagraph = { text: string; sources: { experienceId: string; name: string }[]; edited: boolean };
  export type SubmittedAnswer = { prompt: string; charLimit: number | null; countSpaces: boolean; paragraphs: SubmittedParagraph[] }; // 답이 없으면 paragraphs는 []
  export type SubmittedResume = { from: "tailored" | "common"; content: ResumeContent };
  export type SubmissionContent = { posting: SubmittedPosting; resume: SubmittedResume | null; answers: SubmittedAnswer[] };
  ```
- Produces (`schema.ts`): `submissions` = `applications_submissions`: `id` text pk, `user_id`(cascade), `posting_id`(cascade, not null), `number` integer not null, `content` jsonb `SubmissionContent` not null, `submitted_at` timestamptz not null, `reopened_at` timestamptz null. 색인: `uniqueIndex("applications_submissions_posting_number_idx").on(postingId, number)`, `index(...).on(userId, postingId)`
- Produces (`submission-repo.ts`):
  ```ts
  export type Submission = { id: string; postingId: string; number: number; content: SubmissionContent; submittedAt: Date; reopenedAt: Date | null };
  export type SubmissionSummary = Omit<Submission, "content">;
  export async function listSubmissions(db, userId, postingId): Promise<SubmissionSummary[]>; // number 오름차순
  export async function getSubmission(db, userId, postingId, number): Promise<Submission | null>;
  export async function latestSubmission(db, userId, postingId): Promise<SubmissionSummary | null>;
  export const isLocked = (latest: SubmissionSummary | null): boolean => latest !== null && latest.reopenedAt === null;
  // 마지막 번호가 expectedNumber(없으면 0)이고 잠기지 않았을 때만 expectedNumber + 1로 넣는다. 고유 색인 위반(23505)은 changed로 바꾼다
  export async function insertSubmission(db, userId, postingId, expectedNumber: number, content: SubmissionContent, now: Date): Promise<{ ok: true; number: number } | { ok: false; reason: "changed" | "not_found" }>;
  // 마지막 번호가 expectedNumber이고 reopened_at이 비었을 때만 채운다
  export async function reopenSubmission(db, userId, postingId, expectedNumber: number, now: Date): Promise<{ ok: true } | { ok: false; reason: "changed" }>;
  ```
  `insertSubmission`은 공고가 없을 때(외래 키 위반 23503) `not_found`. 23503 판별은 `resume-repo.ts`의 `isForeignKeyViolation`과 같은 방식이다(공용으로 옮겨 함께 쓴다: `src/modules/applications/db-errors.ts`의 `hasPgCode(error, code)`)

- [ ] **Step 1: 실패하는 테스트를 쓴다** (`submission-repo.test.ts`, 준비는 `resume-repo.test.ts`의 트랙·공고 만들기를 따른다)
  - `insertSubmission(…, 0, c, now)` → `{ ok: true, number: 1 }`; 다시 `0`으로 → `changed`; `latestSubmission`은 1번이고 `isLocked`가 true
  - 잠긴 채 `insertSubmission(…, 1, …)` → `changed`; `reopenSubmission(…, 1)` → ok, `isLocked` false; 다시 `reopenSubmission(…, 1)` → `changed`; `insertSubmission(…, 1, …)` → `number: 2`; `listSubmissions`는 [1, 2]이고 1번의 `reopenedAt`이 채워져 있다
  - `getSubmission(…, 1)`의 `content`가 넣은 것과 같다(깊은 비교)
  - 다른 사용자: `u2`로 `listSubmissions`·`getSubmission`·`latestSubmission`은 비고, `reopenSubmission`은 `changed`, `u2`가 `u1`의 공고 id로 `insertSubmission` → `not_found`(공고 소유 확인: `getPosting(db, userId, postingId)`가 null이면 not_found)
  - 공고를 지우면(`deletePosting`) 제출본도 없어진다; 지운 뒤 `insertSubmission` → `not_found`
- [ ] **Step 2: 돌려서 실패를 본다** — `npx vitest run src/modules/applications/submission-repo.test.ts`
- [ ] **Step 3: 테이블·타입·repo를 만들고 `npm run db:generate`로 마이그레이션을 만든다.** `resume-repo.ts`의 `isForeignKeyViolation`을 `db-errors.ts`의 `hasPgCode`로 바꾼다
- [ ] **Step 4: 돌려서 통과를 본다** — 같은 명령과 `npx vitest run src/modules/applications/resume-repo.test.ts`
- [ ] **Step 5: 커밋** — `feat: 제출본 테이블과 저장 함수를 더한다`

## Task 2: 얼리기, 새 버전, 제출 전 확인

**Files:**
- Create: `src/modules/applications/submit.ts`, `src/modules/applications/submit.test.ts`

**Interfaces:**
- Consumes: Task 1 전부, `listQuestions`(`repo.ts`), `getTailoredResume`·`getCommonResume`(`resume-repo.ts`), `getPosting`(postings), `listExperiences`(experiences, 이름만 쓴다), `checkDraft`·`countChars`·`answerText`(`check.ts`), `checkResume`(`resume-check.ts`), `listWritingSources`·`listResumeSources`(experiences/writing)
- Produces:
  ```ts
  // 순수 함수. names는 경험 id → 지금 이름(지운 경험은 없음 → "지운 경험")
  export function freeze(posting: Posting, questions: Question[], resume: SubmittedResume | null, names: Map<string, string>): SubmissionContent;
  export type SubmitFailure = "not_found" | "not_apply" | "changed";
  export async function submitPosting(db, userId, postingId, expectedNumber: number, now?: Date): Promise<{ ok: true; number: number } | { ok: false; reason: SubmitFailure }>;
  export async function reopenPosting(db, userId, postingId, expectedNumber: number, now?: Date): Promise<{ ok: true } | { ok: false; reason: "not_found" | "changed" }>;
  // 화면의 확인 창에 보일 문장들. 서버 컴포넌트가 지금의 경험으로 계산한다
  export async function submitPreview(db, userId, posting: Posting): Promise<{ resumeFrom: "tailored" | "common" | null; questionCount: number; warnings: string[] }>;
  ```
- `submitPosting`: 공고 없음 → `not_found`, 지원 아님 → `not_apply`, 그다음 내용을 모아 `freeze` → `insertSubmission`. 잠김·번호 어긋남은 `insertSubmission`의 `changed`가 맡는다
- `warnings` 문구(있는 것만, 이 순서): "자소서 문항이 없습니다", "답이 없는 문항: 2, 3번", "글자 수를 넘은 문항: 1번", "표시가 남은 문항: 1번"(문단에 banned·ungrounded·noSource·staleSource가 하나라도 있거나 questionChanged), "이력서가 없습니다", "맞춤본이 없어 트랙 공통본으로 냅니다", "이력서에 표시가 남은 항목: 2개"(`EntryCheck`의 unavailable·empty·stale·scopeChanged·banned·ungrounded 중 하나라도)

- [ ] **Step 1: 실패하는 테스트를 쓴다** (`submit.test.ts`. 경험·문항·답·이력서는 기존 repo 함수로 직접 넣는다. AI를 부르지 않는다)
  - "얼린 뒤 원본을 고쳐도 제출본은 그대로": 맞춤본·답이 있는 공고를 제출 → `reopenPosting` → 답 문단 고치기(`editParagraph`)·맞춤본 줄 고치기(`editResume`)·경험 이름 고치기(`updateExperience`)·경험 지우기·공고 원문 고치기(`updatePosting`) → `getSubmission(…, 1)`의 content가 제출 직후 읽은 것과 같다
  - 제출본 내용: 맞춤본이 있으면 `resume.from === "tailored"`; 맞춤본이 없으면 `"common"`; 둘 다 없으면 `resume === null`; 문항 순서가 position 순; 답 없는 문항은 `paragraphs: []`; 문단 sources에 경험 이름이 들어 있다; content 어디에도 연락처 필드가 없다(`profile_contacts`에 전화번호를 넣고 `JSON.stringify(content)`에 그 번호가 없다)
  - `freeze`: names에 없는 경험 id → 이름 "지운 경험"
  - 두 번 제출: `submitPosting(…, 0)` 두 번 → 둘째 `changed`, `listSubmissions` 길이 1. `Promise.all`로 동시에 둘 → 하나만 ok
  - 보류로 바꾼 공고 → `not_apply`; 보류로 바꿔도 `getSubmission`은 읽힌다; 남의 공고 → `not_found`
  - `reopenPosting`: 남의 공고 → `not_found`; 제출 없음(`expectedNumber` 0) → `changed`
  - `submitPreview`: 문항 없음·이력서 없음이면 warnings가 ["자소서 문항이 없습니다", "이력서가 없습니다"]; 답 없는 2번·한도를 넘은 1번이면 "답이 없는 문항: 2번", "글자 수를 넘은 문항: 1번"; 맞춤본 없이 공통본만 있으면 "맞춤본이 없어 트랙 공통본으로 냅니다"
- [ ] **Step 2: 돌려서 실패를 본다** — `npx vitest run src/modules/applications/submit.test.ts`
- [ ] **Step 3: 구현한다**
- [ ] **Step 4: 돌려서 통과를 본다**
- [ ] **Step 5: 커밋** — `feat: 공고의 이력서·자소서·원문을 제출본으로 얼리고 새 버전을 만든다`

## Task 3: 제출한 공고의 자소서·맞춤본 잠그기

**Files:**
- Modify: `src/modules/applications/submission-repo.ts`(`editBlock`), `repo.ts`(`addQuestions`, `guardApply`), `select.ts`(`selectForQuestion`), `write.ts`(`approveAndWrite`, `reviseParagraph`, `editParagraph`, `writeManually`), `resume-edit.ts`(`editResume`), `resume-tailor.ts`(`loadBase` → `selectEmphasis`, `buildTailored`), `resume-write.ts`(`rewriteEntries`의 맞춤본 쪽), 각 실패 타입에 `"submitted"`, `actions.ts`·`resume-actions.ts`의 `MESSAGES`
- Test: 각 파일 옆 `*.test.ts`에 잠김 경우 하나씩

**Interfaces:**
- Produces (`submission-repo.ts`):
  ```ts
  // 공고에서 자소서·맞춤본을 고칠 수 없는 까닭. 고칠 수 있으면 null
  export async function editBlock(db: Db, userId: string, posting: { id: string; status: PostingStatus }): Promise<"not_apply" | "submitted" | null>;
  ```
  지금의 `if (posting.status !== "apply") return { ok: false, reason: "not_apply" }` 열 곳을 `const block = await editBlock(db, userId, posting); if (block) return { ok: false, reason: block };`로 바꾼다. 트랙 공통본(`resume.postingId === null`)의 길은 건드리지 않는다
- 문구(두 actions 파일 모두): `submitted` "제출한 뒤에는 고칠 수 없습니다. 공고 화면에서 새 버전 만들기를 누른 뒤 고쳐 주세요"

- [ ] **Step 1: 실패하는 테스트를 쓴다** — 각 테스트 파일에서 공고를 제출(`submitPosting`)한 뒤 그 함수를 부르면 `{ ok: false, reason: "submitted" }`이고 AI(`createFakeAi`)가 불리지 않는다(`ai.calls.length === 0` 또는 그 파일이 쓰는 방식). `reopenPosting` 뒤에는 같은 호출이 지금처럼 된다(파일마다 하나: `addQuestions`). 공통본 `editResume`는 제출한 공고가 있어도 된다
- [ ] **Step 2: 돌려서 실패를 본다** — `npx vitest run src/modules/applications`
- [ ] **Step 3: 구현한다**
- [ ] **Step 4: 돌려서 통과를 본다** — 같은 명령, 그리고 `npx tsc --noEmit`
- [ ] **Step 5: 커밋** — `feat: 제출한 공고의 자소서와 맞춤본을 새 버전을 만들기 전까지 잠근다`

## Task 4: 화면

**Files:**
- Create: `src/modules/applications/submission-actions.ts`, `src/app/(app)/postings/[id]/submit-panel.tsx`(클라이언트), `src/app/(app)/postings/[id]/submissions/[number]/page.tsx`, `src/app/(app)/postings/[id]/submissions/[number]/copy-button.tsx`(클라이언트, 이미 있는 복사 버튼이 있으면 그것을 쓴다)
- Modify: `src/app/(app)/postings/[id]/page.tsx`, `src/app/(app)/postings/[id]/application/page.tsx`, `src/app/(app)/postings/[id]/resume/page.tsx`, `src/app/(app)/postings/posting-actions.tsx`(지우기 확인 문구. 공고 화면이 제출본 수 `submissionCount`를 넘긴다)

**Interfaces:**
- Produces (`submission-actions.ts`, `"use server"`, 모두 `requireUser()`의 id만 쓰고 끝나면 `/postings/[id]`, `/application`, `/resume`을 다시 그린다. 결과는 `{ ok: true } | { ok: false; message: string }`):
  - `submitAction(postingId: string, expectedNumber: number)`, `reopenAction(postingId: string, expectedNumber: number)`. `expectedNumber`는 `Number.isInteger`이고 0 이상인지만 보고 비교에만 쓴다
  - 문구: `not_found` "공고를 찾을 수 없습니다", `not_apply` "지원으로 고른 공고에서만 제출할 수 있습니다", `changed` "그사이 제출 상태가 바뀌었습니다. 화면을 새로 고쳐 주세요"

**공고 화면 (`/postings/[id]`)** — 자소서·맞춤본 링크 아래 `SubmitPanel`(props: postingId, 마지막 번호, 잠김 여부, 지원 여부, `submitPreview` 결과, 제출 목록 `{ number, submittedAt }[]`)
- 지원이고 잠기지 않음: `제출함` 버튼. 누르면 그 자리에 확인 상자: "지금의 공고 원문, 이력서(맞춤본/트랙 공통본/없음), 자소서 문항 N개를 얼립니다. 얼린 제출본은 고칠 수 없습니다" + 걱정되는 점 목록(노란 글) + `얼리기`·`취소`
- 잠김: "제출함 · 2026-11-19(한국 시각 날짜) · 제출 N" + `새 버전 만들기`(확인 "새 버전을 만들면 자소서와 맞춤본을 다시 고칠 수 있습니다. 지금 제출본은 그대로 남습니다")
- 제출 목록이 있으면(지원이 아니어도) "제출본: 제출 1 (11/19), 제출 2 (11/20)" 각각 `/postings/[id]/submissions/[number]` 링크
- 자소서·맞춤본 링크 문구: 잠기면 `자소서 보기`, `이력서 맞춤본 보기`

**자소서·맞춤본 화면** — `canAct = posting.status === "apply" && !locked`. 잠기면 맨 위 안내 "제출 N(날짜)을 얼린 뒤라 고칠 수 없습니다. 고치려면 공고 화면에서 새 버전 만들기를 눌러 주세요"와 공고 화면 링크. 지원이 아닐 때의 안내는 지금 그대로

**제출본 화면 (`/postings/[id]/submissions/[number]`)** — `requireUser`, 남의 것·없는 번호는 `notFound()`
- 머리: "제출 N · 날짜", 그때의 회사·직무, 공고로 돌아가기. 새 버전으로 넘어갔으면 "이후 새 버전을 만들었습니다"
- 이력서: 어느 쪽인지("맞춤본"/"트랙 공통본") + `sections(content)`로 섹션·항목(머리, 줄) + `복사`(`resumeText`). 없으면 "이력서 없이 제출했습니다"
- 자소서: 문항마다 번호·문항 글·답(문단을 줄바꿈으로)·글자 수 "공백 포함 N자 / 공백 제외 M자"(제한이 있으면 "/ 제한 L자")·`복사`. 답이 없으면 "답 없음"
- 공고 원문과 인재상 글(`pre`)

- [ ] **Step 1: 화면을 만든다**
- [ ] **Step 2: `npx tsc --noEmit`, `npm run lint`가 통과한다**
- [ ] **Step 3: 로컬 미리보기로 확인한다** — 트랙·확인된 경험·공통본·공고(지원)·문항 둘(하나만 답)을 만들고 공고 화면 → `제출함` → 걱정되는 점("답이 없는 문항: 2번", "맞춤본이 없어 트랙 공통본으로 냅니다") → 얼리기 → 자소서 화면이 읽기만 → 제출본 화면 → `새 버전 만들기` → 답 고치기 → 다시 제출 → 제출 1과 제출 2가 다르다. 공고 화면(확인 상자), 잠긴 자소서 화면, 제출본 화면을 사진으로 찍어(`deviceScaleFactor: 2`) 사용자에게 보낸다
- [ ] **Step 4: 커밋** — `feat: 공고 화면에 제출함·새 버전 만들기와 제출본 화면을 더한다`

## Task 5: 확인

- [ ] `npx tsc --noEmit`, `npm run lint`, `npm test`, `npm run build` 모두 통과
- [ ] 이 문서 끝 "구현하면서 달라진 점"을 적고, `docs/status.md`와 판단표 점검을 고친다
- [ ] `/ship`으로 올린다. `drizzle/**`, `schema.ts`를 바꾸므로 합치기는 사용자에게 묻는다(판단표 ②)
- [ ] 합친 뒤 사용자에게 부탁: 실제로 지원한 공고 하나에서 `제출함`을 눌러 제출본 화면의 이력서·자소서가 낸 것과 같은지 본다

## 하지 않는 것 (5-3)

- 진행 상태(지원완료 등)와 지원 현황(7번 계획). 제출해도 지원 판단은 그대로다
- 제출본 내려받기(워드·PDF, 6번 계획). 이번에는 글 복사만
- 제출본끼리 다른 점 보여 주기, 제출본 지우기(공고를 지우면 함께 지워진다)
- 제출본에서 출발해 되돌리기(새 버전은 지금의 자소서·맞춤본에서 출발한다)

## 구현하면서 달라진 점

- Task 1: 오류 코드 판별을 `src/modules/applications/db-errors.ts`의 `hasPgCode(error, code)`로 옮겨 `resume-repo.ts`와 `submission-repo.ts`가 함께 쓴다. 공고를 지운 뒤의 제출은 `getPosting` 소유 확인에서 `not_found`
- Task 2: 맞춤본·공통본 고르기는 `pickResume` 하나를 `submitPosting`과 `submitPreview`가 함께 쓴다(확인 창과 얼리는 것이 같다)
- Task 4: 날짜 표시는 `src/modules/postings/today.ts`의 `koreaDate`·`koreaMonthDay`(한국 시각). 제출본 화면의 `복사`는 새 `copy-button.tsx`(이력서·자소서 화면의 복사 버튼은 각 컴포넌트 안에 있어 그대로 둠)
- (최종 검토) 제출한 공고를 보류·관심으로 바꾸면 자소서·맞춤본 화면이 "새 버전 만들기를 눌러 주세요"만 보였는데 공고 화면에는 그 버튼이 없었다 → 잠김 안내는 지원이고 잠겼을 때만, 지원이 아니면 늘 지원 아님 안내
- (최종 검토) AI 작업이 도는 사이 제출하면 AI 결과가 잠긴 공고에 저장됐다(제출본은 그대로지만 화면이 어긋남) → AI 뒤 저장 직전에 공고를 다시 읽어 잠김을 보는 `editBlockNow`를 여섯 곳(`approveAndWrite`, `reviseParagraph`, `selectForQuestion`, `selectEmphasis`, `buildTailored`, 맞춤본 `rewriteEntries`)에 둔다
- (최종 검토) 항목을 다 뺀 맞춤본(항목 0개)은 없는 것으로 쳐서 공통본을 얼린다. 공통본도 0개면 이력서 없음
- (최종 검토) 확인 상자를 닫거나 다시 열면 지난 오류 문구를 지운다. 제출·새 버전 뒤 제출본 화면도 다시 그린다. 잠긴 맞춤본 화면에서 맞춤본이 없으면 "트랙 공통본으로 제출했습니다"/"이력서 없이 제출했습니다"
- 남긴 것(작아서 고치지 않음): 얼릴 때 문항·이력서·경험 이름을 트랜잭션 하나로 읽지 않는다(읽는 사이 바뀌면 그 중간이 얼 수 있다. 혼자 쓰는 화면이라 틈이 작다). 항목 0개인 맞춤본 행이 있는데 공통본으로 제출했으면 잠긴 맞춤본 화면에 빈 편집기가 보이고 "트랙 공통본으로 제출했습니다"는 안 보인다. 동시 제출 테스트는 PGlite가 직렬화해 고유 색인 경로를 실제로 타지 않을 수 있다

## 판단표 점검 (2026-11-19)

- 볼 것: 5-2 이후 PR #29~#33(AI가 고친 지시문·별명 읽기)과 이 계획. 사용자가 바로잡은 일은 없다. AI가 합친 뒤 Vercel 새 오류는 이 세션에서 보지 않았다(이번 PR 배포 뒤 ④로 본다)
- ③ 계획 승인: 새 테이블 하나만 물었고(사용자: 새 테이블), 잠그기·새 버전은 설계의 「제안」대로라 묻지 않았다. 맞았다
- 작업마다 검토는 결함을 찾지 못했고(모두 Minor), 최종 검토가 작업 사이 빈틈(보류로 바꾼 뒤 막다른 안내, AI 작업 중 제출)을 찾았다. 최종 검토는 계속 쓸모 있다
- ②: `drizzle/**`, `schema.ts`를 바꿔 반드시 묻는다. 표대로다
- 직접 만든 장치: `related-test.sh`, `/ship`, `vercel.json`은 그대로 쓴다. 지울 것 없음. 새로 안 것: 깨끗한 작업 환경에서는 `npx tsc --noEmit` 전에 `npx next typegen`이 필요하다(CI는 이미 한다)
- 판단표는 고치지 않았다

## CI 시간 초과 (2026-11-19)

- PR #34의 `check`가 15분 제한에 걸려 취소됐다(실패한 테스트는 없음, 테스트가 도는 중). 직전 실행들도 8~14분이라 테스트가 늘며 넘었다
- 원인: `createTestDb()`가 테스트마다 새 PGlite를 처음부터 띄워(initdb, 로컬 1.9초) 마이그레이션을 적용했다
- 고침: 테스트 파일마다 마이그레이션을 마친 DB를 한 번 만들어 데이터 디렉터리 사본을 두고, 그다음부터는 사본에서 띄운다(0.4초). 사본에서 띄운 DB는 닫지 않으면 메모리가 쌓여(한 파일 9GB) `src/test-setup.ts`가 테스트마다 만든 DB를 테스트 뒤에 닫는다(`beforeAll`에서 만든 DB는 파일 끝까지 쓴다). 로컬에서 파일별 시간 합이 868초 → 367초, `write.test.ts`는 72초 → 20초, 메모리 2.6GB → 1.1GB
