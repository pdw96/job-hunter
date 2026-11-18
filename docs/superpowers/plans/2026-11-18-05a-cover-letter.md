# Job Hunter 5-1번 계획: 자기소개서 쓰기 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 지원으로 고른 공고에 자소서 문항을 붙여 넣으면, AI가 문항마다 쓸 확인된 경험을 근거와 함께 고르고, 사용자가 고른 경험을 승인하면 그 경험만으로 답을 쓴다. 문단마다 어느 경험에서 나왔는지 보이고, 코드가 금지 표현·기록에 없는 숫자·근거 없는 문단·글자 수를 검사해 표시한다. 사용자는 문단을 직접 고치거나 AI에게 그 문단만 고쳐 달라고 할 수 있다.

**Architecture:** 새 모듈 `applications`가 테이블 `applications_questions` 하나를 갖는다. 문항 한 행에 고르기 결과(`selection`)와 쓴 답(`draft`)을 jsonb로 둔다. 쓸 수 있는 경험은 `experiences` 모듈의 새 함수로 받고, 공고는 `postings` 모듈의 `getPosting`으로 읽는다. 검사는 순수 함수(`applications/check.ts`)가 화면을 그릴 때마다 지금의 경험으로 계산한다(4-2의 점수와 같은 방식). 그래서 경험을 고치거나 확인을 풀면 표시가 바로 바뀐다.

**Tech Stack:** Next.js 16(App Router), Drizzle + Postgres(테스트는 PGlite), zod, Vitest

**Spec:** `docs/superpowers/specs/2026-11-16-job-hunter-design.md`의 4(방식 2: 고르기 → 쓰기), 6.3(사용 범위, 하지 않은 것과 금지 표현, 수치), 6.5 "입력", "고르기 단계", "쓰기 단계", 2의 반목표

## 정한 것

- 「결정」(2026-11-18, 사용자) 5번 계획을 셋으로 나눈다: 5-1 자소서(이 문서), 5-2 이력서 공통본·맞춤본, 5-3 제출본 얼리기. 새 모듈 `applications`와 테이블 `applications_questions` 하나
- 자소서는 공고의 지원 판단이 "지원"일 때만 문항을 더하고 AI를 부를 수 있다(설계: 지원을 골라야 작성으로 넘어간다). 지원에서 다른 판단으로 바꿔도 문항과 답은 남고 볼 수 있다
- 고르기 후보 = 확인됨이고 그 트랙에서 "사용"인 경험(설계 6.3: "요약만"은 자소서 고르기 후보에 나오지 않는다). 부분 확인·미확인·요약만·제외는 AI에 보내지 않는다
- 수치는 루브릭의 수치가 "충족"인 경험만 쓴다(설계 6.3: 수치가 미달이거나 닫혀 있으면 그 수치만 빠진다). 고르기에는 수치를 보내지 않고, 화면의 추천 근거에 "확인된 수치 n개"를 코드가 붙인다. 쓰기에만 수치와 그 기준을 보낸다. 증빙 메모는 보내지 않는다
- 고르기는 문항마다 AI 1번. 다른 문항에서 이미 승인한 경험을 알려 주어 되도록 겹치지 않게 하고, 겹치면 화면에 "N번 문항에도 씀"으로 표시만 한다(막지 않는다)
- 한 문항에 고르는 경험은 많아야 3개, 후보로 밀린 것은 5개까지, 승인은 5개까지
- 승인과 쓰기는 버튼 하나(`이 경험으로 쓰기`)로 잇는다. 승인한 경험의 내용이 바뀌었거나(버전), 확인이 풀렸거나, 트랙에서 "사용"이 아니게 되면 쓰지 않고 다시 고르게 한다
- 글자 수: 공백 포함 = 줄바꿈을 포함한 모든 글자(코드 포인트), 공백 제외 = 모든 공백 문자(줄바꿈 포함)를 뺀 글자. 답 전체는 문단을 줄바꿈 하나로 이어 센다. 기본 기준은 공백 포함
- 문항 글에서 "500자", "(1,000자 이내)" 같은 제한을 찾아 미리 채운다. 여러 문항을 한 번에 붙여 넣으면 번호("1.", "1)", "Q1", "문항 1")로 나눈다(타자를 줄인다)
- 부분 수정은 `더 짧게` / `더 구체적으로` / `더 자연스럽게` 버튼과, 원하면 짧은 요청(200자) 하나. 같은 규칙과 같은 승인 경험으로 그 문단만 다시 쓴다
- 직접 고친 문단은 근거 표시가 "직접 수정"이 되고, 그 문단은 숫자 검사·근거 없음 검사를 하지 않는다(사용자가 쓴 글). 금지 표현과 글자 수는 계속 검사한다
- 문항 글을 고치면 고르기 결과는 지우고(다시 골라야 한다) 쓴 답은 남기되 "문항을 고친 뒤입니다. 다시 쓰기를 권합니다"를 보인다. 글자 수 제한·기준만 고치면 아무것도 지우지 않는다
- 검사에 걸려도 저장과 복사는 막지 않는다. 어긴 곳을 표시한다(설계 6.5)
- AI 용도는 `application_select`, `application_write`, `application_revise`

## Global Constraints

