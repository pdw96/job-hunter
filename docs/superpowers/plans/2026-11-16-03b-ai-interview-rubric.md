# Job Hunter 3-2번 계획: AI 루브릭 판정 · AI 인터뷰 · 금지 표현 후보 Implementation Plan

**Goal:** AI가 경험 기록이 구체적인지 판정하고 미달 항목마다 보완 방안을 알려 준다. AI 인터뷰로 새 기록을 만들거나 미달 항목만 보완할 수 있다. "하지 않은 것"을 보고 과장으로 읽힐 표현을 후보로 제안하고, 사용자가 승인한 것만 금지 목록에 들어간다. 모든 AI 호출의 사용량을 기록하고 월 한도를 넘으면 막는다.

**Architecture:** 모듈 `ai`를 추가한다. Claude API를 부르는 곳은 `ai` 모듈의 `AiClient` 하나뿐이고, 다른 모듈은 이 인터페이스를 인자로 받는다. 테스트와 로컬 미리보기는 정해진 답을 돌려주는 가짜 `AiClient`를 쓴다. AI가 돌려준 내용은 항상 코드가 한 번 더 검사한 뒤에만 저장한다(스키마 검사, 대화에 없던 숫자 검사, 판정 대상 내용이 그사이 바뀌지 않았는지 검사).

**Tech Stack:** `@anthropic-ai/sdk`(공식 SDK), `zod`(응답 스키마). 모델은 `claude-sonnet-5-5`(사용자 결정, 2026-11-16). 환경 변수 `AI_MODEL`로 바꿀 수 있다.

**Spec:** 설계 6.3(AI 인터뷰, 검증 루브릭, 금지 표현), 6.8(AI 비용) 중 기록과 기본 한도

## Claude API 사용 규칙 (확인된 것)

SDK 코드를 쓰기 전에 설치된 버전의 문서와 타입을 다시 확인한다. 아래는 2026-11-16에 확인한 내용이다.

- 구조화된 응답: `client.messages.parse({ ..., output_config: { format: zodOutputFormat(schema) } })`, 결과는 `response.parsed_output`(실패하면 `null`)
- `claude-sonnet-5-5`는 `thinking: { type: "disabled" }`와 `budget_tokens`, 강제 `tool_choice`가 400이다. `thinking`은 생략(적응형)하고 깊이는 `output_config.effort`로 조절한다
- 효과(effort): 인터뷰 한 턴 `low`, 판정과 정리 `medium`
- 응답을 읽기 전에 `stop_reason`을 본다. `refusal`이면 내용을 쓰지 않고 "AI가 이 요청을 처리하지 못했습니다"로 알린다. `max_tokens`면 실패로 처리한다
- 거절 시 대체 모델(`fallbacks: "default"`, beta `server-side-fallback-2026-07-01`)을 기본으로 켠다. `messages.parse`와 함께 쓸 수 있는지는 구현할 때 SDK에서 확인하고, 안 되면 켜지 않고 그 사실을 PR에 적는다
- 프롬프트 캐시: 시스템 프롬프트는 고정 글만 담고(날짜·사용자 이름 등 넣지 않음) 요청 최상위에 `cache_control: { type: "ephemeral" }`
- `max_tokens`: 인터뷰 턴 4,000, 판정 8,000, 정리 16,000
- 사용량: `response.usage`의 `input_tokens`, `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`
- 가격(USD / 100만 토큰, 2026-11-03 기준): Sonnet 5.5 입력 2 / 출력 10 / 캐시 읽기 0.10, Opus 5.5 4 / 20 / 0.20, Haiku 5.5 0.10 / 0.50. 캐시 쓰기는 입력의 1.25배. 표에 없는 모델은 가장 비싼 값으로 계산한다

## Global Constraints

