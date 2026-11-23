# Job Hunter 5-5번 계획: 공고 서류와 자유양식 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 공고를 읽을 때 제출 서류와 자소서 문항을 함께 뽑아, 지원하면 문항을 채우고 고른 서류마다 작성으로 잇는다. 문항이 없는 회사는 자유양식 항목을 체크해 쓴다. 문항마다 유형(경험형·동기포부형·자기소개형)을 붙이고, 동기·포부·성장과정처럼 기록에 없는 재료는 쓰기 전에 AI가 고를 수 있는 질문으로 짧게 묻고, 고른 답만 근거로 쓴다.

**Architecture:** `postings_postings`에 찾은 서류·찾은 문항·고른 서류 칸을 더하고, 공고 값 뽑기(`extractPosting`)가 같은 AI 호출에서 서류와 문항을 함께 뽑는다. `applications_questions`에 유형·주제·자유양식 항목·질문·붙인 답 칸을 더하고, 지원자의 답은 새 표 `applications_answers` 하나에 둔다. 쓰기·부분 수정·검사·제출본은 경험 근거(E1…) 옆에 답 근거(A1…)를 함께 다룬다.

**Tech Stack:** Next.js 16(App Router), Drizzle + Postgres(테스트는 PGlite), zod, Vitest

**Spec:** `docs/superpowers/specs/2026-11-20-records-and-documents-design.md`의 5.3, 5.4, 5.5, 5.6, 6(공고 칸·문항 칸·묻기의 답 표·`AiPurpose`), 7, 9장 2번

## 정한 것 (설계가 빌더에게 맡긴 것)

- **서류 종류**(`postings/options.ts`): `resume` 이력서 / `cover_letter` 자기소개서 / `career` 경력기술서 / `portfolio` 포트폴리오 / `other` 기타. 누가 쓰는지는 `DOCUMENT_WRITER` 한 곳에 둔다(`ai`: 이력서·자기소개서·경력기술서, `self`: 포트폴리오·기타). 경력기술서는 5-7 전까지 작성 화면이 없어 "준비 중"으로 보인다
- **공고 칸 셋**: `found_documents`(찾은 서류, null = 아직 읽지 않음), `found_questions`(찾은 문항), `chosen_documents`(사용자가 고른 서류, null = 기본값). 기본값은 찾은 서류의 종류, 찾은 것이 없으면 이력서·자기소개서(`chosenDocuments()`)
- **찾은 문항의 거짓 방지**: 공백을 뺀 원문에 공백을 뺀 문항 글이 그대로 들어 있지 않으면 버린다(AI가 지어낸 문항을 막는다). 글자 수 제한이 50~10,000이 아니면 비운다
- **공고 저장 때**: 화면이 뽑기 결과를 들고 있다가 새 공고를 저장할 때 함께 보낸다. 서버는 같은 검사(`cleanFound`)를 저장할 원문으로 다시 한다. 공고를 고쳐도 찾은 값은 그대로 두고, `다시 읽기`로만 다시 뽑는다
- **문항 채우기**: 지원으로 정할 때와 `다시 읽기` 뒤(지원 공고일 때) 문항이 하나도 없으면 찾은 문항을 넣는다. "문항이 없는지"는 공고 잠금 안에서 본다(두 탭에서 눌러도 한 번만)
- **고른 서류를 따르는 곳**: 공고 화면의 작성 링크, 제출 전 확인 창(고르지 않은 서류는 "없습니다"를 말하지 않음), 제출본(고르지 않은 이력서·자소서는 얼리지 않음). 서류 고르기는 지원 공고에서, 제출로 잠기지 않았을 때만
- **자유양식 항목**(설계 5.4의 8개, 이 순서): 성장과정·성격의 장단점·가치관·생활신조는 자기소개형, 지원동기·입사 후 포부는 동기포부형, 직무 역량·경험·협업 경험·어려움을 극복한 경험은 경험형. 기본 체크는 지원동기·직무 역량·경험·입사 후 포부, 항목당 글자 수 기본 800. 직접 추가한 항목은 유형을 비워 두고 고르기 때 AI가 정한다. 공고에서 찾은 문항이 없다고 읽힌 공고는 자유양식이 먼저 열린다
- **유형과 주제**: 유형(`kinds`)은 여러 개일 수 있다. 답의 주제(`topics`)는 지원동기·입사 후 포부·성장과정·성격의 장단점·가치관·기타. 붙여 넣은 문항은 고르기 AI가 유형과 주제를 함께 정하고, 이미 정해진 문항은 덮어쓰지 않는다. 사용자가 유형을 바꾸면 주제는 `topicsFor()`로 맞춘다. 문항 글을 고치면 유형·주제·질문을 비운다(다음 고르기 때 다시 정함). 후보 경험이 없어도 유형을 모르면 고르기 AI를 부른다
- **묻기는 내 기록과 대조해서 묻는다**(「결정」 2026-11-23, 사용자): 흐름은 공고 끌어오기 → 내 기록과 대조 → 쓸 내용 추리기 → 초안. 질문을 만들 때 AI는 공고와 내 확인된 기록(그 트랙에서 쓸 수 있는 사례, 확인된 학력의 학교·전공, 교육 과정, 자격)을 맞대서 연결고리(예: 공고의 "사내 업무 시스템 개발" ↔ 내 교육 "ERP 개발 과정")를 찾고, 연결고리마다 내 생각을 묻는다("그 교육이 이 직무를 고른 이유와 이어지나요?"). 연결고리가 없으면 공고만 보고 묻는다. 자소서에는 증빙되는 사실을 늘어놓지 않고 경험과 생각을 담는다는 원칙에 따라, **이력 사실은 질문 거리로만 쓰고 글의 재료로는 쓰지 않는다**(설계 5.5의 "이력 사실은 근거로 고르지 않는다"는 그대로). 교육 이름은 내 답의 질문 글에 남아 이야기의 출발점으로 한 줄 쓰일 수 있다
- **묻기의 모양**: 질문은 2~3개, 선택지는 3~5개(설계 범위 안). 선택지는 AI가 만든 후보이고 여러 개 고를 수 있으며 `기타` 한 줄을 덧붙일 수 있다. 저장하는 답 글은 서버가 저장해 둔 질문에서 고른 선택지 글을 꺼내 만든다(브라우저가 보낸 글을 쓰지 않는다). AI에는 연락처·이메일·이름을 보내지 않는다. AI 한도에 닿아도 쓸 수 있게 주제마다 `직접 적기`를 둔다
- **답 표**: `applications_answers`(새 표 하나, 「결정」 2026-11-23 사용자 승인). 답은 고치지 않는다: 새로 고르거나 `직접 적기`를 하면 새 답을 만들고, 문항에는 답 id를 붙인다(`answer_ids`). 그래서 답의 버전을 따로 두지 않는다
- **지난 답은 선택지 하나로만**(「결정」 2026-11-23, 사용자): 지난 답이 있어도 질문을 건너뛰지 않는다. 그 사이 더 쓰기 좋은 경험이 생겼을 수 있으므로 늘 지금의 기록과 새로 대조해 질문을 만들고, 같은 주제의 지난 답(주제마다 최근 2개)을 그 질문의 선택지 끝에 "지난번 답 (회사 · YYYY-MM)"으로 붙인다. 지난 답을 고르면 그 답을 그대로 붙이고(새 행을 만들지 않음), 새 선택지·기타를 고르면 새 답을 만든다. 둘 다 고를 수 있다. AI가 그 주제의 질문을 만들지 않았으면 코드가 "지난번 답을 다시 쓸까요?" 질문을 더해 지난 답만 보인다
- **회사에 묶인 답**: 주제가 지원동기·입사 후 포부인 답은 그 공고의 회사 이름 정리 값(`companyKey`)을 담고, 같은 값의 공고에서만 지난 답 선택지로 붙는다. 다른 주제(성장과정·성격의 장단점·가치관·기타)는 어느 공고에서나 붙는다. 정리 규칙: 유니코드 NFKC, 소문자, `(주)`·`㈜`·`주식회사`·`(유)`·`유한회사` 빼기, 공백·괄호 빼기. 5-6 회사 조사가 같은 함수를 쓴다
- **답 없이 쓰지 않음**: 유형에 동기포부형이나 자기소개형이 있는데 붙인 답이 없으면 쓰기는 `need_answers`로 막고 AI를 부르지 않는다(반목표: 답하지 않은 동기를 지어 쓰기). 유형이 동기포부형·자기소개형뿐이면 고르기 없이, 근거 장면 없이 답만으로 쓸 수 있다
- **근거 표시**: 문단의 `answers`(답 id)는 "내 답: (주제)"로 보이고, 근거 없음 검사에서 근거로 친다. 답 글의 숫자는 그 문단의 숫자 검사에서 허용한다. 공고 글의 숫자는 이번에도 허용하지 않는다(회사 정보의 숫자는 5-6에서 정함). 제출본에는 답 근거를 경험 근거 목록에 "내 답: (주제)" 이름으로 얼린다
- **이력 사실은 쓰기에 보내지 않는다**(설계 5.5가 맡긴 것): 이번에는 학력·자격을 쓰기 단계에도 보내지 않는다. "전공을 살려" 같은 말이 필요하면 사용자가 답(묻기)으로 적는다
- **항목마다 글자 수**: 넣을 때는 항목당 글자 수 하나로 넣고, 넣은 뒤 문항 카드의 `고치기`로 항목마다 바꾼다
- **AI 목적**: `application_ask`(묻기 질문 만들기)만 더한다. 서류·문항 뽑기는 `posting`, 유형 정하기는 `application_select`에 함께 든다
- **경험형 문항의 `AI 인터뷰로 추가`**: 지금처럼 장면 인터뷰(경험 사례 추가)로 간다. 유형이 동기포부형·자기소개형뿐인 문항에서는 "확인된 기록이 없습니다"를 보이지 않고 묻기 구역을 보인다