- 앞 계획들의 Global Constraints, `docs/conventions.md`의 데이터 접근 규칙과 AI 사용 규칙을 모두 따른다
- AI 호출은 `runAi()`를 거친다. 모델은 `claude-sonnet-5-5`(바꾸지 않는다)
- AI에게 보내지 않는 것: 연락처, 이메일, 사용자 id, 경험의 실제 id(별명 E1, E2 …만), 증빙 메모, 확인됨이 아니거나 그 트랙에서 "사용"이 아닌 경험, 루브릭 수치가 충족이 아닌 경험의 수치. 쓰기·부분 수정에는 승인한 경험만 보낸다
- 기록에 없는 경험·수치·역할을 쓰지 않는다. 근거가 부족하면 메우지 않고 부족하다고 알린다(`shortage`)
- AI가 돌려준 내용은 코드가 검사한 뒤에만 저장한다. 시간이 걸리는 AI 작업은 읽었을 때의 문항·승인·답 그대로일 때만 저장한다
- 반목표 네 가지(지어낸 수치, 금지 표현, 근거 없는 문장, 다른 사용자의 기록)는 자동 테스트로 확인한다
- 화면은 로컬 미리보기로 확인하고 사진을 사용자에게 보낸다

## Review Focus

1. 승인하거나 답을 쓴 뒤 근거 경험을 고치거나, 확인을 풀거나, 트랙에서 요약만·제외로 바꿈 → 쓰기는 `stale`로 막히고, 이미 쓴 답의 그 문단에 "근거 경험이 바뀜"이 보인다 (Task 2 `checkDraft` 테스트, Task 4 테스트)
2. 확인된 "사용" 경험이 하나도 없음 → AI를 부르지 않고 "이 문항에 맞는 확인된 기록이 없습니다"와 AI 인터뷰 버튼 (Task 3 테스트, Task 5 화면)
3. AI가 답하는 사이 문항을 고치거나 다른 탭에서 다시 고르거나 문단을 고침 → 저장하지 않고 `changed` (Task 3, Task 4 테스트)
4. 제한 없는 문항, 공백 제외 기준, 제한을 넘는 답 → 글자 수가 기준대로 세어지고 넘으면 표시 (Task 2 테스트)
5. 지원에서 보류로 바꾼 공고, 남의 공고 → 문항 더하기와 AI 작업은 `not_apply` / `not_found`, 남은 문항은 읽힌다 (Task 1, Task 3 테스트)

---

## Task 1: 테이블, 문항 저장, 쓸 수 있는 경험

**Files:**
- Create: `src/modules/applications/schema.ts`, `src/modules/applications/types.ts`(타입만), `src/modules/applications/options.ts`, `src/modules/applications/repo.ts`, `src/modules/applications/repo.test.ts`, `src/modules/experiences/writing.ts`, `src/modules/experiences/writing.test.ts`
- Modify: `src/db/schema.ts`(한 줄), `docs/conventions.md`(모듈 표에 `applications | 자기소개서 문항, 고른 경험, 쓴 답 | applications_questions`)
- Create: `drizzle/0013_*.sql` (`npm run db:generate`)

**Interfaces:**
- Produces (`applications/options.ts`):
  ```ts
  export const APPLICATION_LIMITS = { questions: 10, prompt: 1000, charLimitMin: 50, charLimitMax: 10000,
    picks: 3, passed: 5, approved: 5, paragraphs: 10, paragraph: 2000, reason: 300, note: 200, shortage: 500 } as const;
  ```
- Produces (`applications/types.ts`):
  ```ts
  export type SourceRef = { experienceId: string; contentVersion: number };
  export type PickReason = SourceRef & { overlap: string; role: string }; // 겹치는 문구, 쓸 수 있는 본인 역할
  export type PassedReason = SourceRef & { whyNot: string };
  export type Selection = { questionVersion: number; picks: PickReason[]; passed: PassedReason[]; noMatch: boolean;
    selectedAt: string; approved: SourceRef[] | null; approvedAt: string | null };
  export type Paragraph = { text: string; sources: string[]; edited: boolean }; // sources는 경험 id
  export type Draft = { questionVersion: number; basedOn: SourceRef[]; paragraphs: Paragraph[]; shortage: string; writtenAt: string };
  ```
