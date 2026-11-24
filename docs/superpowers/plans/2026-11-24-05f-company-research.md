# Job Hunter 5-6번 계획: 회사 조사 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 공고를 `지원`으로 정하면 Claude 웹 검색으로 그 회사의 인재상과 최근 소식을 출처와 함께 찾아 공고 화면에 보이고, 사용자가 `맞음`·체크한 것만 지원동기 묻기와 자소서 쓰기에 쓴다. 회사 정보가 근거인 문단은 "회사 정보: (출처)"로 보이고, 그 숫자는 숫자 검사에서 허용한다.

**Architecture:** `runAi()`가 웹 검색 서버 도구(`web_search_20260209`)를 쓸 수 있게 넓히고, 검색 결과 주소와 검색 횟수를 돌려받아 사용량에 검색 요금을 더한다. 조사 결과는 사용자·회사(`companyKey`) 단위의 새 표 `postings_research`에 두고, 지원 때 `after()`로 뒤에서 돌린다. 쓰기·고치기·묻기는 확인한 회사 정보를 C1, C2 별명으로 받고, 답(draft)에는 보낸 회사 정보를 그대로 복사해 둔다(검사·근거 표시·제출본은 그 복사본을 쓴다).

**Tech Stack:** Next.js 16(App Router, `after`), Drizzle + Postgres(테스트는 PGlite), zod, Vitest, `@anthropic-ai/sdk` 1.9.0(웹 검색 타입이 이미 있어 올리지 않는다)

**Spec:** `docs/superpowers/specs/2026-11-20-records-and-documents-design.md`의 5.5(동기포부형 재료), 5.7 회사 조사, 6(회사 조사 표·`runAi`·`AiPurpose`), 7, 9장 3번

## 정한 것 (설계가 빌더에게 맡긴 것과 사용자 답)

- **새 표** `postings_research` 하나(「결정」 2026-11-24 사용자 승인). 사용자·회사 이름 정리 값(`companyKey`)마다 한 줄. 같은 회사의 다른 공고에서 다시 쓴다. 회사 이름 정리 값이 빈 글이면 조사하지 않는다
- **묻기에도 쓴다**(「결정」 2026-11-24 사용자, 설계에 없던 것): 확인한 회사 정보를 지원동기·입사 후 포부 질문을 만들 때 연결고리 거리로 보낸다. 글의 재료가 되는 것은 여전히 사용자가 고른 답과(쓰기에서) 확인한 회사 정보뿐이다
- **웹 검색 요청의 모양**: `AiRequest.webSearch = { maxUses: 5; allowedDomains?: string[] }`. 웹 검색이 있는 요청은 늘 `loose`로 보낸다(검색 결과에는 인용이 붙고, 인용과 `output_config.format`을 함께 쓰면 API가 거절할 수 있다). 도구는 `{ type: "web_search_20260209", name: "web_search", max_uses, allowed_domains, allowed_callers: ["direct"] }`. `allowed_callers: ["direct"]`는 검색을 코드 실행 안에서 부르지 않게 해, 결과(`web_search_tool_result`)가 답에 그대로 오게 한다(코드가 출처 주소를 확인하려면 이 블록이 있어야 한다). 실제 AI로 돌린 프롬프트 점검에서 API가 이 값을 거절하거나 출처가 비면 `web_search_20250305`로 바꾸고 "달라진 점"에 적는다
- **`pause_turn`**: 서버 쪽 검색 반복이 멈추면 받은 `content`를 assistant 메시지로 붙여 2번까지 이어 부른다. 토큰·검색 횟수·출처는 이어 부른 것까지 더한다. 그래도 `pause_turn`이면 `truncated`
- **검색 요금**: 검색 한 번에 10,000 마이크로달러(1,000번에 10달러). `TokenUsage`에 `webSearchRequests?: number`(없으면 0)를 더하고 `costMicroUsd`가 더해 센다. `ai_usage`에 `web_search_requests integer not null default 0` 칸을 더한다(7번 계획에서 목적별 비용을 볼 때 쓴다). 목적은 `company_research` 하나를 더한다
- **보내는 것**: 회사 이름, 공고 제목, 회사 홈페이지 도메인(있을 때), 인재상을 찾을지, 오늘 날짜(한국). 지원자 정보·공고 원문은 보내지 않는다
- **홈페이지 도메인**(`homepageDomain(rawText, postingUrl)`): 공고 원문의 `http(s)://` 주소와 `www.` 주소에서 앞에서부터 처음 나오는 호스트 중, 채용 사이트(`saramin.co.kr`, `jobkorea.co.kr`, `wanted.co.kr`, `incruit.com`, `jobplanet.co.kr`, `catch.co.kr`, `linkedin.com`, `rocketpunch.com`, `jasoseol.com`, `work.go.kr`, `albamon.com`, `alba.co.kr`, `programmers.co.kr`, `remember.co.kr`, `greetinghr.com`, `ninehire.com`, `notion.site`, `forms.gle`, `google.com`, `naver.com`, `kakao.com`의 그 도메인과 하위 도메인)도 아니고 공고 주소의 호스트도 아닌 것. `www.`를 뗀 소문자 호스트를 돌려준다. 없으면 null. 인재상 검색만 이 도메인으로 좁히고 최근 소식은 좁히지 않는다: 한 번의 AI 호출 안에서 좁히기를 나눌 수 없으므로, 도메인이 있고 인재상을 찾을 때는 AI를 두 번 부른다(인재상: `allowedDomains`, `maxUses` 2 / 소식: 좁히지 않음, `maxUses` 3). 도메인이 없으면 한 번(`maxUses` 5)
- **인재상을 찾지 않는 경우**: 그 공고의 인재상 글(`companyNote`)이 비어 있지 않거나 공고 원문에 "인재상"이라는 낱말이 있으면 찾지 않고 `talentSkipped: true`로 둔다
- **AI 답의 모양**(loose, zod): `{ talent: { text: string; url: string } | null; news: { summary: string; date: string | null; url: string }[] }`. 숫자는 AI에게 받지 않고 코드가 요약에서 뽑는다(`numbersIn`)
- **코드의 검사**(`cleanResearch`): 주소는 해시·끝의 `/`를 뗀 값이 이번 검색 결과 주소 중 하나와 같아야 남는다. 인재상은 홈페이지 도메인이 있으면 그 도메인(하위 도메인 포함)의 주소여야 한다. 요약은 다듬어 300자, 인재상 글은 500자로 자르고 빈 것은 버린다. 날짜는 `YYYY-MM-DD`이고 실제 날짜이고 오늘(한국) 이후가 아니어야 하고, 아니면 null("날짜 모름"). 같은 주소·같은 요약은 한 번. 소식은 많아야 8개. 출처 제목은 검색 결과의 `title`을 쓴다
- **표의 칸**: `id`, `user_id`, `company_key`(사용자와 함께 유일), `company`(보일 이름), `status`(`running` / `done` / `failed`), `failure`(`not_found` / `over_limit` / `unavailable` / null), `started_at`, `researched_at`(null = 아직 끝난 적 없음), `talent` jsonb `{ id, text, url, title, verdict: "yes" | "no" | null } | null`, `talent_skipped` boolean, `news` jsonb `{ id, summary, date, url, title, checked }[]`, `updated_at`. 다시 조사하는 동안에는 지난 결과를 그대로 두고, 끝나면 새 결과로 바꾼다(맞음·체크도 새로 한다)
- **한 번에 하나만**: 조사를 시작할 때 `running`으로 잡는다(잠금 대신 `insert … on conflict do update … where`로). 이미 `running`이고 5분이 지나지 않았으면 시작하지 않는다. 5분이 지난 `running`은 끝나지 않은 것으로 보고 화면에 "조사가 끝나지 않았습니다"와 `다시 조사`를 보인다. 결과는 잡은 `started_at`이 그대로일 때만 저장한다(늦게 끝난 옛 조사가 새 조사를 덮지 않는다)
- **자동으로 돌리는 때**: `applyToPostingAction`이 지원으로 정한 뒤, 그 회사의 조사 줄이 아예 없을 때만 `after()`로 돌린다. 실패했거나 오래된 조사는 자동으로 다시 돌리지 않는다(돈). 화면의 `다시 조사`는 지원 공고에서만 보인다. `after()`는 그 페이지의 최대 실행 시간 안에서 돈다: 지원 단추(`posting-actions.tsx`)와 `다시 조사`가 있는 `postings/[id]/page.tsx`에 `export const maxDuration = 300`
- **오래된 조사**: `researched_at`이 90일 넘게 지났으면 "오래된 조사입니다(YYYY-MM-DD)"와 `다시 조사`를 함께 보인다
- **실패 문구**: `over_limit`은 "이번 달 AI 사용 한도에 닿아 조사하지 못했습니다", 그 밖(`not_found`·`unavailable`·끝나지 않음)은 "찾지 못했습니다. 인재상을 붙여 넣어 주세요"와 공고 고치기(`/postings/[id]/edit`, 인재상·회사 소개 칸) 링크. 검색 결과(출처)가 하나도 없거나 검사 뒤 인재상·소식이 모두 비면 `not_found`
- **고르기 기본값**: 인재상은 `verdict: null`(`맞음`·`아님` 단추), 소식은 모두 체크 안 함. 사용자가 고른 것만 쓴다(반목표: 회사 정보를 지어내거나 출처에 없는 내용을 쓰기). 조사 중에는 고르기를 끈다
- **쓰기에 보내는 회사 정보**(`companyFacts(research)`): `verdict: "yes"`인 인재상과 체크한 소식. `CompanyFact = { id; kind: "talent" | "news"; text; url; title; date }`. 유형에 동기포부형(`motive`)이 있는 문항에만 보낸다. 묻기는 주제가 지원동기·입사 후 포부일 때만 보낸다
- **답에 남기는 것**: `Paragraph.company?: string[]`(회사 정보 id), `Draft.companyFacts?: CompanyFact[]`(쓸 때 보낸 것의 복사본). 옛 답에는 둘 다 없다(빈 배열로 본다)
- **검사**: 문단의 `company` 중 그 답의 `companyFacts`에 있는 것의 글 숫자는 허용한다. 지금 쓸 수 있는 회사 정보(`companyFacts(research)`의 id)에 없는 id가 있으면 `staleSource`(다시 조사했거나 체크를 풀었다). **회사 정보만 근거인 문단은 `noSource`로 본다**: 회사 정보는 지원자의 이야기가 아니므로, 지시문도 회사 정보를 내 답이나 경험과 같은 문단에서 잇게 한다
- **고치기**: 답의 `companyFacts` 중 지금 쓸 수 없게 된 것이 있으면 `stale`이고 AI를 부르지 않는다. 아니면 복사본을 그대로 다시 보낸다
- **근거 표시와 제출본**: "회사 정보: (출처 호스트, `www.` 뗌)". 제출본은 답의 근거처럼 경험 근거 목록에 `{ experienceId: 회사 정보 id, name: "회사 정보: 호스트" }`로 얼린다(5-5의 "내 답"과 같은 방식)
- **자소서 화면**: 동기포부형 문항 카드에 "회사 정보 n개를 함께 씁니다 · 공고 화면에서 고르기" 한 줄(0개면 "공고 화면에서 회사 조사를 확인하면 지원동기에 쓸 수 있습니다")