## Global Constraints

- `CLAUDE.md`, `docs/conventions.md`의 데이터 접근 규칙과 AI 사용 규칙, 앞 계획들의 Global Constraints를 따른다: AI 호출은 `runAi()`, 모델 `claude-sonnet-5-5`, 연락처는 AI에 보내지 않음, 테이블 이름은 `<모듈>_<이름>`
- 새 표는 `user_id`가 `auth_user(id)`를 `on delete cascade`로 참조하고, repo 함수의 첫 두 인자는 `(db, userId)`, 모든 쿼리에 `userId` 조건, "다른 사용자의 것은 읽히지 않는다" 테스트를 둔다
- AI가 돌려준 값은 코드가 검사한 뒤에만 저장한다(목록 밖 값·지어낸 문항·넘친 개수는 버림). 시간이 걸리는 AI 작업은 읽었을 때의 공고 원문·문항 version·승인·답 그대로일 때만 저장한다
- 반목표: 지원자가 답하지 않은 동기·포부·가치관을 쓰지 않는다. 이력 사실은 어느 유형의 근거로도 고르지 않는다(5-4의 거르기 그대로). 공고에 없는 문항을 채우지 않는다
- 제출로 잠긴 공고에서는 문항·유형·답·서류 고르기를 바꾸지 않는다(`withEditLock`)
- 화면을 바꾸면 `LOCAL_PREVIEW=1`로 로컬 미리보기를 띄워 확인하고 사진을 사용자에게 보낸다
- 새 AI 작업과 바뀐 지시문마다 프롬프트 점검(`prompt-check`)에 예시를 더한다
- 판단표 ②: 모든 PR이 `schema.ts`·`drizzle/**`·`src/modules/ai/**`·`src/dev/**` 중 하나를 바꾸므로 합치기 전에 사용자에게 묻는다

## Review Focus

1. AI가 공고에 없는 문항을 지어내거나 문항을 다듬어 옮긴다 → 원문에서 찾지 못한 문항은 버려지고 자소서에 채워지지 않는다 (Task 1 테스트 "원문에 없는 문항은 버린다")
2. 지원을 두 탭에서 누르거나, 관심으로 되돌렸다가 다시 지원한다 → 문항이 두 번 채워지지 않고, 이미 문항이 있으면 덮지 않는다 (Task 2 테스트 "onlyIfEmpty는 잠금 안에서 본다")
3. 지원동기 문항에서 답 없이 `쓰기`를 누른다(또는 고르기가 동기포부형으로 정했다) → AI를 부르지 않고 "먼저 위 질문에 답해 주세요" (Task 6 테스트 "need_answers")
4. 회사 A에서 쓴 지원동기가 회사 B 공고에서 지난 답 선택지로 붙는다 → 이름 정리 값이 같은 회사에서만 보인다. "(주)가나다"와 "가나다 주식회사"는 같고 "가나다랩"은 다르다 (Task 1 `companyKey` 테스트, Task 5 테스트)
5. 질문을 받은 뒤 문항 글을 고치거나 다른 탭에서 답을 저장한다 / 화면이 선택지 글을 바꿔 보낸다 → 옛 질문으로 저장하지 않고 `changed`, 답 글은 서버가 저장한 질문의 선택지에서만 만든다 (Task 5 테스트)

---

# PR 1: 공고의 제출 서류와 문항

## Task 1: 공고 칸, 서류·문항 뽑기, 회사 이름 정리

**Files:**
- Modify: `src/modules/postings/schema.ts`, `src/modules/postings/options.ts`, `src/modules/postings/extract.ts`, `src/modules/postings/extract.test.ts`, `src/modules/postings/prompts.ts`, `src/modules/postings/prompt-check.ts`, `src/modules/postings/prompt-check.test.ts`, `src/modules/postings/repo.ts`, `src/modules/postings/repo.test.ts`, `src/dev/local-ai.ts`(posting 가짜 답에 `documents: []`, `questions: []`)
- Create: `src/modules/postings/documents.ts`, `src/modules/postings/documents.test.ts`, `src/modules/postings/company.ts`, `src/modules/postings/company.test.ts`, `drizzle/0019_*.sql`(`npm run db:generate`)

**Interfaces:**
- Produces (`options.ts`):
  ```ts
  export const DOCUMENT_KINDS = ["resume", "cover_letter", "career", "portfolio", "other"] as const;
  export type DocumentKind = (typeof DOCUMENT_KINDS)[number];
  export const DOCUMENT_LABELS: Record<DocumentKind, string>; // 이력서/자기소개서/경력기술서/포트폴리오/기타
  // 서류마다 누가 쓰나. 포트폴리오를 AI가 쓰게 바꿀 때 여기와 작성 화면만 더한다
  export const DOCUMENT_WRITER: Record<DocumentKind, "ai" | "self">;
  export const DEFAULT_DOCUMENTS: DocumentKind[] = ["resume", "cover_letter"];
  // POSTING_LIMITS에 더함: documents: 10, documentLabel: 100, questions: 10, questionPrompt: 1000, charLimitMin: 50, charLimitMax: 10000
  // (questions·questionPrompt·charLimit*는 APPLICATION_LIMITS와 같은 값. applications가 postings를 읽으므로 거꾸로 가져오지 않는다)
  ```
- Produces (`documents.ts`, 순수 함수):
  ```ts
  export type FoundDocument = { kind: DocumentKind; label: string }; // label은 공고에 적힌 이름
  export type FoundQuestion = { prompt: string; charLimit: number | null; countSpaces: boolean };
  export type Found = { documents: FoundDocument[]; questions: FoundQuestion[] };
  // AI 답이나 브라우저가 보낸 값을 검사한다. 목록 밖 종류·빈 글·같은 (종류, 이름)은 버리고 한도로 자른다.
  // 문항은 공백을 뺀 rawText에 공백을 뺀 문항 글이 들어 있을 때만 남긴다. charLimit이 50~10000 밖이면 null, countSpaces가 boolean이 아니면 true
  export function cleanFound(raw: unknown, rawText: string): Found;
  export function chosenDocuments(p: { foundDocuments: FoundDocument[] | null; chosenDocuments: DocumentKind[] | null }): DocumentKind[]; // DOCUMENT_KINDS 순서
  ```
- Produces (`company.ts`): `export function companyKey(name: string): string;`
- Produces (`schema.ts`): `found_documents jsonb FoundDocument[] null`, `found_questions jsonb FoundQuestion[] null`, `chosen_documents jsonb DocumentKind[] null`
- Produces (`extract.ts`): `ExtractedPosting`에 `documents: FoundDocument[]; questions: FoundQuestion[]`. 스키마에 `documents: z.array(z.object({ kind: z.enum(DOCUMENT_KINDS), label: z.string() }))`, `questions: z.array(z.object({ prompt: z.string(), charLimit: z.number(), countSpaces: z.boolean().nullable() }))`(charLimit은 없으면 -1). `maxTokens` 2000 → 6000. 결과는 `cleanFound(raw, rawText)`를 거친다
- Produces (`repo.ts`):
  ```ts
  // Posting에 foundDocuments, foundQuestions, chosenDocuments가 더해진다(toPosting이 그대로 넘김)
  export async function createPosting(db, userId, trackId, input: PostingInput, found?: Found): Promise<...같음>;
  // 다시 읽기 결과를 저장한다. 원문이 readAs.rawText 그대로일 때만(아니면 changed)
  export async function saveFound(db, userId, id, found: Found, readAs: { rawText: string }): Promise<{ ok: true } | { ok: false; reason: "not_found" | "changed" }>;
  export async function setChosenDocuments(db, userId, id, kinds: DocumentKind[]): Promise<{ ok: true } | { ok: false; reason: "not_found" }>; // 목록 밖 값은 버리고 중복 없이 DOCUMENT_KINDS 순서로
  ```