- Produces (`applications/schema.ts`): `applications_questions` — `id` text pk, `user_id` → `auth_user` cascade, `posting_id` → `postings_postings` cascade, `position` int, `prompt` text, `char_limit` int null, `count_spaces` boolean default true, `version` int default 0(문항 글이 바뀔 때마다 +1), `selection` jsonb null, `draft` jsonb null, `created_at`, `updated_at`. 색인 `(user_id, posting_id)`
- Produces (`applications/repo.ts`):
  ```ts
  export type QuestionInput = { prompt: string; charLimit: number | null; countSpaces: boolean };
  export type Question = QuestionInput & { id: string; postingId: string; position: number; version: number;
    selection: Selection | null; draft: Draft | null; createdAt: Date; updatedAt: Date };
  export async function addQuestions(db, userId, postingId, inputs: QuestionInput[]): Promise<{ ok: true; ids: string[] } | { ok: false; reason: "not_found" | "not_apply" | "too_many" }>;
  export async function listQuestions(db, userId, postingId): Promise<Question[]>; // position 순
  export async function getQuestion(db, userId, id): Promise<Question | null>;
  export async function updateQuestion(db, userId, id, input: QuestionInput): Promise<{ ok: true } | NotFound>;
  export async function deleteQuestion(db, userId, id): Promise<{ ok: true } | NotFound>;
  export async function saveSelection(db, userId, id, selection: Selection): Promise<{ ok: true } | { ok: false; reason: "not_found" | "changed" }>;
  export async function approveSelection(db, userId, id, approved: SourceRef[], readAs: Selection, now?: Date): Promise<{ ok: true } | { ok: false; reason: "not_found" | "changed" }>;
  export async function saveDraft(db, userId, id, draft: Draft, readAs: { version: number; approved: SourceRef[] }): Promise<{ ok: true } | { ok: false; reason: "not_found" | "changed" }>;
  export async function replaceDraft(db, userId, id, expected: Draft, next: Draft): Promise<{ ok: true } | { ok: false; reason: "not_found" | "changed" }>;
  ```
  - `addQuestions`: `getPosting`(postings 모듈)으로 공고가 내 것인지와 `status === "apply"`를 본다. 공고당 `APPLICATION_LIMITS.questions`를 넘으면 `too_many`(하나도 넣지 않는다). position은 이어서 붙인다
  - `updateQuestion`: `prompt`가 바뀌면 `version + 1`, `selection = null`. `draft`는 그대로. 제한·기준만 바뀌면 둘 다 그대로
  - `saveSelection`: `version = selection.questionVersion`일 때만(아니면 `changed`). 승인은 지우고(`approved: null`) 답은 그대로
  - `approveSelection`: 지금 `selection`이 `readAs`와 같을 때만(jsonb 비교) `approved`, `approvedAt`을 채운다
  - `saveDraft`: `version`과 `selection->'approved'`가 `readAs`와 같을 때만
  - `replaceDraft`: 지금 `draft`가 `expected`와 같을 때만(부분 수정·직접 수정용)
  - 모든 함수는 `userId` 조건. 찾지 못하면 `not_found`, 조건이 어긋나면 `changed`(4-2의 `saveAnalysis`와 같은 방식)
- Produces (`experiences/writing.ts`):
  ```ts
  export type WritingSource = Pick<Experience, "id" | "name" | "kind" | "organization" | "role" | "startMonth" | "endMonth"
    | "isOngoing" | "situation" | "actions" | "result" | "notDone" | "bannedPhrases" | "contentVersion"> & { metrics: Metric[] };
  export async function listWritingSources(db: Db, userId: string, trackId: string): Promise<WritingSource[]>;
  ```
  확인됨이고 그 트랙의 범위가 "사용"(행이 없으면 사용)인 것만. 루브릭 `metrics.status`가 `met`이 아니면 `metrics: []`. 남의 트랙이면 `[]`. 순서는 `listEvidenceCandidates`와 같다. 증빙 메모 칸이 없다

- [ ] **Step 1: 실패하는 테스트를 쓴다**
  - `writing.test.ts`: "확인됨만 나오고 부분 확인·미확인은 빠진다", "요약만·제외인 경험은 빠진다", "수치가 충족이 아니면 metrics가 빈 배열", "다른 사용자의 경험과 남의 트랙은 나오지 않는다", "증빙 메모 칸이 없다"(`expect(Object.keys(s)).not.toContain("evidenceNote")`)
  - `repo.test.ts`: "지원 공고에만 문항을 더한다"(관심 공고는 `not_apply`), "남의 공고는 not_found", "11개째는 too_many이고 하나도 들어가지 않는다", "문항 글을 고치면 version이 오르고 selection이 지워지며 draft는 남는다", "제한만 고치면 selection이 남는다", "saveSelection은 version이 다르면 changed", "다시 고르면 승인이 지워진다", "saveDraft는 승인이 바뀌었으면 changed", "replaceDraft는 draft가 expected와 다르면 changed", "지원에서 보류로 바꿔도 listQuestions는 문항을 돌려준다", "다른 사용자의 문항은 읽히지도 고쳐지지도 않는다"(get/list/update/delete/save*), "공고를 지우면 문항도 지워진다"
- [ ] **Step 2: 돌려서 실패를 본다** — `npx vitest run src/modules/applications/repo.test.ts src/modules/experiences/writing.test.ts`
- [ ] **Step 3: 구현한다.** 스키마를 만들고 `src/db/schema.ts`에 더한 뒤 `npm run db:generate`로 `0013` 마이그레이션을 만든다
- [ ] **Step 4: 돌려서 통과를 본다** — 같은 명령, PASS
- [ ] **Step 5: 커밋** — `feat: 자소서 문항을 저장할 applications 모듈과 지원서에 쓸 수 있는 경험 목록을 더한다`

## Task 2: 문항 나누기, 글자 수, 검사 (순수 함수)

**Files:**
- Create: `src/modules/applications/input.ts`, `src/modules/applications/input.test.ts`, `src/modules/applications/check.ts`, `src/modules/applications/check.test.ts`

**Interfaces:**
- Consumes: Task 1의 타입, `WritingSource`; `experiences/grounding`의 `numbersIn`
- Produces (`input.ts`):
  ```ts
  export function splitQuestions(text: string): string[];         // 번호 줄로 나눈다. 번호가 없으면 통째로 하나. 빈 것은 버린다. 번호 표시는 뗀다
  export function detectLimit(prompt: string): number | null;     // "(\d[\d,]*)\s*자"의 마지막 것. 범위(50~10000) 밖이면 null
  export function validateQuestion(raw: unknown): { ok: true; value: QuestionInput } | { ok: false; errors: Partial<Record<keyof QuestionInput, string>> };
  ```
  문구: 빈 문항 "문항을 적어 주세요", 길이 초과 "문항은 1000자까지 적을 수 있습니다", 제한 범위 밖 "글자 수 제한은 50~10000자로 적어 주세요"