- 앞 계획들의 Global Constraints와 `docs/conventions.md`를 모두 따른다
- **AI에게 보내는 것**: 경험 기록의 내용, 인터뷰 대화, 트랙의 직무 이름. **보내지 않는 것**: `profile` 모듈의 연락처, 이메일, 사용자 id, 로그인 이름
- 사용자가 쓴 글은 보내기 전에 전화번호·이메일·주민등록번호 형태를 코드로 가린다(`[전화번호]` 등). 3-3의 가져오기도 같은 함수를 쓴다
- AI는 기록이 **구체적인지**만 판정한다. 사실인지는 사용자가 "내용이 맞습니다"로 확인한다. AI 판정은 본인 확인(`confirmedAt`)을 바꾸지 않는다
- AI가 만든 기록은 항상 **미확인**으로 저장된다
- AI는 금지 표현을 스스로 확정하지 않는다. 후보만 만들고 사용자가 승인해야 `bannedPhrases`에 들어간다
- `ANTHROPIC_API_KEY`는 환경 변수로만 다룬다. 채팅이나 저장소에 넣지 않는다
- 화면은 `npm run preview:local`(가짜 AI)로 띄워 브라우저로 확인하고 사진을 사용자에게 보낸다
- 커밋과 배포는 사용자 확인을 받은 뒤에 한다

## 빌더가 정한 것 (사용자가 바꿀 수 있음)

| 항목 | 정한 내용 |
|---|---|
| 판정 시점 | 사용자가 `AI 판정 받기`를 누를 때. 인터뷰로 만든 기록을 저장한 직후에도 한 번 자동으로 한다. 내용을 고치면 판정이 지워지므로 다시 눌러야 한다 |
| 판정 범위 | 본인 역할, 수준, 수치, 증빙. 기간은 계속 코드가 판정한다. 닫은 항목과 적용하지 않는 항목은 건드리지 않는다 |
| 금지 표현 후보 | 판정과 같은 호출에서 함께 받는다(비용 절약). 거절한 후보는 기억해 두고 다시 제안하지 않게 한다 |
| 증빙 할 일 | 표를 따로 두지 않는다. 증빙이 미달인 기록을 모아 기록 목록 위에 `증빙 할 일`로 보여 준다 |
| 인터뷰 방식 | 한 턴에 질문 하나. 사용자가 `기록으로 정리하기`를 누르면(또는 AI가 충분하다고 하면) 대화를 기록 초안으로 바꿔 입력 폼에 채워 보여 준다. 사용자가 확인·수정 후 저장한다 |
| 인터뷰 종류 | 새 기록 만들기 / 기존 기록의 미달 항목만 보완하기(`지금 보완하기`) |
| 인터뷰 길이 | 세션당 사용자 답 30개까지, 답 하나 4,000자까지 |
| 실시간 출력 | 쓰지 않는다. 답을 기다리는 동안 `생각 중…`을 보여 준다(인터뷰 질문은 짧다) |
| 월 한도 | 1인당 월 5달러(환경 변수 `AI_MONTHLY_LIMIT_USD`). 넘으면 AI 기능만 막고 나머지는 계속 된다. 개인 키 등록과 관리자 화면은 7번 계획 |
| 사용량 표시 | 경험 기록 목록 아래에 `이번 달 AI 사용: $0.42 / $5.00` |

---

### Task 1: AI 기반 (비용 계산 · 사용량 기록 · 한도 · 연락처 가리기 · 클라이언트)

**Files:** Create `src/modules/ai/pricing.ts`, `src/modules/ai/redact.ts`, `src/modules/ai/schema.ts`, `src/modules/ai/usage.ts`, `src/modules/ai/client.ts`, `src/modules/ai/anthropic-client.ts`, `src/modules/ai/fake-client.ts`, 각 `*.test.ts`. Modify `src/db/schema.ts`, `drizzle/`, `.env.example`, `README.md`, `docs/conventions.md`

**Interfaces:**
- `pricing.ts`: `costMicroUsd(model, usage): number` — 100만분의 1달러 정수. `DEFAULT_MODEL = "claude-sonnet-5-5"`
- `redact.ts`: `redactContacts(text): string` — 휴대전화·유선전화, 이메일, 주민등록번호 형태를 `[전화번호]`, `[이메일]`, `[주민등록번호]`로 바꾼다. 연도나 금액 같은 다른 숫자는 건드리지 않는다
- 테이블 `ai_usage`: `id`, `userId`(→ `auth_user`, cascade), `purpose`(`judge` / `interview` / `extract`), `model`, `inputTokens`, `outputTokens`, `cacheReadTokens`, `cacheWriteTokens`, `costMicroUsd`, `createdAt`. `(userId, createdAt)` 인덱스
- `usage.ts`: `recordUsage(db, userId, entry)`, `monthlyCostMicroUsd(db, userId, now)`(한국 시간 기준 그 달), `monthlyLimitMicroUsd()`, `checkBudget(db, userId, now): Promise<{ ok: true } | { ok: false; reason: "over_limit" }>`
- `client.ts`:
  - `type AiRequest<T> = { purpose; system: string; messages: { role: "user" | "assistant"; text: string }[]; schema: ZodType<T>; effort: "low" | "medium"; maxTokens: number }`
  - `type AiResult<T> = { ok: true; value: T; usage; model } | { ok: false; reason: "refused" | "truncated" | "invalid" | "unavailable" }`
  - `interface AiClient { complete<T>(request: AiRequest<T>): Promise<AiResult<T>> }`
  - `runAi(db, ai, userId, request, now): Promise<AiResult<T> | { ok: false; reason: "over_limit" }>` — 한도 검사 → 사용자 글에 `redactContacts` 적용 → 호출 → 사용량 기록(성공·실패 모두, 토큰을 쓴 만큼)