## Global Constraints

- `CLAUDE.md`, `docs/conventions.md`의 데이터 접근 규칙과 AI 사용 규칙, 앞 계획들의 Global Constraints를 따른다: AI 호출은 `runAi()`, 모델 `claude-sonnet-5-5`, 연락처는 AI에 보내지 않음, 테이블 이름은 `<모듈>_<이름>`
- 새 표는 `user_id`가 `auth_user(id)`를 `on delete cascade`로 참조하고, repo 함수의 첫 두 인자는 `(db, userId)`, 모든 쿼리에 `userId` 조건, "다른 사용자의 것은 읽히지 않는다" 테스트를 둔다
- 우리 서버는 검색 결과 페이지를 열지 않는다. 새 외부 서비스에 가입하지 않는다(설계 5.7)
- 반목표: 회사 정보를 지어내거나 출처에 없는 내용을 회사 정보로 쓴다 / 회사 정보나 공고 문구를 지원자가 한 일처럼 쓴다 / 지원자가 답하지 않은 동기를 지어 쓴다
- 제출로 잠긴 공고의 자소서는 바꾸지 않는다(`withEditLock`). 회사 조사의 맞음·체크는 회사 단위라 잠금과 상관없이 바꿀 수 있다(얼린 제출본은 바뀌지 않는다)
- 화면을 바꾸면 `LOCAL_PREVIEW=1`로 로컬 미리보기를 띄워 확인하고 사진을 사용자에게 보낸다
- 새 AI 작업과 바뀐 지시문마다 프롬프트 점검(`prompt-check`)에 예시를 더한다
- 판단표 ②: 모든 PR이 `schema.ts`·`drizzle/**`·`src/modules/ai/**`·`src/dev/**`·`CLAUDE.md` 중 하나를 바꾸므로 합치기 전에 사용자에게 묻는다

## Review Focus