- Produces (`check.ts`):
  ```ts
  export function countChars(text: string, countSpaces: boolean): number;
  export function answerText(draft: Draft): string;               // 문단을 "\n"으로 잇는다
  export type ParagraphCheck = { banned: string[]; ungrounded: string[]; noSource: boolean; staleSource: boolean };
  export type DraftCheck = { length: { count: number; limit: number | null; over: boolean }; paragraphs: ParagraphCheck[]; questionChanged: boolean };
  export function checkDraft(draft: Draft, question: Pick<Question, "prompt" | "charLimit" | "countSpaces" | "version">, sources: WritingSource[]): DraftCheck;
  ```
  - `banned`: `draft.basedOn` 경험들의 지금 `bannedPhrases` 중 문단에 든 것(공백·대소문자 무시). 직접 수정한 문단도 본다
  - `ungrounded`(직접 수정이 아닌 문단만): `numbersIn(문단)` 중 그 문단 `sources` 경험의 글 칸(이름, 소속, 역할, 기간, 상황, 한 일, 결과)·수치(`text`, `basis`)와 문항 글에 없는 숫자
  - `noSource`(직접 수정이 아닌 문단만): `sources` 중 `basedOn`에 있는 경험이 하나도 없다
  - `staleSource`: 문단의 `sources` 중 지금 `sources` 목록에 없거나 `contentVersion`이 `basedOn`과 다른 것이 있다
  - `questionChanged`: `draft.questionVersion !== question.version`

- [ ] **Step 1: 실패하는 테스트를 쓴다**
  - `input.test.ts`: "번호 붙은 세 문항을 나눈다"(`"1. 지원 동기 (500자)\n2) 입사 후 포부\nQ3 협업 경험"` → 3개, 번호 뗌), "번호가 없으면 하나", "문항 1, 문항 2 표기", "detectLimit: '(1,000자 이내)' → 1000, '500자' → 500, 숫자 없으면 null, '30자' → null", "validateQuestion 문구"
  - `check.test.ts`:
    - "공백 포함은 줄바꿈까지 세고 공백 제외는 모든 공백을 뺀다": `"가 나\n다"` → 포함 5, 제외 3. 이모지 하나는 1
    - "제한을 넘으면 over, 제한이 없으면 over false"
    - "기록에 없는 숫자를 표시한다"(반목표: 경험에 "응답 시간 1.2초"만 있는데 문단에 "40% 개선" → `ungrounded: ["40"]`), "수치 칸과 문항 글의 숫자는 통과"
    - "금지 표현을 표시한다"(반목표: bannedPhrases `["주도"]`, 문단 "프로젝트를 주도하며" → `banned: ["주도"]`), "직접 수정한 문단도 금지 표현은 본다"
    - "근거 없는 문단을 표시한다"(반목표: `sources: []` → `noSource`), "승인 목록에 없는 id만 있으면 noSource", "직접 수정한 문단은 숫자·근거 검사를 하지 않는다"
    - "근거 경험이 바뀌거나 사라지면 staleSource"(Review Focus 1)
    - "문항 version이 다르면 questionChanged"
- [ ] **Step 2: 돌려서 실패를 본다** — `npx vitest run src/modules/applications/input.test.ts src/modules/applications/check.test.ts`
- [ ] **Step 3: 구현한다**
- [ ] **Step 4: 돌려서 통과를 본다**
- [ ] **Step 5: 커밋** — `feat: 자소서 문항 나누기와 글자 수·금지 표현·숫자·근거 검사를 더한다`

## Task 3: AI로 경험 고르기

**Files:**
- Create: `src/modules/applications/select.ts`, `src/modules/applications/select.test.ts`, `src/modules/applications/prompts.ts`(`SELECT_SYSTEM`)
- Modify: `src/modules/ai/client.ts`(`AiPurpose`에 `"application_select" | "application_write" | "application_revise"`), `src/dev/local-ai.ts`(가짜 답)

**Interfaces:**
- Consumes: Task 1 전부, `postings/repo`의 `getPosting`, `experiences/grounding`의 `numbersIn`, `experiences/options`의 `KIND_LABELS`
- Produces:
  ```ts
  export type SelectInput = { prompt: string; charLimit: number | null; postingText: string; requirements: string[];
    sources: WritingSource[]; usedElsewhere: string[] /* 다른 문항에서 승인한 경험 id */ };
  // 저장하지 않는다. 프롬프트 점검(Task 6)도 이것을 쓴다
  export async function selectText(db, ai, userId, input: SelectInput, now?: Date):
    Promise<{ ok: true; value: Omit<Selection, "questionVersion"> } | { ok: false; reason: "over_limit" | AiFailure }>;
  export async function selectForQuestion(db, ai, userId, questionId: string, now?: Date):
    Promise<{ ok: true; value: Selection } | { ok: false; reason: "not_found" | "not_apply" | "changed" | "over_limit" | AiFailure }>;
  // 경험 글 한 건을 AI용으로 적는다. Task 4도 쓴다(withMetrics일 때만 수치와 기준, 하지 않은 것, 금지 표현을 붙인다)
  export function describeSource(alias: string, s: WritingSource, withMetrics: boolean): string;
  ```