- `anthropic-client.ts`: SDK로 `AiClient` 구현. 위 "Claude API 사용 규칙"을 따른다. 오류는 SDK의 타입별 예외로 구분한다(429·5xx·연결 오류 → `unavailable`)
- `fake-client.ts`: `createFakeAi(responses)` — 정해진 답을 순서대로 돌려주고 받은 요청을 기록한다(테스트에서 "무엇을 보냈는지" 확인용)

- [ ] **Step 1: 실패하는 테스트**
  - 비용: Sonnet 5.5로 입력 100만·출력 100만 토큰이면 12달러. 캐시 읽기와 쓰기 요금이 따로 계산된다. 모르는 모델은 가장 비싼 값
  - 가리기: `010-1234-5678`, `01012345678`, `02-123-4567`, `a.b@example.co.kr`, `900101-1234567`이 가려지고, `2023년 3월`, `5건에서 1건`, `4,000만원`, `2023-03`은 그대로다
  - 한도: 이번 달 합계가 한도 이상이면 `over_limit`이고 AI를 부르지 않는다. 지난달 사용량과 다른 사용자의 사용량은 세지 않는다
  - `runAi`: 보낸 메시지에서 연락처가 가려져 있다. 호출 뒤 `ai_usage`에 한 줄이 생긴다. 거절(`refused`)이어도 사용량은 기록된다
  - 사용자를 지우면 사용량도 지워진다
- [ ] **Step 2~4: 실패 확인, 구현(SDK 설치 후 문서 확인 포함), 통과 확인, Commit** `feat: AI 호출 기반과 사용량 기록`

---

### Task 2: 루브릭 판정과 금지 표현 후보

**Files:** Create `src/modules/experiences/judge.ts`, `src/modules/experiences/judge.test.ts`, `src/modules/experiences/prompts.ts`. Modify `src/modules/experiences/schema.ts`(칸 추가), `src/modules/experiences/repo.ts`, `drizzle/`

**Interfaces:**
- `experiences_experiences`에 칸 추가: `phraseCandidates jsonb not null default '[]'`(AI가 제안한 후보), `dismissedPhrases jsonb not null default '[]'`(사용자가 거절한 후보), `judgedAt timestamptz null`
- `judge.ts`:
  - 응답 스키마: `{ role, level, metrics, evidence: { status: "met" | "unmet"; note: string }, phraseCandidates: string[] }` — `note`는 미달일 때 "무엇을 알려 주면 채워지는지" 한두 문장
  - `judgeExperience(db, ai, userId, experienceId, now): Promise<{ ok: true } | { ok: false; reason: "not_found" | "changed" | "over_limit" | "refused" | ... }>`
    1. 기록을 읽는다(본인 것만)
    2. `runAi`로 판정을 받는다
    3. **읽었을 때의 `updatedAt`과 같을 때만** 한 번의 `update`로 반영한다. 달라졌으면 `changed`를 돌려주고 아무것도 바꾸지 않는다
    4. 반영 규칙: 적용하지 않는 항목(`na`)과 닫은 항목(`closed`)은 그대로. 기간은 건드리지 않는다. 후보는 이미 금지 목록에 있는 것과 거절한 것을 빼고, 20개까지
  - `approvePhrase(db, userId, id, phrase)` — 후보에서 빼고 `bannedPhrases`에 넣는다. 후보에 없는 글은 거부
  - `dismissPhrase(db, userId, id, phrase)` — 후보에서 빼고 `dismissedPhrases`에 넣는다
  - `listEvidenceTodos(db, userId): Promise<{ id; name; note }[]>` — 증빙이 미달인 기록