- POSTING_SYSTEM에 더할 항목(뜻): `documents` — 공고가 내라고 적은 서류만, 종류와 공고에 적힌 이름. 적혀 있지 않으면 빈 배열(짐작해서 이력서·자소서를 넣지 않음). "자유 양식"·"이력서 내 자기소개" 같은 표기는 그 서류로 본다. 증명서·졸업증명서 같은 제출 증빙은 `other`. `questions` — 공고에 자기소개서 문항이 적혀 있으면 문항마다 글을 원문 그대로(앞의 번호 표시만 빼고), 글자 수 제한(없으면 -1), 공백 포함이면 true·제외면 false·적혀 있지 않으면 null. 문항이 없으면 빈 배열. 문항을 다듬거나 합치거나 지어내지 않는다(원문에서 찾지 못한 문항은 코드가 버린다)

- [ ] **Step 1: 실패하는 테스트를 쓴다**
  - `documents.test.ts`: "목록 밖 종류와 빈 이름은 버린다", "같은 종류·이름은 한 번만", "원문에 없는 문항은 버린다"(`cleanFound({ documents: [], questions: [{ prompt: "지원 동기를 쓰시오", charLimit: 500, countSpaces: true }] }, "자기소개서: 성장 과정을 쓰시오")` → `questions: []`), "띄어쓰기가 달라도 원문에 있으면 남긴다", "charLimit -1·30·20000은 null", "countSpaces null은 true", "문항 11개째부터 버린다", "객체가 아니면 빈 값", `chosenDocuments`: "고른 것이 있으면 그것", "고른 것이 없으면 찾은 서류의 종류(중복 없이)", "둘 다 없으면 이력서·자기소개서", "찾았지만 빈 배열이면 이력서·자기소개서"
  - `company.test.ts`: `companyKey("(주)가나다") === companyKey("가나다 주식회사") === companyKey("㈜ 가나다")`, `companyKey("가나다랩") !== companyKey("가나다")`, `companyKey("ABC Corp") === companyKey("abc corp")`, `companyKey("가나다(유)") === companyKey("가나다")`
  - `extract.test.ts`: 기존 가짜 답에 `documents`, `questions`를 더하고 "서류와 문항을 정리해 돌려준다", "원문에 없는 문항은 버린다"
  - `repo.test.ts`: "새 공고에 찾은 값을 함께 저장한다", "찾은 값 없이 만들면 셋 다 null", "공고를 고쳐도 찾은 값과 고른 서류는 그대로", "saveFound는 원문이 바뀌었으면 changed", "setChosenDocuments는 목록 밖 값을 버리고 순서를 맞춘다", "다른 사용자의 공고에는 saveFound·setChosenDocuments가 not_found"
  - `prompt-check.test.ts`: 새 예시의 행이 가짜 AI 답으로 통과·실패하는지(기존 테스트 방식)
- [ ] **Step 2: 돌려서 실패를 본다** — `npx vitest run src/modules/postings`
- [ ] **Step 3: 구현한다.** 스키마를 고친 뒤 `npm run db:generate`로 `0019` 마이그레이션을 만든다. 프롬프트 점검에 예시 `DOCS_POSTING`(제출 서류: 이력서, 자기소개서, 포트폴리오(선택) / 자기소개서 항목: 1. 지원 동기 (500자 이내) 2. 입사 후 포부 (공백 제외 300자))을 더하고(호출 1번), 행: 서류 종류에 이력서·자기소개서·포트폴리오, 문항 2개, 제한 500·300, 둘째 문항 공백 제외. 기존 예시에 행 더하기: `FULL_POSTING`은 서류·문항이 빈 배열(지어내지 않음), `SPARSE_POSTING`은 서류가 이력서·포트폴리오
- [ ] **Step 4: 돌려서 통과를 본다** — 같은 명령, PASS. `npx tsc --noEmit`
- [ ] **Step 5: 커밋** — `feat: 공고에서 제출 서류와 자소서 문항을 함께 뽑아 공고에 둔다`

## Task 2: 제출 서류 화면, 다시 읽기, 지원 때 문항 채우기

**Files:**
- Modify: `src/modules/postings/actions.ts`(`savePostingAction`의 `options.found`, 지원 뒤 문항 채우기), `src/app/(app)/postings/posting-form.tsx`, `src/app/(app)/postings/[id]/page.tsx`, `src/modules/applications/repo.ts`, `src/modules/applications/repo.test.ts`, `src/modules/applications/submit.ts`, `src/modules/applications/submit.test.ts`
- Create: `src/modules/postings/reread.ts`, `src/modules/postings/reread.test.ts`, `src/modules/applications/documents.ts`, `src/modules/applications/documents.test.ts`, `src/modules/applications/document-actions.ts`, `src/app/(app)/postings/[id]/documents-section.tsx`

**Interfaces:**
- Consumes: Task 1의 `cleanFound`, `chosenDocuments`, `saveFound`, `setChosenDocuments`, `extractPosting`
- Produces (`postings/reread.ts`): `export async function rereadPosting(db, ai, userId, id, today: string, now?): Promise<{ ok: true; found: Found } | { ok: false; reason: "not_found" | "changed" | "over_limit" | AiFailure }>` — 원문으로 `extractPosting`을 부르고 서류·문항만 `saveFound`로 저장한다(다른 값은 건드리지 않음)
- Produces (`applications/repo.ts`): `addQuestions(db, userId, postingId, inputs, options?: { onlyIfEmpty?: boolean })` — `onlyIfEmpty`면 잠금 안에서 그 공고의 문항 수가 0일 때만 넣고, 아니면 `{ ok: true, ids: [] }`
- Produces (`applications/documents.ts`):
  ```ts
  // 지원 공고이고 찾은 문항이 있고 문항이 하나도 없을 때만 넣는다. 아니면 added 0
  export async function seedQuestionsFromPosting(db, userId, postingId): Promise<{ ok: true; added: number } | { ok: false; reason: "not_found" | "submitted" | "too_many" }>;
  // 잠금 안에서 editBlock을 확인하고 setChosenDocuments
  export async function chooseDocuments(db, userId, postingId, kinds: DocumentKind[]): Promise<{ ok: true } | { ok: false; reason: "not_found" | "not_apply" | "submitted" }>;
  ```
- Produces (`document-actions.ts`, `"use server"`): `rereadPostingAction(id)`(다시 읽은 뒤 `seedQuestionsFromPosting`), `chooseDocumentsAction(id, kinds: unknown)`. 결과 `{ ok: true } | { ok: false; message }`, 문구는 기존 `AI_MESSAGES`·`MESSAGES`와 같은 말투
- `applyToPostingAction`: 지원으로 정한 뒤 `seedQuestionsFromPosting`을 부른다(실패해도 지원은 성공으로 돌려준다)
- `submit.ts`: `submitPreview`는 고른 서류에 자기소개서가 없으면 문항 경고를, 이력서가 없으면 이력서 경고를 하지 않는다. `submitPosting`은 고르지 않은 서류를 얼리지 않는다(이력서 → `resume: null`, 자기소개서 → `answers: []`)
- 화면
  - 공고 넣기 확인 단계: "제출 서류: 이력서, 자기소개서 · 자소서 문항 2개를 찾았습니다"(또는 "공고에 제출 서류가 적혀 있지 않습니다") 한 줄. 새 공고 저장 때 `options.found`로 보낸다
  - 공고 화면의 `제출 서류` 구역(`documents-section.tsx`): 지원 공고면 종류마다 체크(기타는 찾은 기타가 있을 때만, 공고의 이름으로), 고른 AI 서류마다 링크(자기소개서 → `자소서 쓰기 · 문항 n개`, 이력서 → `이력서 맞춤본`, 경력기술서 → "준비 중"), 직접 준비 서류는 "포트폴리오 · 직접 준비". 찾은 값이 null이면 "아직 공고에서 서류를 읽지 않았습니다", 찾았지만 비었으면 "공고에 적힌 서류가 없어 이력서·자기소개서를 골랐습니다". `다시 읽기` 버튼(확인 창 "AI로 공고를 다시 읽습니다"). 잠기면 체크를 끄고 링크는 `보기`. 지원이 아닌 공고는 찾은 서류만 읽기로 보이고 지금의 `자소서 보기`·`맞춤본 보기` 링크는 그대로
  - 지금 지원 공고의 링크 두 개(`자소서 쓰기`, `이력서 맞춤본`)는 이 구역으로 옮긴다