**AI에게 보내는 글** (user 메시지 하나, 칸마다 `[이름]` 머리)
- `[문항]` 문항 글, `[글자 수]` 제한(없으면 "없음"), `[공고]` 원문과 인재상 글, `[공고 요구 사항]` 4-2에서 뽑은 요구 사항 `text`를 줄마다(분석이 없으면 "없음")
- `[경험 기록]` 후보마다 `describeSource(E1…, s, false)`: 이름, 구분, 소속·기관, 직무·역할, 기간, 상황, 본인이 한 일, 결과
- `[다른 문항에서 쓰기로 한 경험]` 별명을 `, `로(없으면 "없음")
- `effort: "medium"`, `maxTokens: 8000`

**답의 모양 (zod)**: `{ picks: { exp: string, overlap: string, role: string }[], passed: { exp: string, whyNot: string }[] }`

**`SELECT_SYSTEM`에 담을 것** (문구는 구현자가 쓴다)
- 문항에 답하는 데 가장 맞는 경험을 1~3개 고른다. 맞는 것이 없으면 고르지 않는다(빈 배열)
- `overlap`: 문항이나 공고의 어느 문구와 경험의 어느 내용이 겹치는지 한 문장. `role`: 그 경험에서 본인이 한 일을 기록에 적힌 대로 한 문장
- `passed`: 고르지 않은 후보 가운데 그럴듯했던 것과 밀린 이유 한 문장
- 다른 문항에서 쓰기로 한 경험은 더 맞는 것이 없을 때만 고른다
- 기록에 없는 내용과 숫자를 쓰지 않는다. 글을 쓰지 않는다

**코드 검사** (`selectText` 안)
- 후보가 없으면 AI를 부르지 않고 `{ picks: [], passed: [], noMatch: true, … }`
- 별명이 후보에 없으면 버린다. 같은 경험은 처음 것만. `picks`는 3개, `passed`는 고른 것을 빼고 5개까지
- `overlap`, `role`, `whyNot`은 다듬어 300자까지. 그 경험의 글 칸·문항·공고 글에 없는 숫자가 있으면 그 칸을 `""`로
- `noMatch = picks.length === 0`. `approved: null`, `approvedAt: null`, `selectedAt: now.toISOString()`

**`selectForQuestion`**: `getQuestion` → `getPosting`(없으면 `not_found`, `status !== "apply"`면 `not_apply`) → `listWritingSources(posting.trackId)`, `listQuestions`로 다른 문항의 `selection.approved` → `selectText` → `saveSelection({ questionVersion: question.version, …value })`

- [ ] **Step 1: 실패하는 테스트를 쓴다** (`createFakeAi`, `createTestDb`)
  - "AI에 보내는 글에 확인된 사용 경험의 별명과 내용이 있고, 부분 확인·요약만 경험, 수치, 증빙 메모, 이메일, 실제 id가 없다"
  - "확인된 사용 경험이 없으면 AI를 부르지 않고 noMatch로 저장한다"(Review Focus 2, `fake.requests.length === 0`)
  - "없는 별명은 버리고 별명을 실제 id와 버전으로 바꾼다", "picks는 3개까지, passed에서 고른 경험은 빠진다"
  - "overlap에 기록에 없는 숫자가 있으면 비운다"
  - "다른 문항에서 승인한 경험이 [다른 문항에서 쓰기로 한 경험]에 별명으로 들어간다"
  - "AI가 답하는 사이 문항 글을 고치면 changed이고 저장하지 않는다"(Review Focus 3, 가짜 답을 함수로 주고 그 안에서 `updateQuestion`)
  - "지원이 아닌 공고는 not_apply, 남의 문항은 not_found이고 둘 다 AI를 부르지 않는다"(Review Focus 5)
  - "사용량이 application_select로 기록된다", "refused·over_limit을 그대로 돌려준다"
- [ ] **Step 2: 돌려서 실패를 본다** — `npx vitest run src/modules/applications/select.test.ts`
- [ ] **Step 3: 구현한다.** `local-ai.ts`의 가짜 답: `E1`을 고르고(overlap "문항의 경험 요구와 겹칩니다", role은 그 경험의 "본인이 한 일" 첫 줄), `E2`가 있으면 passed
- [ ] **Step 4: 돌려서 통과를 본다**
- [ ] **Step 5: 커밋** — `feat: AI가 자소서 문항마다 쓸 확인된 경험을 근거와 함께 고른다`

## Task 4: 승인, 쓰기, 부분 수정, 직접 수정

**Files:**
- Create: `src/modules/applications/write.ts`, `src/modules/applications/write.test.ts`
- Modify: `src/modules/applications/prompts.ts`(`WRITE_SYSTEM`, `REVISE_SYSTEM`), `src/dev/local-ai.ts`

**Interfaces:**
- Consumes: Task 1~3(`describeSource`, `checkDraft`는 검사 테스트에서만)
- Produces:
  ```ts
  type WriteFailure = "not_found" | "not_apply" | "changed" | "stale" | "over_limit" | AiFailure;
  // 고른 경험을 승인하고 곧바로 쓴다. experienceIds는 화면이 보낸 것이므로 지금의 WritingSource에 있는 것만 받는다
  export async function approveAndWrite(db, ai, userId, questionId: string, experienceIds: string[], now?: Date):
    Promise<{ ok: true; value: Draft } | { ok: false; reason: WriteFailure | "none_selected" }>;
  export type WriteInput = { prompt: string; charLimit: number | null; countSpaces: boolean; postingText: string; sources: WritingSource[] };
  export async function writeText(db, ai, userId, input: WriteInput, now?: Date):
    Promise<{ ok: true; value: Pick<Draft, "paragraphs" | "shortage"> } | { ok: false; reason: "over_limit" | AiFailure }>; // 프롬프트 점검도 쓴다
  export type RevisePreset = "shorter" | "concrete" | "natural";
  export async function reviseParagraph(db, ai, userId, questionId: string, index: number,
    request: { preset: RevisePreset | null; note: string }, expected: Draft, now?: Date):
    Promise<{ ok: true; value: Draft } | { ok: false; reason: WriteFailure | "empty_request" }>;
  export async function editParagraph(db, userId, questionId: string, index: number, text: string, expected: Draft, now?: Date):
    Promise<{ ok: true; value: Draft } | { ok: false; reason: "not_found" | "changed" | "too_long" }>;
  ```