1. AI가 검색 결과에 없는 주소를 출처로 적거나, 출처와 다른 회사의 소식을 가져온다 → 주소가 이번 검색 결과에 없으면 버려지고, 인재상은 홈페이지 도메인 밖이면 버려진다 (Task 2 테스트 "검색 결과에 없는 주소는 버린다", "인재상은 홈페이지 도메인 밖이면 버린다")
2. 지원을 두 탭에서 누르거나, 조사 중에 `다시 조사`를 누르거나, 조사가 서버에서 끊긴다 → 한 번만 돌고 돈을 두 번 쓰지 않으며, 끊긴 조사는 5분 뒤 다시 조사할 수 있고, 늦게 끝난 옛 조사는 저장되지 않는다 (Task 2 테스트 "running이면 다시 잡지 않는다", "5분 지난 running은 다시 잡는다", "잡은 started_at이 바뀌었으면 저장하지 않는다")
3. 조사 뒤 사용자가 소식 체크를 풀거나 `다시 조사`를 한다 → 이미 쓴 문단은 "바뀜"으로 보이고, 그 답의 `고치기`는 AI를 부르지 않고 다시 쓰기를 권한다 (Task 6 테스트 "쓸 수 없게 된 회사 정보는 staleSource", Task 5 테스트 "고치기는 쓸 수 없게 된 회사 정보가 있으면 stale")
4. AI가 회사 소식의 숫자("영업이익 30% 늘어")를 지원자가 한 일처럼 쓰거나 회사 정보만으로 문단을 채운다 → 그 숫자는 회사 정보를 근거로 단 문단에서만 허용되고, 회사 정보만 근거인 문단은 "근거 없음"으로 표시된다 (Task 6 테스트 "회사 정보 숫자는 그 정보를 단 문단에서만 허용", "회사 정보만 근거면 noSource")
5. 이번 달 한도를 다 쓴 사용자가 지원한다 / 조직 설정에서 웹 검색이 꺼져 있다 → 지원은 성공하고, 조사는 실패로 남아 알맞은 문구와 인재상 붙여 넣기 링크가 보인다 (Task 3 테스트 "한도에 닿으면 over_limit로 남긴다", "AI가 unavailable이면 실패로 남긴다")

---

# PR 1: 웹 검색과 회사 조사 화면

## Task 1: `runAi()`의 웹 검색과 검색 요금

**Files:**
- Modify: `src/modules/ai/client.ts`, `src/modules/ai/anthropic-client.ts`, `src/modules/ai/fake-client.ts`, `src/modules/ai/pricing.ts`, `src/modules/ai/usage.ts`, `src/modules/ai/schema.ts`, `src/modules/ai/ai.test.ts`
- Create: `src/modules/ai/web-search.ts`, `src/modules/ai/web-search.test.ts`, `drizzle/0022_*.sql`(`npm run db:generate`)

**Interfaces:**
- Produces (`client.ts`):
  ```ts
  // AiPurpose에 "company_research"를 더한다
  export type WebSource = { url: string; title: string; pageAge: string | null };
  // AiRequest에 더함. 있으면 웹 검색 서버 도구를 붙이고 늘 loose로 보낸다
  webSearch?: { maxUses: number; allowedDomains?: string[] };
  // AiResult에 더함. 웹 검색을 쓴 요청에서만 온다(성공·실패 모두). 이번 호출의 검색 결과 주소(같은 주소는 한 번)
  sources?: WebSource[];
  ```
- Produces (`pricing.ts`): `TokenUsage`에 `webSearchRequests?: number`. `export const WEB_SEARCH_MICRO_USD = 10_000;` `costMicroUsd`가 `(usage.webSearchRequests ?? 0) * WEB_SEARCH_MICRO_USD`를 더한다
- Produces (`schema.ts`): `aiUsage.webSearchRequests: integer("web_search_requests").notNull().default(0)`. `recordUsage`가 채운다
- Produces (`web-search.ts`, SDK의 베타 메시지 타입을 받는 순수 함수):
  ```ts
  // content의 web_search_tool_result 블록에서 결과 주소를 모은다. content가 오류 객체인 블록은 건너뛴다
  export function collectSources(content: BetaContentBlock[]): WebSource[];
  // 여러 응답(이어 부른 것)을 합친다: 토큰은 더하고, 검색 횟수는 usage.server_tool_use?.web_search_requests를 더하고, 출처는 주소로 중복 없이
  export function mergeUsage(a: TokenUsage, b: TokenUsage): TokenUsage;
  export function mergeSources(a: WebSource[], b: WebSource[]): WebSource[];
  export const MAX_CONTINUATIONS = 2;
  ```
- `anthropic-client.ts`: `webSearch`가 있으면 loose 길로 보내고 `tools`에 위 "정한 것"의 도구 하나를 넣는다. `stop_reason === "pause_turn"`이면 `messages`에 `{ role: "assistant", content: response.content }`를 붙여 `MAX_CONTINUATIONS`번까지 다시 부른다. `toUsage`는 `server_tool_use?.web_search_requests`를 읽는다. 답 글은 모든 `text` 블록을 이어 붙인 것(인용으로 나뉘어 와도 잇는다)
- `fake-client.ts`: 준비한 답으로 `{ web: { answer: unknown; sources: WebSource[]; searches: number } }`를 받으면 `answer`를 스키마로 검사하고 결과에 `sources`와 `usage.webSearchRequests = searches`를 담는다

- [ ] **Step 1: 실패하는 테스트를 쓴다**
  - `ai.test.ts`: "검색 3번이면 토큰 값에 3만 마이크로달러를 더한다", "검색 횟수가 없으면 0으로 센다", "recordUsage가 검색 횟수를 남긴다", "웹 검색 요청도 runAi가 한도를 먼저 보고 사용량에 검색 요금까지 센다"(가짜 AI `{ web: … searches: 2 }` → `ai_usage` 줄의 `webSearchRequests` 2, 비용에 2만 포함)
  - `web-search.test.ts`: "결과 블록의 주소·제목·page_age를 모은다", "오류 결과 블록(`web_search_tool_result_error`)은 건너뛴다", "다른 블록(text, server_tool_use)은 무시한다", "mergeUsage는 토큰과 검색 횟수를 더한다", "mergeSources는 같은 주소를 한 번만 둔다"
- [ ] **Step 2: 돌려서 실패를 본다** — `npx vitest run src/modules/ai`
- [ ] **Step 3: 구현한다.** 스키마를 고친 뒤 `npm run db:generate`로 `0022` 마이그레이션을 만든다. SDK 타입은 `node_modules/@anthropic-ai/sdk/resources/beta/messages/messages.d.ts`의 `BetaWebSearchTool20260209`, `BetaWebSearchResultBlock`, `BetaServerToolUsage`를 쓴다
- [ ] **Step 4: 돌려서 통과를 본다** — 같은 명령 PASS, `npx tsc --noEmit`
- [ ] **Step 5: 커밋** — `feat: runAi가 웹 검색 서버 도구를 쓰고 검색 요금을 사용량에 센다`

## Task 2: 조사 표, 결과 검사, 홈페이지 도메인

**Files:**
- Modify: `src/modules/postings/schema.ts`, `src/modules/postings/options.ts`
- Create: `src/modules/postings/research.ts`, `src/modules/postings/research.test.ts`, `src/modules/postings/research-repo.ts`, `src/modules/postings/research-repo.test.ts`, `drizzle/0023_*.sql`