- [ ] **Step 1: 실패하는 테스트를 쓴다**
  - `reread.test.ts`: "서류와 문항만 저장하고 회사·마감은 그대로", "AI가 답하는 사이 원문을 고쳤으면 changed", "남의 공고는 not_found"
  - `repo.test.ts`(applications): "onlyIfEmpty는 문항이 있으면 넣지 않는다", "onlyIfEmpty 두 번을 동시에 불러도 한 번만 들어간다"(`Promise.all`)
  - `documents.test.ts`: "지원 공고에 찾은 문항을 넣는다(글자 수·기준까지)", "관심 공고에는 넣지 않는다", "문항이 이미 있으면 넣지 않는다", "찾은 문항이 없으면 added 0", "제출로 잠긴 공고는 submitted", "chooseDocuments는 지원이 아니면 not_apply, 잠겼으면 submitted"
  - `submit.test.ts`: "자기소개서를 고르지 않으면 문항 경고가 없고 제출본의 answers가 빈 배열", "이력서를 고르지 않으면 이력서 경고가 없고 resume이 null", "고른 서류가 기본값이면 지금과 같다"
- [ ] **Step 2: 돌려서 실패를 본다** — `npx vitest run src/modules/postings/reread.test.ts src/modules/applications/repo.test.ts src/modules/applications/documents.test.ts src/modules/applications/submit.test.ts`
- [ ] **Step 3: 구현한다.** 화면은 `node_modules/next/dist/docs/`의 서버 액션 문서를 먼저 읽고 기존 `posting-actions.tsx`의 버튼 방식을 따른다
- [ ] **Step 4: 돌려서 통과를 보고 화면을 확인한다** — 같은 명령 PASS, `npx tsc --noEmit`, `npm run lint`. `LOCAL_PREVIEW=1`로 공고 넣기 → 지원 → 공고 화면의 제출 서류 구역 사진(휴대폰 폭 포함)을 사용자에게 보낸다
- [ ] **Step 5: 커밋** — `feat: 공고 화면에 제출 서류를 고르고 다시 읽으며, 지원하면 공고의 문항을 채운다`

---

# PR 2: 자유양식과 문항 유형

## Task 3: 문항 유형 칸과 자유양식 더하기

**Files:**
- Modify: `src/modules/applications/schema.ts`, `src/modules/applications/options.ts`, `src/modules/applications/repo.ts`, `src/modules/applications/repo.test.ts`, `src/modules/applications/actions.ts`, `src/app/(app)/postings/[id]/application/add-questions.tsx`, `src/app/(app)/postings/[id]/application/page.tsx`
- Create: `src/modules/applications/kinds.ts`, `src/modules/applications/kinds.test.ts`, `src/app/(app)/postings/[id]/application/freeform-picker.tsx`, `drizzle/0020_*.sql`

**Interfaces:**
- Produces (`options.ts`):
  ```ts
  export const QUESTION_KINDS = ["experience", "motive", "self"] as const; // 경험형/동기포부형/자기소개형
  export type QuestionKind = (typeof QUESTION_KINDS)[number];
  export const QUESTION_KIND_LABELS: Record<QuestionKind, string>;
  export const ANSWER_TOPICS = ["motive", "aspiration", "growth", "personality", "values", "other"] as const;
  export type AnswerTopic = (typeof ANSWER_TOPICS)[number];
  export const ANSWER_TOPIC_LABELS: Record<AnswerTopic, string>; // 지원동기/입사 후 포부/성장과정/성격의 장단점/가치관/기타
  export const TOPIC_KIND: Record<AnswerTopic, Exclude<QuestionKind, "experience">>; // motive·aspiration → motive, 나머지 → self
  export const COMPANY_TOPICS: readonly AnswerTopic[] = ["motive", "aspiration"];
  export const FREEFORM_ITEMS: readonly { id: string; label: string; kinds: QuestionKind[]; topics: AnswerTopic[] }[];
  // id: growth, personality, motive, competence, aspiration, values, teamwork, hardship (설계 5.4 순서)
  export const FREEFORM_DEFAULT = ["motive", "competence", "aspiration"];
  export const FREEFORM_CHAR_LIMIT = 800;
  // APPLICATION_LIMITS에 더함: customItem: 100
  ```
- Produces (`schema.ts`, `applications_questions`에 칸): `kinds jsonb QuestionKind[] null`, `topics jsonb AnswerTopic[] null`, `freeform_item text null`
- Produces (`kinds.ts`, 순수 함수):
  ```ts
  // 켜진 유형에 맞는 주제만 남기고, 주제가 하나도 없는 유형(경험형 제외)에는 기본 주제(motive → "motive", self → "other")를 더한다
  export function topicsFor(kinds: QuestionKind[], previous: AnswerTopic[]): AnswerTopic[];
  export function needsAnswers(kinds: QuestionKind[] | null): boolean; // motive나 self가 있으면 true
  export function freeformQuestions(itemIds: string[], custom: string[], charLimit: number): { ok: true; value: NewQuestion[] } | { ok: false; message: string };
  ```
  (`NewQuestion`은 `repo.ts`에서 `import type`으로 가져온다. `repo.ts`가 `kinds.ts`의 `topicsFor`를 쓰므로 값 가져오기를 서로 하지 않는다)
- Produces (`repo.ts`):
  ```ts
  export type QuestionMeta = { kinds: QuestionKind[] | null; topics: AnswerTopic[] | null; freeformItem: string | null };
  export type NewQuestion = QuestionInput & Partial<QuestionMeta>;
  // Question에 QuestionMeta가 더해진다. addQuestions는 NewQuestion[]을 받는다
  export async function setQuestionKinds(db, userId, id, kinds: QuestionKind[]): Promise<{ ok: true } | { ok: false; reason: "not_found" | "not_apply" | "submitted" | "empty" }>; // topics = topicsFor(kinds, 지금 topics)
  ```
  - `updateQuestion`: 문항 글이 바뀌면 `kinds`, `topics`도 null로(지금 selection을 지우는 자리에서)
- Produces (`actions.ts`): `addFreeformAction(postingId, raw: { items: unknown; custom: unknown; charLimit: unknown })`, `setQuestionKindsAction(id, kinds: unknown)`
- 화면: `문항 더하기` 구역 위에 `( ) 문항 붙여 넣기 (•) 자유양식` 고르기. 자유양식은 항목 체크(이미 넣은 항목은 끄고 "넣음"), `+ 항목 직접 추가`(한 줄, 100자), `항목당 글자 수 [800]`, `n개 넣기`. 공고의 찾은 문항이 `[]`(읽었는데 없음)이면 자유양식이 먼저 선택된다

- [ ] **Step 1: 실패하는 테스트를 쓴다**
  - `kinds.test.ts`: `topicsFor(["motive"], ["growth"])` → `["motive"]`, `topicsFor(["experience","self"], ["values","motive"])` → `["values"]`, `topicsFor(["experience"], ["motive"])` → `[]`, "자유양식 지원동기는 유형 motive·주제 motive·글자 수 800", "직접 추가 항목은 유형·주제 null", "모르는 항목 id는 message", "빈 직접 항목은 버린다", "100자 넘는 직접 항목은 message"
  - `repo.test.ts`: "자유양식으로 넣은 문항은 유형·주제·항목을 담는다", "문항 글을 고치면 유형·주제가 비워진다", "제한만 고치면 유형이 남는다", "setQuestionKinds는 주제를 맞춘다", "빈 유형은 empty", "잠긴 공고는 submitted", "다른 사용자의 문항은 not_found"