**`approveAndWrite`**
- 문항·공고 확인(`not_found`, `not_apply`), `selection`이 없으면 `changed`
- `experienceIds`를 지금의 `listWritingSources`로 거른다(없는 id는 버림, 5개까지). 남은 것이 없으면 `none_selected`
- `approveSelection(… readAs: question.selection)` → `writeText` → `saveDraft({ questionVersion, basedOn: approved, … }, { version, approved })`
- 다시 쓰기(이미 승인한 상태에서 같은 버튼)도 이 함수를 쓴다. 승인한 경험 중 하나라도 지금 목록에 없거나 버전이 다르면 `stale`이고 AI를 부르지 않는다(Review Focus 1). 화면은 "고른 경험이 바뀌었습니다. 경험 고르기를 다시 눌러 주세요"

**쓰기 AI에게 보내는 글**: `[문항]`, `[글자 수]` "500자 이내(공백 포함)"·"제한 없음", `[공고]`, `[경험 기록]` 승인한 경험마다 `describeSource(E1…, s, true)`(수치는 "수치: 글 (기준: …)", 하지 않은 것, 쓰면 안 되는 표현). `effort: "medium"`, `maxTokens: 16000`

**답의 모양 (zod)**: `{ paragraphs: { text: string, sources: string[] }[], shortage: string }`

**`WRITE_SYSTEM`에 담을 것**
- 주어진 경험 기록에 적힌 사실만으로 자기소개서 답을 쓴다. 기록에 없는 경험·수치·역할·성과를 더하지 않는다. 수치는 기록의 수치 칸과 본문에 적힌 것만
- "하지 않은 것"에 적힌 일을 한 것처럼 쓰지 않는다. "쓰면 안 되는 표현"은 비슷한 말로 바꿔서도 쓰지 않는다
- 문단마다 그 문단의 근거가 된 경험의 별명을 `sources`에 적는다. 근거 없는 문단(일반론, 다짐만 있는 문단)은 쓰지 않는다
- 글자 수 제한이 있으면 그 기준으로 80~100%를 채운다. 기록이 모자라 채울 수 없으면 짧게 쓰고 `shortage`에 무엇이 모자란지 적는다. 모자라지 않으면 `""`
- 연락처·회사 내부 기밀처럼 지원서에 넣지 않을 것은 쓰지 않는다

**`reviseParagraph`**: `note`는 다듬어 200자까지, `preset`도 `note`도 없으면 `empty_request`. `getQuestion`의 `draft`가 `expected`와 다르면 `changed`. 승인 경험이 `stale`이면 막는다. 보내는 글: 쓰기와 같은 칸 + `[지금 답]` 전체 + `[고칠 문단]` 그 문단 + `[요청]`(preset 문구 "더 짧게"/"더 구체적으로(기록에 있는 내용 안에서)"/"더 자연스럽게" + note). 답 `{ text, sources }`. 같은 코드 검사를 거쳐 그 문단만 바꾸고(`edited: false`) `replaceDraft(expected, next)`. 용도 `application_revise`, `effort: "low"`, `maxTokens: 8000`

**`editParagraph`**: 다듬은 `text`가 비면 그 문단을 지운다. 2000자를 넘으면 `too_long`. 바꾼 문단은 `edited: true`(sources는 남긴다). `replaceDraft(expected, next)`

**코드 검사** (`writeText`, 부분 수정 공통)
- 별명이 승인 경험에 없으면 버린다(같은 별명은 한 번). 문단 `text`를 다듬고 빈 문단은 버린다. 문단은 10개, 문단마다 2000자, `shortage`는 500자까지
- 숫자·금지 표현은 저장 뒤 `checkDraft`가 표시한다(저장은 막지 않는다)

- [ ] **Step 1: 실패하는 테스트를 쓴다**
  - "쓰기에는 승인한 경험만 가고, 승인하지 않은 경험·증빙 메모·실제 id가 없으며, 수치는 충족인 경험의 것만 간다"
  - "화면이 보낸 id 중 쓸 수 없는 경험(부분 확인, 남의 것)은 버리고, 남은 것이 없으면 none_selected이고 AI를 부르지 않는다"
  - "없는 별명의 근거는 버린다", "빈 문단은 버리고 문단은 10개까지"
  - 반목표 종합: 가짜 AI가 기록에 없는 숫자, 금지 표현, 근거 없는 문단을 쓴 답 → 저장된 답을 `checkDraft`로 보면 셋 다 표시된다
  - "승인한 경험을 고친 뒤 다시 쓰면 stale이고 AI를 부르지 않는다"(Review Focus 1), "트랙에서 요약만으로 바꿔도 stale"
  - "쓰는 사이 다시 고르면 changed이고 저장하지 않는다"(Review Focus 3)
  - "부분 수정은 그 문단만 바꾸고 다른 문단은 그대로", "부분 수정 중 다른 탭에서 직접 고치면 changed", "preset도 note도 없으면 empty_request"
  - "직접 고친 문단은 edited가 되고, 빈 글이면 지워진다"
  - "용도가 application_write·application_revise로 기록된다", "지원이 아닌 공고는 not_apply"