- `prompts.ts`: 판정용 시스템 프롬프트. 담을 것: 다섯 항목의 기준(설계 6.3의 표), "구체적인지만 본다, 사실 여부는 판단하지 않는다", "수치가 없으면 수치 항목은 충족으로 본다(없는 수치를 요구하지 않는다)", "후보는 '하지 않은 것'에 비추어 과장으로 읽힐 수 있는 표현만, 기록에 실제로 쓸 법한 짧은 구절로", 응답은 한국어

- [ ] **Step 1: 실패하는 테스트** (가짜 AI 사용)
  - 판정이 항목 상태와 보완 방안으로 저장되고 `judgedAt`이 찍힌다. 본인 확인은 바뀌지 않는다
  - 본인 역할·수준이 `met`으로 판정된 재직 기록을 확인하면 **확인됨**이 된다(3-1의 한계가 풀린다)
  - 닫은 수치는 AI가 `unmet`이라고 해도 `closed`로 남는다. 학력 기록의 본인 역할은 `na`로 남는다. 기간은 AI 응답과 무관하다
  - 판정을 기다리는 사이 내용이 바뀌면 `changed`이고 루브릭이 바뀌지 않는다(가짜 AI가 답하기 전에 기록을 고치도록 만들어 확인)
  - 다른 사용자의 기록은 `not_found`이고 AI를 부르지 않는다
  - AI에게 보낸 글에 사용자 id와 이메일이 없고, 기록 안의 전화번호가 가려져 있다
  - 후보: 이미 금지 목록에 있거나 거절한 표현은 저장되지 않는다. 승인하면 `bannedPhrases`로 옮겨지고 본인 확인은 유지된다. 후보에 없던 글은 승인할 수 없다
  - 한도를 넘으면 `over_limit`이고 기록이 바뀌지 않는다. AI가 거절하면 `refused`이고 기록이 바뀌지 않는다
  - 내용을 고치면 판정과 후보가 지워진다(`rubricAfterContentEdit` 뒤 `phraseCandidates`도 비움)
  - `listEvidenceTodos`는 본인의 증빙 미달 기록만
- [ ] **Step 2~4: 실패 확인, 구현, 통과 확인, Commit** `feat: AI 루브릭 판정과 금지 표현 후보`

---

### Task 3: AI 인터뷰

**Files:** Create `src/modules/experiences/interview.ts`, `src/modules/experiences/interview.test.ts`, `src/modules/experiences/grounding.ts`, `src/modules/experiences/grounding.test.ts`. Modify `schema.ts`, `prompts.ts`, `drizzle/`

**Interfaces:**
- 테이블 `experiences_interviews`: `id`, `userId`(cascade), `experienceId null`(→ experiences, cascade. 있으면 보완 인터뷰), `trackId null`(→ tracks, set null. 직무에 맞는 질문용), `messages jsonb`(`{ role: "user" | "assistant"; text }[]`), `status`(`active` / `done`), `createdAt`, `updatedAt`
- `interview.ts`:
  - `startInterview(db, ai, userId, { experienceId?, trackId? }, now): Promise<{ ok: true; id; message } | ...>` — 첫 질문을 받아 저장한다. 보완 인터뷰면 기록의 현재 내용과 미달 항목·보완 방안을 AI에게 알려 준다
  - `answerInterview(db, ai, userId, interviewId, text, now): Promise<{ ok: true; message; suggestFinish: boolean } | ...>` — 턴 응답 스키마 `{ message: string; enough: boolean }`. 답 30개를 넘으면 `too_long`
  - `draftFromInterview(db, ai, userId, interviewId, now): Promise<{ ok: true; draft: ExperienceInput; warnings: Partial<Record<keyof ExperienceInput, string>> } | ...>` — 대화를 기록 초안으로 바꾼다. 결과를 `validateExperience`로 한 번 더 검사하고, `grounding`으로 대화에 없던 숫자를 찾는다. 보완 인터뷰면 기존 기록에 덧붙인 전체 기록을 돌려준다. 저장은 하지 않는다(사용자가 폼에서 확인 후 저장)
  - `getInterview(db, userId, id)`, `finishInterview(db, userId, id)`