**Interfaces:**
- Consumes: Task 1의 `WebSource`, `companyKey`(`postings/company.ts`), `numbersIn`(`experiences/grounding`)
- Produces (`options.ts`): `RESEARCH_LIMITS = { news: 8, summary: 300, talent: 500, staleDays: 90, runningMinutes: 5 }`
- Produces (`research.ts`, 순수 함수):
  ```ts
  export type Talent = { id: string; text: string; url: string; title: string; verdict: "yes" | "no" | null };
  export type NewsItem = { id: string; summary: string; date: string | null; url: string; title: string; checked: boolean };
  export type ResearchFailure = "not_found" | "over_limit" | "unavailable";
  export type CompanyFact = { id: string; kind: "talent" | "news"; text: string; url: string; title: string; date: string | null };
  export type RawResearch = { talent: { text: string; url: string } | null; news: { summary: string; date: string | null; url: string }[] };
  export function homepageDomain(rawText: string, postingUrl: string | null): string | null;
  export function wantsTalent(posting: { rawText: string; companyNote: string | null }): boolean;
  // id는 randomUUID. wantTalent가 false면 talent는 null
  export function cleanResearch(raw: RawResearch, sources: WebSource[], opts: { wantTalent: boolean; domain: string | null; today: string }): { talent: Talent | null; news: NewsItem[] };
  export function companyFacts(r: { talent: Talent | null; news: NewsItem[] }): CompanyFact[]; // 맞음인 인재상 먼저, 체크한 소식은 저장 순서
  export function factNumbers(fact: CompanyFact): string[]; // numbersIn(fact.text)
  export const hostOf = (url: string): string; // www. 뗀 호스트, 잘못된 주소면 url 그대로
  export function researchState(r: Pick<Research, "status" | "startedAt" | "researchedAt"> | null, now: Date): "none" | "running" | "stuck" | "done" | "stale" | "failed";
  ```
- Produces (`schema.ts`): `researches = pgTable("postings_research", …)` — 칸은 "정한 것"의 표의 칸. `unique("postings_research_user_company").on(t.userId, t.companyKey)`
- Produces (`research-repo.ts`):
  ```ts
  export type Research = typeof researches.$inferSelect;
  export async function getResearch(db, userId, key: string): Promise<Research | null>;
  // 잡으면 잡은 startedAt, 못 잡으면 null. onlyIfMissing이면 줄이 없을 때만(자동 조사), 아니면 running이 아니거나 runningMinutes가 지났을 때(다시 조사)
  export async function claimResearch(db, userId, key: string, company: string, now: Date, opts: { onlyIfMissing: boolean }): Promise<Date | null>;
  export async function finishResearch(db, userId, key: string, startedAt: Date, result: { talent: Talent | null; talentSkipped: boolean; news: NewsItem[] }, now: Date): Promise<boolean>;
  export async function failResearch(db, userId, key: string, startedAt: Date, failure: ResearchFailure, now: Date): Promise<boolean>; // 지난 결과는 두고 status·failure만
  export async function setTalentVerdict(db, userId, key: string, talentId: string, verdict: "yes" | "no" | null): Promise<{ ok: true } | { ok: false; reason: "not_found" | "running" }>;
  export async function setNewsChecked(db, userId, key: string, newsId: string, checked: boolean): Promise<{ ok: true } | { ok: false; reason: "not_found" | "running" }>;
  ```

- [ ] **Step 1: 실패하는 테스트를 쓴다**
  - `research.test.ts`: `homepageDomain`: "원문의 회사 주소를 www. 떼고 돌려준다"(`"홈페이지: https://www.gana.co.kr/careers"` → `"gana.co.kr"`), "채용 사이트와 그 하위 도메인은 건너뛴다"(`https://www.saramin.co.kr/…`, `https://m.jobkorea.co.kr/…` 다음의 `www.gana.com` → `"gana.com"`), "공고 주소의 호스트는 건너뛴다", "주소가 없으면 null". `wantsTalent`: "인재상 글이 있으면 false", "원문에 '인재상'이 있으면 false", "둘 다 없으면 true". `cleanResearch`: "검색 결과에 없는 주소는 버린다", "끝의 /와 해시가 달라도 같은 주소로 본다", "인재상은 홈페이지 도메인 밖이면 버린다", "wantTalent가 false면 인재상은 null", "날짜가 형식에 안 맞거나 오늘 뒤면 null"(`"2026-13-01"`, `"11월 5일"`, `"2026-11-25"`(오늘 `2026-11-24`)), "소식은 8개까지", "같은 주소·같은 요약은 한 번", "요약 300자·인재상 500자로 자르고 빈 것은 버린다", "제목은 검색 결과의 title", "고르기 기본값은 verdict null·checked false". `companyFacts`: "맞음 인재상과 체크한 소식만", "아님·미정 인재상은 빠진다". `researchState`: "없으면 none", "running 4분은 running, 6분은 stuck", "끝난 지 91일이면 stale", "실패면 failed"
  - `research-repo.test.ts`: "onlyIfMissing은 줄이 있으면 잡지 않는다", "running이면 다시 잡지 않는다", "5분 지난 running은 다시 잡는다", "동시에 두 번 잡아도 하나만 잡힌다"(`Promise.all`), "잡은 started_at이 바뀌었으면 저장하지 않는다", "실패는 지난 결과를 지우지 않는다", "조사 중에는 맞음·체크가 running", "없는 id는 not_found", "다른 사용자의 조사는 읽히지도 바뀌지도 않는다"
- [ ] **Step 2: 돌려서 실패를 본다** — `npx vitest run src/modules/postings/research`
- [ ] **Step 3: 구현한다.** `claimResearch`는 `insert … onConflictDoUpdate({ target, set, setWhere })` 하나로 한다(`onlyIfMissing`이면 `onConflictDoNothing`). `npm run db:generate`로 `0023`을 만든다. `docs/conventions.md`의 모듈 목록에서 `postings`에 `postings_research`와 "회사 조사"를 더한다
- [ ] **Step 4: 돌려서 통과를 본다** — 같은 명령 PASS, `npx tsc --noEmit`
- [ ] **Step 5: 커밋** — `feat: 회사 조사 결과를 사용자·회사 단위로 두는 표와 결과 검사를 더한다`

## Task 3: 조사 돌리기, 지시문, 프롬프트 점검

**Files:**
- Modify: `src/modules/postings/prompts.ts`, `src/modules/postings/prompt-check.ts`, `src/modules/postings/prompt-check.test.ts`, `src/dev/local-ai.ts`, `src/dev/local-ai.test.ts`
- Create: `src/modules/postings/research-run.ts`, `src/modules/postings/research-run.test.ts`

**Interfaces:**
- Consumes: Task 1의 `runAi`·`webSearch`·`sources`, Task 2의 전부
- Produces (`research-run.ts`):
  ```ts
  export type ResearchInput = { company: string; title: string; domain: string | null; wantTalent: boolean; today: string };
  // 저장하지 않는다. 프롬프트 점검도 이것을 쓴다. 도메인이 있고 wantTalent면 AI 2번(인재상 maxUses 2 + allowedDomains, 소식 maxUses 3), 아니면 1번(maxUses 5)
  export async function researchText(db, ai, userId, input: ResearchInput, now?): Promise<{ ok: true; value: { talent: Talent | null; news: NewsItem[]; dropped: number } } | { ok: false; reason: ResearchFailure }>;
  // 잡기 → researchText → finish/fail. 잡지 못했으면 { started: false }. 공고가 없거나 회사 이름 정리 값이 비면 { started: false }
  export async function runResearch(db, ai, userId, postingId: string, opts: { onlyIfMissing: boolean }, now?): Promise<{ started: boolean }>;
  ```