- [ ] **Step 2: 돌려서 실패를 본다** — `npx vitest run src/modules/applications/write.test.ts`
- [ ] **Step 3: 구현한다.** `local-ai.ts`의 가짜 답: 쓰기는 `E1`의 "본인이 한 일"과 "결과"로 두 문단(sources `["E1"]`), shortage `""`. 부분 수정은 고칠 문단 끝에 "(고침)"을 붙여 돌려준다
- [ ] **Step 4: 돌려서 통과를 본다**
- [ ] **Step 5: 커밋** — `feat: 승인한 경험만으로 자소서 답을 쓰고 문단을 고친다`

## Task 5: 화면

**Files:**
- Create: `src/modules/applications/actions.ts`, `src/app/(app)/postings/[id]/application/page.tsx`, `src/app/(app)/postings/[id]/application/add-questions.tsx`, `src/app/(app)/postings/[id]/application/question-card.tsx`
- Modify: `src/app/(app)/postings/[id]/page.tsx`(지원이면 `자소서 쓰기` 링크와 문항 수)

**Interfaces:**
- Consumes: Task 1~4 전부, `StartInterview`(`src/app/(app)/experiences/start-interview.tsx`)
- Produces (`actions.ts`, 모두 `requireUser()`로 얻은 id만 쓰고 끝나면 `/postings/[id]/application`을 다시 그린다. 결과는 `{ ok: true } | { ok: false; message: string }`):
  - `addQuestionsAction(postingId, raw: unknown[])`, `updateQuestionAction(id, raw)`, `deleteQuestionAction(id)`
  - `selectAction(id)`, `approveAndWriteAction(id, experienceIds: string[])`, `reviseAction(id, index, preset, note, expected: Draft)`, `editParagraphAction(id, index, text, expected: Draft)`
  - 문구: `not_apply` "지원으로 고른 공고에서만 쓸 수 있습니다", `changed` "그사이 내용이 바뀌었습니다. 화면을 새로 고친 뒤 다시 해 주세요", `stale` "고른 경험의 기록이 바뀌었습니다. 경험 고르기를 다시 눌러 주세요", `none_selected` "쓸 경험을 하나 이상 골라 주세요", `too_many` "문항은 공고마다 10개까지 넣을 수 있습니다", `empty_request` "고칠 방향을 골라 주세요", `too_long` "문단은 2000자까지 쓸 수 있습니다", AI 실패는 4-2의 `SCORE_MESSAGES`처럼 이 기능용 문구를 따로 둔다(한도: "이번 달 AI 사용 한도에 닿았습니다. 답을 직접 써서 저장할 수 있습니다")
  - `expected: Draft`는 브라우저가 보낸 값이므로 비교에만 쓰고 그대로 저장하지 않는다(저장은 서버가 읽은 `draft`에서 만든다)

**자소서 화면 (`/postings/[id]/application`)**
- 머리: 회사·직무, 공고로 돌아가기 링크. 지원이 아니면 "지원으로 고른 공고에서만 문항을 더하고 쓸 수 있습니다" 안내를 보이고 문항은 읽기만
- `문항 더하기`(`add-questions.tsx`): 큰 글상자 하나("문항을 붙여 넣으세요. 여러 개면 번호를 붙여 한 번에"), 붙여 넣으면 `splitQuestions`·`detectLimit`로 미리보기(문항마다 제한 칸, 고칠 수 있음), 기준 선택 `공백 포함`(기본) / `공백 제외` 하나로 전체에 적용, `더하기`
- 문항 카드(`question-card.tsx`), 위에서 아래로 한 흐름:
  1. 문항 글, "500자 · 공백 포함", `고치기`·`지우기`
  2. 고르기: `경험 고르기`(기다리는 표시). 결과가 있으면 고른 경험마다 체크(기본 켬), 이름(`/experiences/[id]` 링크), "겹치는 점" overlap, "본인 역할" role, 코드가 붙인 "확인된 수치 n개" 또는 "수치 없음", 다른 문항에 승인된 경험이면 "2번 문항에도 씀". 그 아래 `다른 후보` 접힘: whyNot과 체크(기본 끔). `noMatch`면 "이 문항에 맞는 확인된 기록이 없습니다"와 `StartInterview`(이 공고의 트랙). 승인한 경험이 지금과 달라졌으면 "고른 경험의 기록이 바뀌었습니다" 안내
  3. `이 경험으로 쓰기`(답이 있으면 `다시 쓰기`, 덮어쓴다는 확인 한 번)
  4. 답: 문단마다 글, 아래에 작은 근거 표시(경험 이름들, 직접 고친 문단은 "직접 수정"), 검사에 걸린 곳은 빨간 줄로 "쓰면 안 되는 표현: 주도", "기록에 없는 숫자: 40", "근거 경험이 없습니다", "근거 경험의 기록이 바뀌었습니다". 문단마다 `고치기`(그 자리에서 글상자, `저장`)와 `더 짧게`·`더 구체적으로`·`더 자연스럽게`·`요청 적기`(짧은 칸)
  5. 아래: 글자 수 "512 / 500자 (공백 포함)"(넘으면 빨강), `shortage`가 있으면 "기록이 모자란 점: …", `questionChanged`면 "문항을 고친 뒤 쓴 답입니다. 다시 쓰기를 권합니다", `복사`(답 전체를 클립보드로)