- `grounding.ts`: `ungroundedNumbers(draft, sources: string[]): Partial<Record<field, string[]>>` — 초안의 각 칸에 있는 숫자 중, 사용자가 쓴 글(인터뷰의 사용자 답, 보완이면 기존 기록)에 없는 것을 찾는다. `1,200`과 `1200`, 전각 숫자는 같은 것으로 본다. 기간 칸은 형식이 달라도(`2023년 3월` ↔ `2023-03`) 같은 것으로 본다
- `prompts.ts`: 인터뷰와 정리용 시스템 프롬프트. 담을 것:
  - 인터뷰: 한 번에 질문 하나, 상황 → 본인이 한 일(팀이 한 일과 구분) → 수준과 하지 않은 것 → 결과와 수치(기준·근거) → 증빙 순서, 사용자가 모른다고 하면 넘어간다, 답을 대신 지어내거나 유도하지 않는다, 트랙의 직무에 맞는 질문을 한다
  - 정리: 사용자가 말한 것만 쓴다. 말하지 않은 칸은 비운다. 숫자·역할·기간을 새로 만들지 않는다. "하지 않은 것"은 사용자가 그렇게 말한 것만

- [ ] **Step 1: 실패하는 테스트** (가짜 AI 사용)
  - 시작하면 첫 질문이 저장되고, 답하면 대화가 순서대로 쌓인다
  - 다른 사용자의 인터뷰는 읽히지 않고 답할 수 없다. 남의 기록이나 남의 트랙으로 시작할 수 없다
  - 답 30개를 넘으면 `too_long`, 4,000자를 넘는 답은 거부
  - 보완 인터뷰를 시작할 때 AI에게 미달 항목과 보완 방안이 전달된다(가짜 AI가 받은 요청으로 확인)
  - 정리: 초안이 `validateExperience`를 통과한 형태다. 가짜 AI가 형식이 틀린 초안(끝 월이 시작보다 앞섬)을 주면 그 칸에 경고가 붙거나 `invalid`다
  - **숫자 검사**: 사용자가 "5건에서 1건"이라고만 했는데 초안에 "30% 단축"이 있으면 그 칸에 경고 `대화에 없던 숫자가 있습니다: 30`이 붙는다. 사용자가 말한 숫자는 경고가 없다. `1,200건`과 `1200건`은 같은 것으로 본다
  - 정리는 기록을 저장하지 않는다. 폼에서 저장하면 미확인 기록이 된다
  - 연락처가 가려져 전달된다. 사용량이 턴마다 기록된다
  - 끝낸 인터뷰에는 답할 수 없다. 기록을 지우면 그 기록의 인터뷰도 지워진다
- [ ] **Step 2~4: 실패 확인, 구현, 통과 확인, Commit** `feat: AI 인터뷰와 기록 초안 정리`

---

### Task 4: 화면

**Files:** Create `src/app/(app)/experiences/interview/[interviewId]/page.tsx`, `src/app/(app)/experiences/interview/chat.tsx`(클라이언트), `src/dev/local-ai.ts`. Modify `src/modules/experiences/actions.ts`, `src/app/(app)/experiences/page.tsx`, `rubric-panel.tsx`, `experience-form.tsx`, `next.config.ts`

**화면**
- 기록 목록: `기록 추가` 옆에 `AI 인터뷰로 추가`. 위에 `증빙 할 일`(있을 때만). 아래에 이번 달 AI 사용량
- 검증 패널:
  - `AI 판정 받기` 버튼(판정 중에는 `판정 중…`). 저장하지 않은 변경이 있으면 막는다
  - 미달 항목 아래에 보완 방안 글. 미달이 하나라도 있으면 `지금 보완하기` → 보완 인터뷰
  - `과장으로 읽힐 수 있는 표현` 후보: 각각 `금지 목록에 넣기` / `괜찮아요`
  - 3-1의 "다음 단계에서 AI가 확인합니다" 안내를 "AI 판정을 받으면 확인됩니다"로 바꾼다
  - 한도 초과, 거절, 내용 변경(`changed`)은 각각 한국어 안내
- 인터뷰 화면: 대화 말풍선, 아래 입력 칸과 `보내기`, `기록으로 정리하기`. AI가 충분하다고 하면 정리 버튼을 강조한다. 답을 기다리는 동안 입력을 막고 `생각 중…`
- 정리 결과: 같은 입력 폼에 초안이 채워져 있다. 위에 `AI가 대화를 정리한 초안입니다. 확인하고 고친 뒤 저장해 주세요`. 숫자 경고가 있는 칸에는 경고 글. 저장하면 미확인 기록이 되고 판정이 한 번 자동으로 돈다
- 로컬 미리보기: `LOCAL_PREVIEW=1`이면 `AiClient`를 `src/dev/local-ai.ts`(정해진 답)로 바꿔 끼운다. 실제 API를 부르지 않는다