- [ ] **Step 2: 돌려서 실패를 본다** — `npx vitest run src/modules/applications/kinds.test.ts src/modules/applications/repo.test.ts`
- [ ] **Step 3: 구현한다.** `npm run db:generate`로 `0020`을 만든다
- [ ] **Step 4: 돌려서 통과를 보고 화면을 확인한다** — 같은 명령 PASS, `npx tsc --noEmit`, `npm run lint`. 로컬 미리보기에서 자유양식으로 세 항목을 넣은 화면 사진을 보낸다
- [ ] **Step 5: 커밋** — `feat: 문항이 없는 공고는 자유양식 항목을 골라 문항으로 넣는다`

## Task 4: 고르기에서 유형 정하기와 유형 표시

**Files:**
- Modify: `src/modules/applications/select.ts`, `src/modules/applications/select.test.ts`, `src/modules/applications/prompts.ts`(`SELECT_SYSTEM`), `src/modules/applications/repo.ts`(`saveSelection`), `src/modules/applications/prompt-check.ts`, `src/modules/applications/prompt-check.test.ts`, `src/dev/local-ai.ts`, `src/app/(app)/postings/[id]/application/page.tsx`, `src/app/(app)/postings/[id]/application/question-card.tsx`

**Interfaces:**
- Consumes: Task 3의 `QuestionKind`, `AnswerTopic`, `topicsFor`, `setQuestionKindsAction`
- `selectSchema`에 `kinds: z.array(z.enum(QUESTION_KINDS))`, `topics: z.array(z.enum(ANSWER_TOPICS))`. `SelectInput`에 `kinds: QuestionKind[] | null`(메시지에 `[문항 유형]` 절: 정해졌으면 이름, 아니면 "정해지지 않음")
- `selectText`의 값에 `classified: { kinds: QuestionKind[]; topics: AnswerTopic[] }` — 중복을 빼고, kinds가 비면 `["experience"]`, topics는 `topicsFor(kinds, topics)`. 후보가 없고 `input.kinds`가 정해져 있으면 AI를 부르지 않는다(`classified`는 입력 그대로). 후보가 없어도 유형을 모르면 부른다
- `saveSelection(db, userId, id, selection, classified)`: `kinds`가 null일 때만 `kinds`·`topics`를 채운다(같은 update 안에서 `case when kinds is null`)
- SELECT_SYSTEM에 더할 것(뜻): `kinds` — 문항이 경험을 들어 답하게 하면 experience, 지원 동기·입사 후 포부를 물으면 motive, 성장 과정·성격·가치관을 물으면 self, 함께 물으면 모두. `topics` — motive·self일 때 묻는 주제를 목록에서. [문항 유형]이 정해져 있으면 그것을 그대로 돌려준다
- 화면: 문항 카드에 `유형: [경험형] [동기포부형] [자기소개형]` 누름 단추(`aria-pressed`, 하나 이상). 유형이 없으면 "유형은 경험 고르기 때 정합니다". 유형에 경험형이 없으면 고른 결과의 "이 문항에 맞는 확인된 기록이 없습니다"와 `경험 사례 추가`를 숨긴다

- [ ] **Step 1: 실패하는 테스트를 쓴다** (`select.test.ts`)
  - "유형을 모르면 AI가 정한 유형과 주제를 저장한다", "유형이 이미 있으면 AI 답으로 덮지 않는다", "AI가 빈 유형을 주면 경험형", "후보가 없어도 유형을 모르면 AI를 부른다", "후보가 없고 유형을 알면 AI를 부르지 않는다", "메시지에 [문항 유형]이 들어간다", "학력·자격은 여전히 후보가 아니다"(기존 테스트 유지)
  - `prompt-check.test.ts`: 고르기 행에 "지원 동기와 직무 역량 문항을 경험형과 동기포부형으로 본다", "주제에 지원동기가 있다"
- [ ] **Step 2: 돌려서 실패를 본다** — `npx vitest run src/modules/applications/select.test.ts src/modules/applications/prompt-check.test.ts`
- [ ] **Step 3: 구현한다.** 기존 테스트의 가짜 고르기 답에 `kinds`, `topics`를 더한다
- [ ] **Step 4: 돌려서 통과를 보고 화면을 확인한다** — 같은 명령 PASS, `npx tsc --noEmit`, `npm run lint`. 유형 단추가 보이는 문항 카드 사진을 보낸다
- [ ] **Step 5: 커밋** — `feat: 경험 고르기 때 문항 유형과 주제를 정하고 화면에서 바꾸게 한다`

---

# PR 3: 필요할 때 묻기

## Task 5: 답 표, 질문 만들기, 답 저장

**Files:**
- Modify: `src/modules/applications/schema.ts`, `src/modules/applications/options.ts`, `src/modules/applications/types.ts`, `src/modules/applications/repo.ts`, `src/modules/applications/repo.test.ts`, `src/modules/applications/prompts.ts`, `src/modules/applications/prompt-check.ts`, `src/modules/applications/prompt-check.test.ts`, `src/modules/ai/client.ts`(`AiPurpose`에 `"application_ask"`), `src/dev/local-ai.ts`, `docs/conventions.md`
- Create: `src/modules/experiences/motive-hooks.ts`, `src/modules/experiences/motive-hooks.test.ts`, `src/modules/applications/answers-repo.ts`, `src/modules/applications/answers-repo.test.ts`, `src/modules/applications/ask.ts`, `src/modules/applications/ask.test.ts`, `src/modules/applications/answer-actions.ts`, `drizzle/0021_*.sql`

**Interfaces:**
- Produces (`schema.ts`):
  - `applications_answers` — `id` text pk, `user_id` → `auth_user` cascade, `topic` text, `question` text, `answer` text, `posting_id` → `postings_postings` **set null**, `company` text(공고의 회사 이름, 지난 답 표시용), `company_key` text null(COMPANY_TOPICS일 때만), `created_at`. 색인 `(user_id, topic)`
  - `applications_questions`에 `asks jsonb Asks null`, `answer_ids jsonb string[] not null default []`
- Produces (`types.ts`):
  ```ts
  export type PreviousAnswer = { answerId: string; text: string; label: string }; // label: "삼성전자 · 2026-11"
  export type AskItem = { topic: AnswerTopic; link: string; question: string; options: string[]; previous: PreviousAnswer[] }; // link: 연결고리 한 줄(없으면 빈 글)
  export type Asks = { questionVersion: number; items: AskItem[]; madeAt: string };
  ```
- Produces (`options.ts`, APPLICATION_LIMITS에 더함): `asks: 3, askOptionsMin: 3, askOptions: 5, askQuestion: 200, askOption: 200, answer: 1000, answersPerQuestion: 6`
- Produces (`experiences/motive-hooks.ts`): 질문 거리로 쓸 확인된 기록. 그 트랙에서 쓸 수 있는 것만(사례는 `listSceneWritingSources`와 같은 거르기, 이력 사실은 확인됨이고 트랙에서 제외가 아닌 것)
  ```ts
  export type MotiveHook = { kind: "scene" | "education" | "course" | "credential"; label: string; detail: string };
  // scene: label = 사례 제목, detail = 상황·한 일·결과를 이은 글(300자로 자름). education: 학교·전공. course: 과정·기관·배운 것. credential: 이름·종류
  export async function listMotiveHooks(db: Db, userId: string, trackId: string): Promise<MotiveHook[]>; // 많아야 20개, 사례 먼저
  ```
- Produces (`answers-repo.ts`):
  ```ts
  export type Answer = { id: string; topic: AnswerTopic; question: string; answer: string; postingId: string | null; company: string; companyKey: string | null; createdAt: Date };
  export async function createAnswer(db, userId, input: Omit<Answer, "id" | "createdAt">): Promise<string>;
  export async function listAnswersByIds(db, userId, ids: string[]): Promise<Answer[]>; // ids 순서, 없는 id는 빠짐
  // 주제마다 최근 답 perTopic개(같은 글은 한 번). companyKey가 있는 답은 같은 companyKey일 때만. exceptIds는 빼고
  export async function listReusable(db, userId, topics: AnswerTopic[], companyKey: string, exceptIds: string[], perTopic = 2): Promise<Map<AnswerTopic, Answer[]>>;
  ```
- Produces (`repo.ts`): `Question`에 `asks: Asks | null; answerIds: string[]`. 모두 잠금 안(`guardedWrite`)에서:
  ```ts
  export async function saveAsks(db, userId, id, asks: Asks): Promise<Stale | { ok: false; reason: "not_apply" | "submitted" }>; // version = asks.questionVersion일 때만
  export async function attachAnswer(db, userId, id, answerId: string): Promise<{ ok: true } | { ok: false; reason: "not_found" | "not_apply" | "submitted" | "too_many" }>; // 중복 없이 뒤에, answersPerQuestion까지
  export async function detachAnswer(db, userId, id, answerId: string): Promise<{ ok: true } | { ok: false; reason: "not_found" | "not_apply" | "submitted" }>;
  ```
  `updateQuestion`의 문항 글 변경은 `asks`도 null로. `answer_ids`는 남긴다