- 검사(`checkDraft`)와 겹침 표시는 서버 컴포넌트가 그릴 때 지금의 `listWritingSources`로 계산해 카드에 넘긴다

**공고 화면**: 지원 판단이 지원이면 점수 칸 아래에 `자소서 쓰기`(문항이 있으면 "자소서 쓰기 · 문항 3개")

- [ ] **Step 1: 화면을 만든다.** 액션의 결과를 받는 쪽은 4-2의 `score-section.tsx`처럼 `useTransition`으로 기다리는 표시를 둔다
- [ ] **Step 2: `npx tsc --noEmit`, `npm run lint`가 통과한다**
- [ ] **Step 3: 로컬 미리보기로 확인한다** — 트랙과 확인된 경험 둘(하나는 수치 충족)을 만들고 공고 넣기 → 점수 보기 → 지원 → 자소서 쓰기 → 두 문항을 한 번에 붙여 넣기 → 경험 고르기 → 이 경험으로 쓰기 → 문단 직접 고치기·더 짧게 → 경험을 고친 뒤 화면의 "근거 경험의 기록이 바뀌었습니다". 자소서 화면을 사진으로 찍어(`deviceScaleFactor: 2`) 사용자에게 보낸다
- [ ] **Step 4: 커밋** — `feat: 공고별 자소서 화면에서 문항을 넣고 경험을 골라 답을 쓰고 고친다`

## Task 6: 프롬프트 점검

**Files:**
- Create: `src/modules/applications/prompt-check.ts`, `src/modules/applications/prompt-check.test.ts`
- Modify: `src/modules/experiences/actions.ts`(`runPromptCheckAction`에 `runApplicationCheck`를 더한다)

**Interfaces:**
- Consumes: Task 3의 `selectText`, Task 4의 `writeText`, Task 2의 `checkDraft`
- Produces: `runApplicationCheck(db, ai, userId, now?): Promise<CheckRow[]>`(행 모양은 `experiences/prompt-check`의 `CheckRow`). 관리 화면의 점검 AI 호출이 2번 는다

예시: 문항 "지원 동기와 직무 역량을 경험을 들어 적어 주세요 (500자 이내)", 공고는 `postings/prompt-check`의 `FULL_POSTING`. 경험 ① Kotlin으로 주문 조회 API를 고친 재직 경험(수치 "응답 시간 1.2초 → 0.4초", 기준 "APM 주간 평균", 하지 않은 것 "팀장 역할, 인프라 설계는 하지 않음", 쓰면 안 되는 표현 `["주도", "총괄"]`), ② 카페 바리스타 아르바이트

점검 줄:
- 고르기: "①을 고른다", "②를 고르지 않는다", "추천 근거에 기록에 없는 숫자가 없다"
- 쓰기(①만 승인): "쓰면 안 되는 표현이 없다", "기록에 없는 숫자가 없다", "모든 문단에 근거가 있다", "500자(공백 포함)를 넘지 않는다", "②의 내용(바리스타·카페)을 쓰지 않는다", "인프라 설계를 했다고 쓰지 않는다"(문단에 "인프라 설계"가 들어 있으면 실패)

- [ ] **Step 1: 실패하는 테스트를 쓴다** — 가짜 AI로 맞는 답이면 모든 줄 통과, "주도"를 쓴 답이면 그 줄만 실패, ②를 고른 답이면 그 줄만 실패
- [ ] **Step 2: 돌려서 실패를 본다** — `npx vitest run src/modules/applications/prompt-check.test.ts`
- [ ] **Step 3: 구현한다**
- [ ] **Step 4: 돌려서 통과를 본다**
- [ ] **Step 5: 커밋** — `feat: 프롬프트 점검에 자소서 고르기·쓰기 예시를 더한다`

## Task 7: 확인

- [ ] `npx tsc --noEmit`, `npm run lint`, `npm test`, `npm run build` 모두 통과
- [ ] 이 문서 끝 "구현하면서 달라진 점"을 적는다
- [ ] `/ship`으로 올린다. `drizzle/**`, `schema.ts`, `src/modules/ai/**`, `src/dev/**`를 바꾸므로 합치기는 사용자에게 묻는다(판단표 ②)
- [ ] 합친 뒤 사용자에게 부탁: 실제로 지원한 공고 하나에 문항을 넣어 고르기 근거가 억지스럽지 않은지, 답에 기록에 없는 내용이 없는지 본다. 관리 → AI 프롬프트 점검을 한 번 돌린다

## 하지 않는 것 (5-1)

- 이력서 공통본·맞춤본(5-2), 제출본 얼리기와 새 버전(5-3)
- 워드·PDF 내려받기(6). 이번에는 답 전체 복사만
- "요약만" 경험을 자소서에 직접 올리기(설계의 "맞춤본에서 직접 올리기"는 5-2 이력서 맞춤본에서 다룬다)
- 문항 순서 바꾸기, 문항 묶음을 다른 공고로 복사하기
- 경험이 바뀌었을 때 고르기·쓰기를 자동으로 다시 하기(표시만 하고 사용자가 다시 누른다)

## 구현하면서 달라진 점

## 판단표 점검