- [ ] **Step 1: 서버 액션** (`requireUser()` → 모듈 함수 → `revalidatePath`)
- [ ] **Step 2: 검증 패널** (판정, 보완 방안, 후보 승인·거절)
- [ ] **Step 3: 인터뷰 화면과 정리 결과**
- [ ] **Step 4: 로컬 미리보기로 브라우저 확인** — 판정 → 미달 표시 → 보완 인터뷰 → 정리 → 저장 → 다시 판정 → 확인 → 확인됨, 새 인터뷰로 기록 만들기, 숫자 경고, 후보 승인, 한도 초과 안내. 사진을 사용자에게 보낸다
- [ ] **Step 5: 전체 테스트·빌드·린트, Commit** `feat: AI 판정과 인터뷰 화면`

---

### Task 5: 실제 AI로 확인하고 배포

- [ ] **Step 1: API 키** — 사용자가 Anthropic 콘솔에서 키를 만들어 Vercel 환경 변수 `ANTHROPIC_API_KEY`(Production)에 넣는다. 콘솔에서 월 지출 한도도 걸어 둔다
- [ ] **Step 2: 실제 호출 점검** — 가짜 AI로는 프롬프트의 품질을 알 수 없다. 사용자 동의를 받아 이 세션에서 실제 API로 점검한다(예상 비용 1달러 미만). 준비한 예시 기록 6개(구체적인 것, 본인 역할이 흐린 것, 수치 근거가 없는 것, 과장 표현이 있는 것 등)를 판정시켜 기대한 항목이 미달로 나오는지, 예시 대화 2개를 정리시켜 말하지 않은 내용을 만들어 내지 않는지 본다. 결과를 표로 사용자에게 보여 주고, 기대와 다르면 프롬프트를 고친다
- [ ] **Step 3: PR을 만들고 사용자 확인 후 합친다.** 사용자가 실제 주소에서 판정과 인터뷰를 한 번씩 해 본다
- [ ] **Step 4: 3-3번 계획(가져오기)을 작성한다**

## 이 계획에서 하지 않는 것

- 가져오기(붙여 넣기, PDF, 워드): 3-3
- 개인 API 키 등록, 관리자의 사용량 화면과 한도 설정: 7번 계획. 이 계획은 사용량 기록과 고정 월 한도까지만 만든다
- 실시간 출력, 인터뷰 음성 입력
- AI 판정 결과를 사용자가 직접 뒤집는 기능("AI는 미달이라지만 충족으로"): 필요하면 써 본 뒤 정한다. 지금은 내용을 보완해 다시 판정받는 길만 둔다

## 구현하면서 달라진 점

- 판정 결과를 "읽었을 때의 내용에만" 반영하는 기준을 `updatedAt` 대신 새 칸 `contentVersion`(내용이 바뀔 때마다 1 증가)으로 했다. DB의 시각은 마이크로초, 코드의 시각은 밀리초라 같은지 비교하면 어긋난다
- 판정은 항목마다 `jsonb_set`으로 DB 안에서 바꾼다. 판정을 기다리는 사이 사용자가 닫은 항목을 덮어쓰지 않는다
- 대체 모델(`fallbacks: "default"`)은 `client.beta.messages.parse`에서 함께 쓸 수 있어 켰다
- 인터뷰의 답을 덧붙일 때, 읽었을 때의 대화 길이와 같을 때만 저장한다(같은 답이 두 번 들어가는 것을 막는다)
- 앱이 쓰는 AI는 `src/modules/ai/provider.ts`에서 내보낸다. 로컬 미리보기는 이 파일을 `src/dev/local-ai.ts`로 바꿔 끼운다
- 실제 호출 점검(Task 5 Step 2)은 이 세션에서 하지 못한다. 세션이 Claude API 주소에 사용자 키를 받아 쓰는 것을 막고 있다. 대신 관리 화면에 `AI 프롬프트 점검` 버튼을 만들었다(`src/modules/experiences/prompt-check.ts`). 배포된 앱에서 Vercel의 키로 예시 기록 6개와 예시 대화 2개를 돌려 기대와 실제를 표로 보여 준다. 프롬프트나 모델을 바꿀 때마다 다시 돌린다