- Produces (`ask.ts`):
  ```ts
  export type AskInput = { prompt: string; company: string; title: string; postingText: string; topics: AnswerTopic[]; hooks: MotiveHook[] };
  // 저장하지 않는다. 프롬프트 점검도 쓴다. 정리: 요청한 주제가 아닌 항목·빈 질문은 버리고, link는 200자로 자르고, 선택지는 다듬어 중복을 빼고 5개로 자르며, 선택지가 2개 미만인 항목은 버리고, 항목은 3개까지. 남는 항목이 없으면 invalid
  export async function askText(db, ai, userId, input: AskInput, now?): Promise<{ ok: true; value: AskItem[] } | { ok: false; reason: "over_limit" | AiFailure }>;
  // topics는 화면이 보낸 것 중 그 문항의 topics에 있는 것만 쓴다. 없으면 not_needed. hooks는 listMotiveHooks(공고의 트랙). AI 답을 정리한 뒤 listReusable(…, companyKey(posting.company), question.answerIds)의 지난 답을 같은 주제 항목의 previous에 붙인다(지난 답이 있는 항목은 선택지가 2개 미만이어도 남긴다). 읽은 version으로 saveAsks
  export async function makeAsks(db, ai, userId, questionId, topics: unknown, now?): Promise<{ ok: true; value: Asks } | { ok: false; reason: "not_found" | "not_apply" | "submitted" | "changed" | "not_needed" | "over_limit" | AiFailure }>;
  // picks: { index: number; options: number[]; previous: number[]; note: string }[] (질문 번호, 고른 선택지 번호, 고른 지난 답 번호, 기타 한 줄 200자). 새 답 글 = 저장된 asks에서 꺼낸 선택지 글을 줄바꿈으로 잇고 기타를 덧붙임. 지난 답은 저장된 asks의 answerId를 그대로 붙인다(지금도 내 답이고 붙일 수 있는지 다시 본다). 아무것도 고르지 않은 항목은 건너뜀.
  // asks가 없거나 asks.questionVersion이 지금 version과 다르면 changed. 새 답마다 createAnswer(company = posting.company, 회사 주제면 companyKey(posting.company)) + attachAnswer, 답한 항목은 asks에서 뺀다. 모두 한 트랜잭션(잠금 안)
  export async function answerAsks(db, userId, questionId, picks: unknown, now?): Promise<{ ok: true; added: number } | { ok: false; reason: "not_found" | "not_apply" | "submitted" | "changed" | "empty" | "too_many" }>;
  // 직접 적기: 새 답을 만들어 붙인다. question = "직접 적음", topic은 문항의 topics에 있어야 한다. 글은 1~1000자
  export async function writeAnswer(db, userId, questionId, topic: unknown, text: string): Promise<{ ok: true } | { ok: false; reason: "not_found" | "not_apply" | "submitted" | "empty" | "too_long" | "not_needed" | "too_many" }>;
  ```
- Produces (`answer-actions.ts`, `"use server"`): `makeAsksAction`, `answerAsksAction`, `writeAnswerAction`, `detachAnswerAction` — 모두 `requireUser()`의 id만 쓰고 끝나면 자소서 화면을 다시 그린다. `need_answers`·`not_needed` 문구를 `actions.ts`의 `MESSAGES`에 더한다
- ASK_SYSTEM(뜻): 자기소개서 문항 하나를 쓰기 전에 지원자에게 물을 짧은 질문 2~3개를, 요청한 주제마다 만든다. 먼저 [공고]와 [내 기록]을 맞대서 이어지는 곳(공고의 업무·역량 ↔ 지원자의 사례·교육·전공·자격)을 찾고, 그 연결고리를 `link`에 한 줄로 적고 그것이 지원 이유·포부와 어떻게 이어지는지 지원자의 생각을 묻는다. 이어지는 곳이 없으면 `link`는 빈 글이고 공고만 보고 묻는다. 질문마다 지원자가 고를 만한 답 3~5개를 준다. 선택지는 지원자 자신의 이유·생각·태도를 말하는 짧은 문장이고, [내 기록]에 없는 경력·성과·수치를 넣지 않으며, 회사에 대한 사실(실적, 수치, 사업)을 새로 담지 않는다(공고 글에 있는 것만 가리킬 수 있음). 고른 것만 지원자의 답이 되므로 서로 다른 방향의 선택지를 주고, "이어지지 않는다" 같은 빠져나갈 선택지도 둘 수 있다. 학점·자격증 이름을 늘어놓는 답을 만들지 않는다. `topic`은 요청한 주제 중 하나
- `docs/conventions.md`: applications 줄에 `applications_answers`와 "지원자의 답(묻기)"를 더한다

- [ ] **Step 1: 실패하는 테스트를 쓴다**
  - `motive-hooks.test.ts`: "확인된 사례·학력·교육·자격만 나온다", "머리가 미확인인 사례는 빠진다", "트랙에서 제외한 기록은 빠진다", "사례가 이력 사실보다 먼저, 20개까지", "다른 사용자의 기록은 나오지 않는다"
  - `answers-repo.test.ts`: "listReusable은 주제마다 최근 2개, 같은 글은 한 번", "회사에 묶인 답은 같은 companyKey에서만", "회사에 묶이지 않은 답은 어느 공고에서나", "exceptIds는 빠진다", "공고를 지워도 답은 남고 postingId가 null", "다른 사용자의 답은 읽히지 않는다"
  - `ask.test.ts`: "요청하지 않은 주제의 질문은 버린다", "선택지 6개는 5개로, 1개뿐인 질문은 버린다", "AI에 보내는 글에 [내 기록]이 있고 확인되지 않은 기록은 없다", "link는 200자로 자른다", "문항 topics에 없는 주제를 보내면 not_needed", "질문을 만드는 사이 문항 글을 고쳤으면 changed", "answerAsks는 저장된 선택지 글로 답을 만든다(화면이 보낸 글은 쓰지 않음)", "고른 선택지 둘과 기타를 줄바꿈으로 잇는다", "asks.questionVersion이 다르면 changed", "지원동기 답에는 companyKey가 담기고 성장과정 답에는 없다", "답한 항목은 asks에서 빠진다", "늘 AI를 불러 새로 묻고, 같은 회사의 지난 지원동기를 그 질문의 previous에 붙인다", "다른 회사의 지원동기는 previous에 붙지 않고 성장과정은 붙는다", "AI가 그 주제의 질문을 만들지 않았으면 지난 답만 담은 질문을 더한다", "지난 답을 고르면 새 행 없이 그 id를 붙인다", "지난 답과 새 선택지를 함께 고르면 둘 다 붙는다", "writeAnswer의 빈 글은 empty, 1001자는 too_long", "잠긴 공고는 submitted"
  - `prompt-check.test.ts`: 묻기 행(아래 Step 3)
- [ ] **Step 2: 돌려서 실패를 본다** — `npx vitest run src/modules/applications/answers-repo.test.ts src/modules/applications/ask.test.ts src/modules/applications/prompt-check.test.ts`
- [ ] **Step 3: 구현한다.** `npm run db:generate`로 `0021`을 만든다. 프롬프트 점검에 묻기 예시 하나(호출 1번): `FULL_POSTING`의 "지원 동기를 적어 주세요", 주제 `["motive"]`, 기록 = 교육 "Kotlin 백엔드 개발 과정"과 맞지 않는 "카페 바리스타 아르바이트" 사례. 행: "질문 2~3개", "질문마다 선택지 3~5개", "주제가 모두 지원동기", "연결고리에 Kotlin 교육이 나온다", "바리스타를 연결고리로 쓰지 않는다", "선택지에 공고·기록에 없는 숫자가 없다"
- [ ] **Step 4: 돌려서 통과를 본다** — 같은 명령 PASS, `npx tsc --noEmit`
- [ ] **Step 5: 커밋** — `feat: 동기·포부 같은 재료를 고를 수 있는 질문으로 묻고 답을 저장한다`

## Task 6: 답으로 쓰기, 검사, 제출본