- `RESEARCH_SYSTEM`(뜻): 회사 하나를 웹에서 찾아 지원자가 지원동기를 쓸 때 참고할 회사 정보를 모은다. 지원자 정보는 없다. [회사], [지원 직무], [홈페이지], [찾을 것](인재상 / 최근 소식), [오늘]. 인재상은 회사가 직접 밝힌 인재상·핵심가치를 회사 홈페이지에서만, 글은 회사가 쓴 낱말을 그대로 짧게. 최근 소식은 [오늘]부터 1년 안의 것으로 실적, 사업·제품, 투자·진출, 수상 위주, 사건·사고·소송·논란·인사 비리는 넣지 않는다. 같은 이름의 다른 회사 소식을 넣지 않는다. 소식마다 한두 문장 요약(검색한 글에 적힌 것만, 숫자는 글에 있는 그대로), 날짜(YYYY-MM-DD, 모르면 null), 그 글의 주소(검색 결과에 나온 주소 그대로). 찾지 못하면 talent는 null, news는 빈 배열. 지어내지 않는다(검색 결과에 없는 주소는 코드가 버린다). 답 모양은 loose 지시로 붙는다. 인재상만 찾는 호출과 소식만 찾는 호출은 같은 지시문에 [찾을 것]만 다르게 보낸다
- 실패 이유 바꾸기: `over_limit` → `over_limit`, `unavailable`·`refused`·`truncated` → `unavailable`, `invalid`·출처 0개·검사 뒤 모두 빔 → `not_found`. 인재상 호출과 소식 호출 중 하나만 성공하면 성공한 것만 저장한다
- `local-ai.ts`: `company_research`면 출처 2개(`https://www.example.com/careers`, `https://news.example.com/a1`)와 그 주소를 쓴 인재상·소식 하나를 돌려준다

- [ ] **Step 1: 실패하는 테스트를 쓴다** (`research-run.test.ts`, `createFakeAi`의 `{ web: … }`)
  - "도메인이 없으면 AI 한 번, 검색 5번까지", "도메인이 있고 인재상을 찾으면 AI 두 번이고 인재상 호출만 도메인으로 좁힌다"(`requests[0].webSearch.allowedDomains`), "인재상 글이 있는 공고는 인재상을 찾지 않고 talentSkipped", "AI에 회사 이름·제목·도메인·날짜만 보낸다"(보낸 글에 공고 원문의 한 줄·사용자 이름이 없음), "검사로 버린 수를 dropped로 돌려준다", "한도에 닿으면 over_limit로 남긴다", "AI가 unavailable이면 실패로 남긴다", "출처가 하나도 없으면 not_found", "소식 호출만 실패하면 인재상만 저장한다", "이미 조사 중이면 AI를 부르지 않는다", "회사 이름 정리 값이 비면 시작하지 않는다", "남의 공고는 시작하지 않는다"
  - `prompt-check.test.ts`: 새 예시의 행이 가짜 답으로 통과·실패하는지(기존 방식)
- [ ] **Step 2: 돌려서 실패를 본다** — `npx vitest run src/modules/postings/research-run.test.ts src/modules/postings/prompt-check.test.ts src/dev`
- [ ] **Step 3: 구현한다.** 프롬프트 점검에 회사 조사 예시 하나(AI 2번, 실제 웹 검색이라 검색 5번 요금이 든다): 회사 `삼성전자`, 제목 `SW 개발 신입`, 도메인 `samsung.com`, 인재상 찾기. 행: "인재상을 찾았다", "인재상 출처가 samsung.com이다", "소식 1~8개", "버린 소식(검색 결과에 없는 주소)이 2개 이하", "사건·사고 소식이 없다"(요약에 `사고|소송|논란|압수수색|벌금|사망|화재|리콜|구속`이 없음), "날짜가 있으면 1년 안". 실패하면 기존처럼 'AI가 보낸 답(진단용)' 줄을 남긴다
- [ ] **Step 4: 돌려서 통과를 본다** — 같은 명령 PASS, `npx tsc --noEmit`
- [ ] **Step 5: 커밋** — `feat: 공고의 회사를 웹 검색으로 조사해 인재상과 최근 소식을 출처와 함께 남긴다`

## Task 4: 조사 화면, 지원 때 자동 조사, 규칙 문서

**Files:**
- Modify: `src/modules/postings/actions.ts`(`applyToPostingAction`), `src/app/(app)/postings/[id]/page.tsx`(`maxDuration`, 구역 넣기), `CLAUDE.md`
- Create: `src/modules/postings/research-actions.ts`, `src/app/(app)/postings/[id]/research-section.tsx`, `src/app/(app)/postings/[id]/research-view.ts`, `src/app/(app)/postings/[id]/research-view.test.ts`

**Interfaces:**
- Consumes: Task 2의 repo·`researchState`·`hostOf`, Task 3의 `runResearch`
- Produces (`research-actions.ts`, `"use server"`): `rerunResearchAction(postingId)`(지원 공고일 때만 잡고 `after()`로 돌린 뒤 바로 돌려준다), `setTalentVerdictAction(postingId, talentId, verdict)`, `setNewsCheckedAction(postingId, newsId, checked)`. 회사 키는 서버가 공고에서 만든다. 결과 `{ ok: true } | { ok: false; message }`
- Produces (`research-view.ts`, 순수 함수): `researchView(r: Research | null, now: Date): { state; headline: string; staleNote: string | null; failure: string | null; canRerun: boolean; editable: boolean }` — 문구는 "정한 것"의 실패·오래된 조사 문구, 조사 중이면 "회사를 조사하는 중입니다(1분쯤 걸립니다)", 조사 전이면 "아직 조사하지 않았습니다"
- `applyToPostingAction`: 지원으로 정한 뒤 `after(() => runResearch(db, ai, user.id, id, { onlyIfMissing: true }).catch((e) => console.error("회사 조사 실패", e instanceof Error ? e.message : e)))`
- 화면(`research-section.tsx`, 지원 공고에서 제출 서류 구역 아래): 설계 5.7의 그림을 따른다. 머리 "회사 조사 ─ (회사)", 조사일, `다시 조사`(확인 창 "웹 검색으로 다시 조사합니다. AI 사용량이 듭니다"). 인재상 줄: 글, "출처: 호스트" 링크(새 탭, `rel="noopener noreferrer"`), `맞음`·`아님`(누른 쪽이 켜짐, 다시 누르면 미정). `talentSkipped`면 "공고의 인재상을 씁니다". 최근 소식: 체크 상자, 요약, "출처: 호스트 · 날짜(또는 날짜 모름)". 끝에 "체크한 것만 자소서(지원동기·포부)에 씁니다". 조사 중이면 5초마다 `router.refresh()`(조사 중일 때만, 5분 지나면 멈춤). 지원이 아닌 공고에서는 같은 회사의 조사가 있으면 읽기로만 보인다
- `CLAUDE.md`의 "주소로 공고를 읽는 기능은 …" 줄 끝에 "회사 조사는 Claude 웹 검색을 쓰고, 우리 서버는 페이지를 열지 않는다"를 덧붙인다

- [ ] **Step 1: 실패하는 테스트를 쓴다** (`research-view.test.ts`): "조사 중이면 고르기를 끄고 다시 조사를 숨긴다", "5분 지난 조사 중은 실패 문구와 다시 조사", "한도 실패는 한도 문구", "찾지 못함은 인재상 붙여 넣기 문구", "91일 지난 조사는 오래된 조사 문구와 날짜", "조사 전이면 다시 조사 단추가 '조사하기'"
- [ ] **Step 2: 돌려서 실패를 본다** — `npx vitest run "src/app/(app)/postings/[id]/research-view.test.ts"`
- [ ] **Step 3: 구현한다.** 먼저 `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/after.md`와 `…/02-route-segment-config/maxDuration.md`를 읽는다. 단추와 오류 줄은 기존 `posting-actions.tsx`·`documents-section.tsx`의 방식을 따른다. 체크·맞음은 누르면 바로 저장한다(타자 없음)
- [ ] **Step 4: 검사하고 화면을 확인한다** — 같은 명령 PASS, `npx tsc --noEmit`, `npm run lint`. `LOCAL_PREVIEW=1`로 공고 넣기 → 점수 → 지원 → 공고 화면에서 조사 중 → 결과(가짜 인재상·소식) → 맞음·체크 사진(휴대폰 폭 포함)을 사용자에게 보낸다
- [ ] **Step 5: 커밋** — `feat: 지원하면 회사를 조사하고 공고 화면에서 인재상·소식을 고르게 한다`

---

# PR 2: 회사 정보로 묻고 쓰기

## Task 5: 쓰기·고치기·묻기에 회사 정보 보내기

**Files:**
- Modify: `src/modules/applications/types.ts`, `src/modules/applications/write.ts`, `src/modules/applications/write.test.ts`, `src/modules/applications/ask.ts`, `src/modules/applications/ask.test.ts`, `src/modules/applications/prompts.ts`, `src/modules/applications/text.ts`, `src/modules/applications/text.test.ts`, `src/modules/applications/prompt-check.ts`, `src/modules/applications/prompt-check.test.ts`, `src/dev/local-ai.ts`

**Interfaces:**
- Consumes: Task 2의 `getResearch`, `companyFacts`, `CompanyFact`, `hostOf`; `companyKey`
- Produces (`types.ts`): `Paragraph.company?: string[]`, `Draft.companyFacts?: CompanyFact[]`
- Produces (`text.ts`): `export function companyAlias(raw: string): number | null;` — `"C1"` → 1(앞뒤 공백·소문자 허용, `answerAlias`와 같은 방식)
- Produces (`write.ts`): `WriteInput.companyFacts: CompanyFact[]`. `buildBase`에 `["회사 정보", …]`(없으면 "없음"): `C1 - 인재상: (글) (출처: 호스트)` / `C2 - 소식(날짜 또는 날짜 모름): (요약) (출처: 호스트)`. `cleanParagraph`가 C 별명을 보낸 회사 정보 id로 바꿔 `company`에 담는다. `approveAndWrite`는 유형에 `motive`가 있을 때만 `companyFacts(await getResearch(db, userId, companyKey(posting.company)))`를 보내고, 저장하는 답의 `companyFacts`에 그 복사본을 둔다. `reviseParagraph`는 답의 `companyFacts`가 지금 쓸 수 있는 회사 정보에 모두 있으면 복사본을 다시 보내고, 하나라도 없으면 `stale`
- Produces (`ask.ts`): `AskInput.companyFacts: CompanyFact[]`. `buildMessage`에 `["회사 정보", …]`(같은 모양, 별명 없이). `makeAsks`는 주제에 지원동기·입사 후 포부가 있을 때만 보낸다
- 지시문(뜻, 바뀌는 곳만):
  - `WRITE_SYSTEM`·`REVISE_SYSTEM`: [회사 정보]는 지원자가 출처를 보고 확인한 회사의 인재상과 소식이고 C1, C2 별명이 붙는다. 회사 정보는 회사 이야기(회사가 하는 일, 회사가 중요하게 여기는 것)에만 쓰고 지원자가 한 일·겪은 일처럼 쓰지 않는다. 회사 정보의 숫자는 그 회사 이야기에서만 그대로 쓴다. 회사 정보만으로 된 문단은 쓰지 않고, 그 정보가 지원자의 답(A)이나 경험(E)과 이어지는 문단에서 쓴다. 회사 정보를 쓴 문단은 sources에 C 별명도 적는다. [회사 정보]에 없는 회사 이야기(실적, 사업, 가치)는 공고 원문에 적힌 것 말고는 쓰지 않는다
  - `ASK_SYSTEM`: [회사 정보]도 연결고리 거리로 쓸 수 있다(예: 회사 소식 ↔ 지원자의 기록이나 관심). 회사 정보로 만든 연결고리는 link에 회사 정보를 짧게 적는다. 선택지는 지원자의 생각을 고르게 하는 말이고, 회사 정보를 지원자가 한 일처럼 적지 않는다

- [ ] **Step 1: 실패하는 테스트를 쓴다**
  - `text.test.ts`: `companyAlias`가 `"C1"`·`" c2 "`는 번호, `"E1"`·`"A1"`·`"C"`·`"C0"`는 null
  - `write.test.ts`: "동기포부형 문항에는 확인한 회사 정보를 C 별명으로 보낸다"(보낸 글에 `C1 - 인재상`, 체크 안 한 소식·아님 인재상의 글은 없음), "경험형만인 문항에는 회사 정보를 보내지 않는다", "C 별명을 회사 정보 id로 바꾸고 없는 별명은 버린다", "보낸 회사 정보를 답에 복사해 둔다", "조사가 없으면 회사 정보 없음으로 쓴다", "고치기는 쓸 수 없게 된 회사 정보가 있으면 stale이고 AI를 부르지 않는다", "고치기는 복사본을 다시 보낸다"
  - `ask.test.ts`: "지원동기 주제면 확인한 회사 정보를 보낸다", "성장과정만 물으면 보내지 않는다"
  - `prompt-check.test.ts`: 새 행이 가짜 답으로 통과·실패하는지