**Files:**
- Modify: `src/modules/applications/types.ts`, `src/modules/applications/write.ts`, `src/modules/applications/write.test.ts`, `src/modules/applications/check.ts`, `src/modules/applications/check.test.ts`, `src/modules/applications/repo.ts`(`saveDraft`), `src/modules/applications/prompts.ts`(`WRITE_SYSTEM`, `REVISE_SYSTEM`), `src/modules/applications/submit.ts`, `src/modules/applications/submit.test.ts`, `src/modules/applications/prompt-check.ts`, `src/modules/applications/prompt-check.test.ts`

**Interfaces:**
- Consumes: Task 5의 `Answer`(질문 글에 연결고리의 교육 이름이 남아 있을 수 있다), `listAnswersByIds`, `Question.answerIds`; Task 3의 `needsAnswers`
- `types.ts`: `Paragraph`에 `answers?: string[]`(답 id. 옛 답에는 없음 → 빈 배열로 본다), `Draft`에 `answers?: string[]`(쓸 때 보낸 답 id)
- `WriteInput`에 `kinds: QuestionKind[]`, `answers: Answer[]`. 메시지에 `[문항 유형]`과 `[내 답]`(A1, A2 … 마다 주제·질문·답, 없으면 "없음") 절. AI의 `sources`에는 E와 A 별명을 함께 적고, 코드가 E는 경험 id로(`paragraph.sources`), A는 답 id로(`paragraph.answers`) 나눈다. 승인 경험이 0개여도 답이 있으면 쓴다
- `approveAndWrite` 규칙(지금 규칙에 더함): 답은 서버가 `question.answerIds`로 읽는다. `needsAnswers(kinds)`인데 답이 0개면 `need_answers`(AI 부르지 않음). 고른 결과가 없으면, 보낸 경험 id가 비었고 유형에 경험형이 없을 때만 답만으로 쓴다(승인 없음). 경험도 답도 없으면 `none_selected`. `saveDraft`의 `readAs`에 `answerIds`를 더하고(`answer_ids`가 같을 때만), `approved: null`이면 `selection is null`을 본다
- `reviseParagraph`: `draft.answers`의 답을 함께 보낸다. 그 답이 하나라도 없으면 `stale`
- `checkDraft(draft, question, sources, options: { oldIds?: Set<string>; answers?: Answer[] })`: 문단의 `answers` 중 `draft.answers`에 있고 지금 있는 답이 있으면 근거 있음, 그 답 글의 숫자는 허용, 없는 답 id는 `staleSource`
- `submit.ts`: 얼릴 때 문단의 `answers`를 `sources`에 `{ experienceId: 답 id, name: "내 답: 지원동기" }`로 덧붙인다(답이 없으면 "지운 답"). `submitPreview`의 `checkDraft`에 답을 넘긴다
- WRITE_SYSTEM·REVISE_SYSTEM에 더할 것(뜻): [내 답]은 지원자가 직접 고른 말이다. 동기·포부·성장과정·성격·가치관은 [내 답]에 적힌 것만 쓰고 넓히거나 보태지 않는다. [내 답]이 "없음"이면 그런 내용을 쓰지 않고 shortage에 적는다. 답의 질문에 나온 교육·전공은 이야기의 출발점으로 한 줄만 쓰고 늘어놓지 않는다. 공고의 문구는 회사 이야기에만 쓰고 지원자가 한 일처럼 쓰지 않는다. 답이 근거인 문단은 sources에 A 별명을 적는다

- [ ] **Step 1: 실패하는 테스트를 쓴다**
  - `write.test.ts`: "동기포부형인데 답이 없으면 need_answers이고 AI를 부르지 않는다", "자기소개형만인 문항은 고르기 없이 답만으로 쓴다", "경험형 문항은 지금처럼 고르기가 있어야 한다(changed)", "AI의 A 별명은 paragraph.answers로, E 별명은 sources로 나뉜다", "없는 A 별명은 버린다", "쓰는 사이 답을 붙이거나 뗐으면 changed", "부분 수정은 답을 함께 보내고, 그 답이 없으면 stale", "AI에 보낸 글에 [내 답]과 답 글이 있다"
  - `check.test.ts`: "답이 근거인 문단은 근거 없음이 아니다", "답 글의 숫자는 표시하지 않는다", "draft.answers에 없는 답 id는 근거로 치지 않는다", "옛 답(answers 칸 없음)은 지금과 같게 검사한다"
  - `submit.test.ts`: "답 근거는 '내 답: 지원동기'로 얼린다"
  - `prompt-check.test.ts`: 답으로 쓰기 행(아래 Step 3)
- [ ] **Step 2: 돌려서 실패를 본다** — `npx vitest run src/modules/applications/write.test.ts src/modules/applications/check.test.ts src/modules/applications/submit.test.ts src/modules/applications/prompt-check.test.ts`
- [ ] **Step 3: 구현한다.** 프롬프트 점검에 쓰기 예시 하나(호출 1번): "지원 동기를 적어 주세요 (300자 이내)", 유형 motive, 경험 없음, 답 A1 = 주제 지원동기 / "주문·결제처럼 많은 사람이 매일 쓰는 서비스를 안정적으로 만드는 일을 하고 싶다". 행: "모든 문단의 근거가 내 답이다", "기록에 없는 숫자가 없다", "300자를 넘지 않는다", "경력·성과를 지어 쓰지 않는다"(글에 "개발했"·"경험이 있"이 없음)
- [ ] **Step 4: 돌려서 통과를 본다** — 같은 명령 PASS, `npx tsc --noEmit`
- [ ] **Step 5: 커밋** — `feat: 지원자의 답을 근거로 자소서를 쓰고 검사·제출본에 '내 답'으로 남긴다`

## Task 7: 묻기 화면과 마무리

**Files:**
- Modify: `src/app/(app)/postings/[id]/application/page.tsx`, `src/app/(app)/postings/[id]/application/question-card.tsx`, `src/app/(app)/postings/[id]/application/draft-view.tsx`, `src/dev/local-ai.ts`(`application_ask` 가짜 답, 쓰기 가짜 답에 A 별명), `docs/status.md`, 이 계획 문서 끝
- Create: `src/app/(app)/postings/[id]/application/answer-section.tsx`

**Interfaces:**
- Consumes: Task 5의 액션들, Task 6의 `checkDraft(… { answers })`
- 페이지가 문항마다 넘기는 값(`QuestionView`에 더함): `kinds`, `topics`, `answers: { id; topic; label; text }[]`(붙인 답), `asks: Asks | null`. `DraftData.names`에 답 id → "내 답: (주제)"
- `answer-section.tsx`(유형에 동기포부형·자기소개형이 있을 때 카드 안에): 붙인 답 목록("내 답 · 지원동기: …" + `빼기`) → `질문 받기`(AI 1번. 붙인 답이 있어도 다시 받을 수 있다) → 질문마다 연결고리 한 줄(있으면, 흐린 글씨) + 선택지 체크 + 지난 답 체크("지난번 답 (삼성전자 · 2026-11)", 다른 선택지와 구분되게) + `기타 (짧게 적기)` 한 줄 → `답 저장`. 주제마다 `직접 적기`
- 쓰기 단추: 유형에 경험형이 없으면 고르기 없이도 보인다(답이 1개 이상일 때 켜짐). `draft-view`의 근거 이름은 `[...sources, ...answers]`

- [ ] **Step 1: 화면을 만든다** — 기존 `useRun`, `ErrorLine`, 버튼 모양을 쓴다. 입력은 체크 위주로(사용자는 타자를 싫어한다)
- [ ] **Step 2: 검사를 돌린다** — `npm test`(전체), `npx tsc --noEmit`, `npm run lint` 모두 통과
- [ ] **Step 3: 로컬 미리보기로 확인한다** — 자유양식 지원동기 문항에서 질문 받기 → 선택지 고르기 → 답 저장 → 쓰기 → 문단 근거 "내 답: 지원동기"까지 사진(휴대폰 폭 포함)을 사용자에게 보낸다. 다른 공고(같은 회사 이름 표기만 다름)에서 질문 받기를 누르면 지난 답이 선택지 끝에 붙는지도 본다
- [ ] **Step 4: 문서를 고친다** — `docs/status.md`(5-5 끝, 다음 할 일 5-6, 남은 확인에 프롬프트 점검 호출 수 23번과 실제 공고로 서류·문항 읽기 확인), 이 문서 끝에 "구현하다 달라진 점", "판단 기록", "판단표 점검"
- [ ] **Step 5: 커밋** — `feat: 자소서 문항에서 필요한 답을 고르는 질문으로 묻는 화면을 더한다`

---

## 구현하다 달라진 점

### PR 1 (Task 1~2)