- [ ] **Step 2: 돌려서 실패를 본다** — `npx vitest run src/modules/applications/text.test.ts src/modules/applications/write.test.ts src/modules/applications/ask.test.ts src/modules/applications/prompt-check.test.ts`
- [ ] **Step 3: 구현한다.** 프롬프트 점검에 쓰기 예시 하나(AI 1번): 5-5의 지원동기 쓰기 예시(답 A1 "주문·결제처럼 많은 사람이 매일 쓰는 서비스를 안정적으로 만드는 일을 하고 싶다")에 회사 정보 C1 = 소식 "3분기 간편결제 거래액이 전년보다 40% 늘었다"를 더한다. 행: "C1을 단 문단이 있다", "그 문단에 A1도 있다", "40%는 C1을 단 문단에만 있다", "지원자가 거래액을 늘린 것처럼 쓰지 않는다"(글에 "늘렸"·"기여했"이 없음), "기록에 없는 숫자가 없다(회사 정보 숫자 허용)". 묻기 예시에 같은 C1을 더한 행 하나: "연결고리 중 하나에 간편결제가 나온다". `local-ai.ts`의 쓰기 가짜 답은 회사 정보가 있으면 첫 문단에 `C1`을 단다
- [ ] **Step 4: 돌려서 통과를 본다** — 같은 명령 PASS, `npx tsc --noEmit`
- [ ] **Step 5: 커밋** — `feat: 확인한 회사 정보를 지원동기 묻기와 자소서 쓰기·고치기에 보낸다`

## Task 6: 검사, 근거 표시, 제출본, 마무리

**Files:**
- Modify: `src/modules/applications/check.ts`, `src/modules/applications/check.test.ts`, `src/modules/applications/submit.ts`, `src/modules/applications/submit.test.ts`, `src/app/(app)/postings/[id]/application/answer-view.ts`, `src/app/(app)/postings/[id]/application/answer-view.test.ts`, `src/app/(app)/postings/[id]/application/page.tsx`, `src/app/(app)/postings/[id]/application/question-card.tsx`, `src/app/(app)/postings/[id]/application/draft-view.tsx`, `docs/status.md`, 이 문서

**Interfaces:**
- Consumes: Task 5의 `Paragraph.company`, `Draft.companyFacts`; Task 2의 `companyFacts`, `factNumbers`, `hostOf`
- Produces (`check.ts`): `CheckOptions.companyFactIds?: Set<string>`(지금 쓸 수 있는 회사 정보 id. 없으면 빈 집합). 문단의 `company` 중 답의 `companyFacts`에 있는 것의 숫자를 `known`에 더한다. `company`에 `companyFactIds`에 없는 id가 있으면 `staleSource`. `noSource`는 지금처럼 E·A만 본다
- Produces (`answer-view.ts`): `companyNames(facts: CompanyFact[]): Record<string, string>` — id → `회사 정보: 호스트`
- `submit.ts`: `freeze`가 문단의 `company`를 답의 `companyFacts`에서 찾아 `{ experienceId: id, name: "회사 정보: 호스트" }`로 얼린다(복사본에 없으면 "지운 회사 정보"). `submitPreview`의 검사도 `companyFactIds`를 넘긴다
- 화면: 문단의 근거 표시에 "회사 정보: 호스트"(링크 아님, 제목은 `title` 속성), 동기포부형 문항 카드에 "정한 것"의 한 줄

- [ ] **Step 1: 실패하는 테스트를 쓴다**
  - `check.test.ts`: "회사 정보 숫자는 그 정보를 단 문단에서만 허용"(C1 글 "40% 늘어" → C1을 단 문단의 `40%`는 통과, 달지 않은 문단의 `40%`는 ungrounded), "답의 복사본에 없는 회사 정보 id의 숫자는 허용하지 않는다", "쓸 수 없게 된 회사 정보는 staleSource", "회사 정보만 근거면 noSource", "옛 답(company·companyFacts 없음)은 그대로 검사된다"
  - `submit.test.ts`: "회사 정보 근거를 '회사 정보: 호스트'로 얼린다", "복사본에 없으면 '지운 회사 정보'"
  - `answer-view.test.ts`: `companyNames`가 `www.`를 뗀 호스트로 이름을 만든다
- [ ] **Step 2: 돌려서 실패를 본다** — `npx vitest run src/modules/applications/check.test.ts src/modules/applications/submit.test.ts "src/app/(app)/postings/[id]/application/answer-view.test.ts"`
- [ ] **Step 3: 구현한다**
- [ ] **Step 4: 전체 검사와 화면 확인** — `npm test`(전체), `npx tsc --noEmit`, `npm run lint` 모두 통과. 로컬 미리보기에서 지원 → 회사 조사에서 인재상 `맞음`·소식 하나 체크 → 자소서의 지원동기 문항에 "회사 정보 2개를 함께 씁니다" → 질문 받기(연결고리에 회사 정보) → 답 고르기 → 쓰기 → 문단 근거 "회사 정보: example.com" 사진(휴대폰 폭 포함)을 사용자에게 보낸다
- [ ] **Step 5: 문서를 고친다** — `docs/status.md`(5-6 끝, 다음 할 일 5-7, 남은 확인: 배포 뒤 Anthropic 콘솔 조직 설정에서 웹 검색이 켜져 있는지(빌더가 첫 조사 결과로 확인해 알림), 프롬프트 점검 호출 수와 검색 5번 요금, 실제 지원 공고 하나로 조사 결과의 출처가 맞는지·지원동기 글에 체크한 소식만 쓰였는지), 이 문서 끝에 "구현하다 달라진 점", "판단 기록", "판단표 점검"
- [ ] **Step 6: 커밋** — `feat: 회사 정보 근거를 검사·근거 표시·제출본에 '회사 정보'로 남긴다`

---

## 구현하다 달라진 점

### PR 1 (Task 1~4)