- `cleanFound`는 이름이 빈(또는 글이 아닌) 서류를 기본 이름으로 바꾸지 않고 버린다(검토)
- `companyKey`는 법인 표기를 뺀 뒤 남은 괄호 문자(`()[]【】`)도 뺀다. 괄호 안 글은 남긴다("가나다(서울)" → "가나다서울")
- `createPosting(…, found?: unknown)`이 `cleanFound(found, input.rawText)`를 직접 부른다. 브라우저가 보낸 값의 검사를 repo 테스트로 덮으려고 액션에서 옮겼다(검토)
- `다시 읽기`는 `applications/documents.ts`의 `rereadAndSeed`가 맡는다: 제출로 잠긴 공고는 AI를 부르기 전에 `submitted`, AI가 읽는 사이 제출했으면 저장하지 않는다(공고 잠금 안에서 다시 확인), 그 뒤 문항을 채운다. `postings/reread.ts`는 저장하지 않는 `readFound`를 따로 둔다(검토)
- 서류 체크에서 마지막 하나는 끌 수 없다(아무것도 고르지 않은 상태는 뜻이 없다)
- 제출 확인 창의 "…를 얼립니다" 문장은 고른 서류에 따라 조사(을/를)를 맞춘다(검토)
- 프롬프트 점검의 "지어내지 않는다" 행은 코드가 정리한 뒤의 값을 본다. 지어낸 문항을 코드가 버리면 행은 통과하므로, 지시문 자체보다 전체 흐름을 재는 행이다
- `onlyIfEmpty` 동시 실행 테스트는 PGlite가 연결 하나라 잠금 없이도 통과한다. 동작을 적어 둔 테스트이고 증명은 아니다
- (검토) 다시 읽어 기타 서류가 사라져도 이미 고른 기타는 서류 고르기에 "기타"로 남아 끌 수 있다(`documentRows`)

### PR 2 (Task 3~4)

- 직접 추가한 자유양식 항목은 `freeform_item`에 `"custom"`을 담는다(8개 항목의 "넣음" 표시에는 쓰이지 않는다)
- 유형을 아는 문항에서 후보가 없을 때만 AI를 부르지 않는다. 그래서 "후보가 없으면 AI를 부르지 않는다"를 보던 기존 테스트 둘은 먼저 유형을 정해 두고 본다
- 고르기의 프롬프트 점검에 유형·주제 줄 둘을 더했다(자소서 점검 12줄, 호출 수는 그대로)
- 서버는 같은 자유양식 항목을 두 번 넣는 것(두 탭, 두 번 누름)을 막지 않는다. 화면이 넣은 항목을 끄고, 공고당 10개 한도는 그대로다
- (검토) 자유양식 직접 추가 칸은 한글 입력 중의 Enter(글자 확정)로 항목을 넣지 않는다(`isComposing`, 기록 채팅 입력과 같게)

### PR 3 (Task 5~7)

- 묻기의 질문(`AskItem`)마다 `id`를 두고, 답 저장의 picks는 순서가 아니라 `id`로 질문을 가리킨다. 저장된 질문에 없는 id가 오면 `changed`(두 번 누름·다른 탭·질문 다시 받기 뒤의 옛 화면이 다른 질문의 선택지를 내 답으로 저장하던 것을 막는다)(검토)
- 지난 답은 주제마다 최근 2개(`APPLICATION_LIMITS.askPrevious`). AI 답이 모두 버려졌어도(`invalid`) 지난 답이 있으면 "지난번 답을 다시 쓸까요?" 질문만으로 저장한다(검토)
- `setQuestionKinds`는 주제가 바뀌면 받아 둔 질문(`asks`)을 비운다(검토)
- `기타`는 한 줄로 모아 200자로 자른다. picks의 번호는 0 이상, 개수는 한도 안(검토)
- 동기포부형·자기소개형뿐인 문항에도 `이어지는 경험도 고르기`(선택 사항)를 둔다. 설계 5.5의 "이어지는 장면이 있으면 그 장면"을 쓰려는 것이다. "확인된 기록이 없습니다"는 여전히 보이지 않는다. 카드마다 쓰기 단추는 하나다(검토)
- 쓰기의 숫자 규칙은 [내 답]의 "답:" 줄의 숫자만 허용한다(검사와 같게). 답의 질문 글(교육 이름 등)의 숫자는 허용하지 않는다
- (전체 검토) 일부 주제만 답한 문항: 유형마다 맞는 주제의 답이 있어야 쓴다(동기포부형이면 지원동기·포부 답, 자기소개형이면 성장과정·성격·가치관·기타 답). 답이 없는 주제는 `[답이 없는 주제]`로 AI에 알려 쓰지 않고 모자란 점에 적게 하고, 화면에 "…에 아직 답이 없습니다"를 보인다
- (전체 검토) 화면의 쓰기 단추는 서버와 같은 규칙(`unansweredKinds`)으로 켠다: 경험형+동기포부형 문항은 고른 경험이 있어도 지원동기 쪽 답이 없으면 끈다. 승인한 경험의 기록이 바뀐 문항은 경험형이 없어도 빈 경험으로 쓰지 않고 "다시 고르기를 눌러 주세요"를 보인다. 코드가 더한 "지난번 답을 다시 쓸까요?" 질문에는 기타 칸을 두지 않는다. `need_answers` 문구는 "먼저 '내 답'의 질문에 답해 주세요"
- 지난 답 표시는 "지난번 답 · (주)가나다 · 2026-11"(괄호가 겹치지 않게)
- 프롬프트 점검은 호출 22번이다(계획의 23번이 아니다: 공고 5, 기록·이력서 등 기존 + 묻기 1 + 답으로 쓰기 1)
- 붙인 답을 뗀 뒤에도 이미 쓴 문단은 그 답을 근거로 친다(답 행은 지워지지 않는다). 나중에 "붙인 답이 바뀌었습니다" 표시를 더할 수 있다

## 판단 기록

- PR #47 (PR 1, Task 1~2): ③ 계획 승인(새 표와 묻기 방식을 물음 → 사용자가 묻기를 "내 기록과 대조해 연결고리마다", 지난 답은 "선택지 하나로" 바꿈). Codex 1회차 지적 1(다시 읽어 사라진 기타 서류) → ① 0 → 멈추기. 합치기 = 반드시 묻기 + 7 → 사용자가 합치기. 배포 뒤 새 오류 없음
- PR #48 (PR 2, Task 3~4): Codex 1회차 지적 1(한글 입력 중 Enter) → ① 2 → 멈추기. 합치기 = 반드시 묻기 + 7 → 사용자가 합치기. 배포 뒤 새 오류 없음
- PR 3 (Task 5~7): 아래 PR 본문에 적는다

## 판단표 점검 (2026-11-23)

- ① Codex 재검토: 두 PR 모두 1회차에 화면 쪽 작은 결함 하나씩(P2)이 나왔고 점수가 낮아 멈췄다. 고친 뒤 다시 받지 않은 것으로 생긴 문제는 아직 없다
- ② 합치기: 모든 PR이 반드시 묻기(새 칸·마이그레이션)에 걸려 사용자에게 물었다. 합친 뒤 Vercel에 새 오류 없음
- ③ 계획 승인: 새 표를 묻다가 사용자가 묻기의 방식 자체를 바꿨다(공고와 내 기록을 대조하기, 이력 사실은 질문 거리로만, 지난 답은 선택지로). 설계 문서만 보고 짠 계획이 사용자의 생각과 달랐던 곳을 ③이 잡았다. 맞았다. 다만 처음 질문이 사용자에게 "그림이 그려지지 않는" 말이었다. 사용자에게 묻는 결정은 예시 화면(그림)과 실제 흐름으로 보이는 편이 빨랐다
- 놓친 것: 작업 검토가 "경력기술서는 AI가 쓴다"는 계획의 결정(작업 설명 밖의 "정한 것")을 놓쳤고 진행자가 잡았다. 작업 설명에 계획의 "정한 것" 중 그 작업에 걸리는 줄을 함께 넣어야 한다(이번 계획 뒤로는 그렇게 했다). 묻기 화면에서 동기포부형 문항의 경험 고르기를 숨긴 것은 작업 검토가 설계 5.5와 맞대 잡았다. 일부 주제만 답한 문항의 지어 쓰기는 전체 검토가 잡았다. 작업 검토 → 전체 검토의 두 겹이 쓸모 있었다
- 직접 만든 장치: `related-test.sh`, `/ship`, `vercel-ignore`는 여전히 쓸모가 있다. 판단표는 바꾸지 않는다