- **이어 부를 때의 검색 횟수**(검토): 처음에는 `pause_turn`으로 이어 부를 때마다 같은 `max_uses`를 다시 줘서 한 조사에 검색이 15번까지 나갈 수 있었다. 이어 부를 때는 남은 횟수만 주고, 0이면 더 부르지 않고 `truncated`로 끝낸다. 답 글은 처음 응답과 이어 부른 응답의 `text` 블록을 모두 순서대로 잇는다. 이어 부르는 도중 API 오류가 나도 앞서 쓴 토큰·검색은 사용량에 남긴다. `anthropic-client.test.ts`(SDK 모의)로 덮었다
- **홈페이지 도메인**(검토): "www.회사.com에서"처럼 주소에 조사·문장부호가 붙으면 호스트를 잘못 읽었다. 호스트는 ASCII 글자만 읽고 끝의 점을 뗀다. 건너뛰는 목록에 `bit.ly`, `youtu.be`, `youtube.com`, `instagram.com`, `facebook.com`, `x.com`, `twitter.com`, `daum.net`을 더했다
- **출처 주소**(검토): `cleanResearch`는 http(s) 주소만 남기고, 화면도 http(s)만 링크로 잇는다
- **맞음·체크 저장**: 같은 줄을 `select … for update`로 잠그고, 갱신에도 사용자 조건과 `updated_at`을 넣는다(검토)
- **두 번 부르는 조사는 함께 돌린다**(`Promise.all`): 차례로 부르면 기다림이 두 배라서. 둘 다 실패하면 무거운 이유(한도 > 서비스 오류 > 찾지 못함)를 남긴다. 예기치 않은 오류는 실패(`unavailable`)로 남기고 다시 던진다(`after()` 쪽이 기록한다)
- **조사 시작 대기**: 조사는 `after()` 안에서 잡히므로, 지원·다시 조사 직후에는 아직 `running`이 없다. 그래서 지원한 지 20초 안(서버가 `appliedScore.appliedAt`으로 판단)이거나 이 화면에서 `조사하기`·`다시 조사`를 누른 직후에만 "조사를 시작합니다…"를 보이고 2초마다 다시 그린다. 20초가 지나면 단추가 있는 보통 화면으로 돌아간다(검토: 처음에는 조사 줄이 없는 지원 공고에서 이 대기가 끝나지 않아 `조사하기`를 누를 수 없었다)
- **다시 조사는 `after()` 안에서 잡는다**: 계획은 "잡고 after()로 돌린다"였다. 요청이 `after()` 전에 끊겨도 `running` 줄이 남지 않게, 액션은 지원 공고인지·조사 중인지만 보고 바로 돌려주고 잡기는 `runResearch`가 한다(돈은 여전히 한 번만 쓴다)
- **`scheduleResearch`는 `research-schedule.ts`에 따로 둔다**: `"use server"` 파일에서 내보내면 브라우저가 아무 사용자 id로 부를 수 있는 액션이 되기 때문
- **인재상 생략 문구는 공고마다**(검토): `talent_skipped`는 회사 줄에 있지만, 그 공고에 인재상 글이 없으면 "이 공고에는 인재상이 없습니다. 다시 조사하면 인재상도 찾습니다"를 보인다
- **실패 링크**: 이름은 "인재상 붙여 넣기"(여는 곳은 공고 고치기). 한도 실패에도 보인다(검토, Review Focus 5)
- **조사일**: 끝난 때를 남긴다(검토)
- **맞음·체크는 지원 공고에서만** 서버가 받는다. 다시 조사가 실패해도 남은 지난 결과는 고를 수 있다
- **프롬프트 점검**: 호출 22번 → 24번(회사 조사 AI 2번, 검색 5번 요금). 줄 이름 "검사로 버린 항목이 2개 이하"
- **로컬 미리보기**: 가짜 조사는 8초 걸리고, 인재상 주소는 메시지의 [홈페이지] 도메인을 따른다
- 아직 실제 API로 돌리지 않았다: `allowed_callers: ["direct"]`가 받아들여지는지, 이어 부를 때 `max_uses`가 앞선 검색을 세는지는 배포 뒤 프롬프트 점검으로 본다

### PR 2 (Task 5~6)

- 새로 쓴 문단은 `company`를, 새 답은 `companyFacts`를 늘 둔다(비면 `[]`, `answers`와 같게)
- 고치기에서 문항 유형에 `motive`가 더는 없으면 stale 검사는 하되 회사 정보는 보내지 않는다(유형이 바뀐 답을 다시 보내지 않는 것과 같게). 회사 이름을 바꾸면 새 회사 키로 읽으므로 stale이다
- 회사 정보 한 줄(`describeCompanyFact`)은 `text.ts`에, `usableCompanyFacts`는 `write.ts`에 두어 쓰기·묻기·검사·화면이 같이 쓴다
- 프롬프트 점검의 회사 정보 쓰기는 기존 "답으로 쓰기" 예시를 바꾸지 않고 따로 한 예시로 더했다(기존 숫자 줄이 40%를 허용하지 않으므로). 소식 날짜는 null(날짜 숫자가 숫자 줄을 흔들지 않게). (검토) 인재상 C2를 더하고 "인재상을 지원자의 자질로 쓰지 않는다" 줄을 더했다(회사 정보 6줄). 쓰기·고치기 지시문에 "인재상은 회사가 찾는 사람의 모습이므로 지원자가 이미 그런 사람이라고 쓰지 않는다"를 더했다
- 프롬프트 점검은 호출 26번이다(기록 12, 공고 7(회사 조사 2 포함), 자소서 5, 이력서 2). PR 1에 적은 24번은 지금 코드로 세면 25번이었다. 관리 화면 안내와 `runPromptCheckAction` 주석을 26번으로 고쳤다(검토)
- 검사: 회사 정보 숫자는 답의 복사본에 있으면 허용한다. 지금 쓸 수 없게 된 회사 정보도 숫자는 허용하고 바뀜(`staleSource`)으로만 알린다. 직접 고친 문단도 쓸 수 없게 된 회사 정보를 가리키면 바뀜이다
- 화면: 회사 정보를 단 문단의 바뀜 문구는 "근거(경험·답·회사 정보)가 바뀌었습니다"(검토). 근거 이름은 쓸 때의 복사본으로 만든다(다시 조사해도 출처 호스트가 보인다. 복사본에도 없으면 "(지운 회사 정보)"). 카드의 회사 정보 한 줄은 고칠 수 있는 공고에서만 보이고, 0개 문구의 "공고 화면"이 링크다
- 제출 전 확인은 자기소개서를 고른 공고에서만 조사를 읽는다
- (검토) 고치기는 문단 단위로 막는다: 고치는 문단이 단 회사 정보가 지금 쓸 수 없을 때만 `stale_company`("공고 화면에서 고른 회사 정보가 바뀌었습니다. 공고 화면에서 다시 체크하거나 다시 쓰기를 눌러 주세요")이고 AI를 부르지 않는다. 아니면 복사본 중 지금도 쓸 수 있는 것만 다시 보낸다. 처음에는 복사본의 하나라도 쓸 수 없으면 `stale`("다시 고르기를 눌러 주세요")이라, 바뀜 표시가 없는 문단도 고치지 못하고 동기포부형만인 문항에 없는 단추를 안내했다. 답 복사본(`companyFacts`)은 그대로 둔다(다른 문단의 근거 이름과 검사가 쓴다)
- (전체 검토) 회사 정보의 허용 숫자에 소식 날짜(연·월·일)를 더한다(날짜도 AI에 보내므로 "2026년 10월 발표"가 통과해야 한다). 묻기 지시문에도 인재상을 지원자의 자질로 쓰지 않는 규칙을 더했다(선택지에 "저도 끝까지 책임지는 사람이다" 같은 말 금지, 프롬프트 점검 줄은 더하지 않음). 로컬 고치기 흉내도 [회사 정보]가 있으면 C1을 단다
- 남은 것: 쓰는 사이 체크를 풀어도 쓸 때의 복사본으로 저장한다(그 회사 정보를 단 문단은 바로 바뀜으로 보인다)

## 판단 기록

- PR #52 (PR 1, Task 1~4):
- PR 2 (Task 5~6):

## 판단표 점검 (2026-11-24)

-
