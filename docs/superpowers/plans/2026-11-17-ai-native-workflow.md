# AI가 더 맡는 개발 방식 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 절차 때문에 사람의 답을 기다리던 구간을, AI가 판단표로 채점해 정하는 방식으로 바꾼다. 문서는 지금보다 짧게 만든다.

**Architecture:** 새 문서 `docs/decision-rubrics.md` 하나에 판단 지점 여섯 개의 채점표, 점검 방법, 직접 만든 장치 목록을 둔다. `CLAUDE.md`와 `/ship`은 그 문서를 가리키게 줄인다. 제품 코드는 바꾸지 않는다.

**Tech Stack:** Markdown 문서, Claude Code 스킬(`.claude/skills/ship/SKILL.md`), GitHub MCP, Vercel MCP, Nimble MCP

**Spec:** `docs/superpowers/specs/2026-11-17-ai-native-workflow-design.md`

## Global Constraints

- 제품 코드(`src/`, `drizzle/`)를 바꾸지 않는다
- 새 커스텀 훅, 스킬, 스크립트를 만들지 않는다. `.claude/settings.json`을 바꾸지 않는다
- `CLAUDE.md` + `.claude/skills/ship/SKILL.md`의 줄 수 합이 78보다 작아야 한다(지금 56 + 22)
- 판단표 문서에서 판단 지점 하나는 15줄 안팎이다(제목 줄부터 다음 제목 전까지, 빈 줄 포함 20줄을 넘지 않는다)
- 문서는 한국어로, 이 저장소의 문체(쉬운 낱말, 짧은 문장, "~한다")로 쓴다
- 실제 서비스 로그의 세션 토큰과 사용자 id를 어디에도 옮겨 적지 않는다
- 이 작업 자체는 지금 규칙을 따른다. PR은 사용자가 합친다(판단표를 바꾸는 PR은 "반드시 묻기"다)

## 점수 방식 (설계가 만드는 사람에게 맡긴 것을 여기서 정한다)

- 기준마다 0(낮음), 1(중간), 2(높음). 높을수록 "조심하는 쪽"이다
- ① Codex 재검토: 합계 3 이상이면 다시 받는다. 2 이하면 멈춘다. 다시 받는 데는 사람의 시간이 들지 않으므로 애매하면 다시 받는다
- ② 합치기: 반드시 묻기가 하나도 없고 합계 3 이하이면 AI가 합친다. 4 이상이면 묻는다
- ③ 계획 승인: 점수 대신 확인 목록이다. 하나라도 해당하면 그 결정만 묻고, 없으면 바로 구현한다
- ④ 배포 후 확인, ⑤ 사이트 구조, ⑥ 새 세션: 점수 대신 조건과 행동이다

## Review Focus

1. **Codex 검토가 아직 도는 중에 합치기.** Codex는 PR에 요약 댓글을 남기고, 그 안의 `codex-review-state`에 `commit_sha`, `status`, `has_unresolved_findings`를 적는다(PR #12에서 확인). ②는 "PR의 지금 head 커밋에 대해 `status: completed`이고 `has_unresolved_findings: false`"일 때만 Codex가 끝난 것으로 본다 → Task 1 Step 3
2. **마이그레이션을 놓치기.** `drizzle/` 아래 파일이나 `src/modules/*/schema.ts`가 바뀌면 반드시 묻는다. 파일 경로로 판단한다 → Task 1 Step 3
3. **이미 있던 오류를 내 탓으로 보고 되돌리기.** 지금도 실제 서비스에 DB 연결 끊김 오류가 있다. ④는 "배포 시각 뒤에 처음 생긴 오류 묶음"만 그 변경의 오류로 본다. 전부터 있던 것은 되돌리지 않고 알린다 → Task 1 Step 3
4. **되돌린 PR이 또 오류를 내기.** 되돌리기는 한 번만 한다. 되돌린 뒤에도 새 오류가 나면 더 하지 않고 묻는다 → Task 1 Step 3
5. **로그를 PR에 그대로 붙이기.** 오류는 이름, 횟수, 경로만 적는다. 메시지 본문의 토큰과 id는 옮기지 않는다 → Task 1 Step 3

---

### Task 1: 판단표 문서

**Files:**
- Create: `docs/decision-rubrics.md`

**Interfaces:**
- Produces: 판단 지점 제목 `## ① Codex 재검토`, `## ② 합치기`, `## ③ 계획 승인`, `## ④ 배포 후 확인`, `## ⑤ 실제 사이트 구조`, `## ⑥ 새 세션`, 그리고 `## 판단 기록`, `## 점검`, `## 직접 만든 장치`. Task 2, 3이 이 제목을 가리킨다

- [x] **Step 1: Nimble로 공개 공고 하나를 읽어 본다 (⑤의 내용을 정한다)**

`mcp__Nimble__nimble_search`로 사람인의 공개 공고 주소 하나를 찾고, `mcp__Nimble__nimble_extract`로 그 주소를 읽는다. 사용자 정보는 보내지 않는다.
판정: 본문(자격 요건, 우대 사항, 마감일)이 글로 나오면 "된다". 메뉴나 로그인 안내만 나오면 "안 된다".
결과는 이 계획 끝의 "구현하면서 달라진 점"에 한 줄 적는다.

- [x] **Step 2: 확인 명령을 먼저 만들어 두고 실패하는 것을 본다**

```bash
f=docs/decision-rubrics.md
test -f $f && for h in "① Codex 재검토" "② 합치기" "③ 계획 승인" "④ 배포 후 확인" "⑤ 실제 사이트 구조" "⑥ 새 세션" "판단 기록" "점검" "직접 만든 장치"; do grep -q "^## $h" $f || echo "없음: $h"; done
awk '/^## /{if(t~/^## (①|②|③|④|⑤|⑥)/ && n>20)print t" "n"줄";t=$0;n=0} {n++} END{if(t~/^## (①|②|③|④|⑤|⑥)/ && n>20)print t" "n"줄"}' $f
```

Expected: 파일이 없어서 `test`가 실패하고 awk가 "can't open file"을 낸다.

- [x] **Step 3: `docs/decision-rubrics.md`를 쓴다**

맨 위: 이 문서가 무엇인지 두 줄. "점수는 정답이 아니라 판단을 돕는 표다. 판단표를 느슨하게(덜 묻게) 고치는 것은 사용자 승인을 받는다." `마지막 점검: 2026-11-17 (처음 만듦)`.

판단 지점마다 같은 순서로 쓴다: 반드시 묻기 → 기준 표(기준 | 2 | 0 | 왜) → 결정 규칙. 기준과 반드시 묻기는 설계 문서 "설계 1"의 초안을 그대로 쓰고, 아래를 더한다.

- ①: 위 "점수 방식"의 구간. 반드시 묻기에 "Codex의 지적이 틀렸다고 보여 반박하려 한다"
- ②: 반드시 묻기를 파일 경로로 적는다: `drizzle/**`, `src/modules/*/schema.ts`, `src/modules/access/**`, `src/modules/auth/**`, `src/lib/auth.ts`, `src/lib/session.ts`, `src/modules/profile/**`, `docs/decision-rubrics.md`, `CLAUDE.md`, `.claude/**`, `.github/**`. 여기에 설계의 나머지 조건(데이터 삭제, 돈이 드는 새 외부 서비스, 비밀 값)을 더한다. "Codex가 끝났다"의 정의(Review Focus 1). CI 검사 `check`가 head 커밋에서 성공. 합친 뒤 한두 줄 알림(무엇이 배포됐는지, 계획 문서 주소, 확인할 것)
- ③: 확인 목록: 설계에 없던 결정, 새 테이블, 새 외부 서비스, 돈이 드는 일, 사용자가 보는 동작이 설계와 다름
- ④: Vercel 프로젝트 `job-hunter`(`prj_JuWhSZfsqdotjWAph0ysJumHWHpP`, 팀 `team_w4vHDxHKH2AsD4651Mq5D220`). 배포 상태와 빌드 기록(마이그레이션 적용), `get_runtime_errors`로 배포 시각 뒤에 처음 생긴 오류 묶음만 본다(Review Focus 3). AI가 합친 변경 때문이면 되돌리는 PR을 열어 바로 합치고 알린다. 되돌리기는 한 번만(Review Focus 4). Vercel에서 이전 배포로 되돌리지 않는다. 로그는 이름, 횟수, 경로만 적는다(Review Focus 5). 실제 계정, 실제 채용 사이트, 실제 AI의 답의 질이 필요한 확인만 사용자에게 부탁한다
- ⑤: Step 1 결과에 따라 "Nimble로 먼저 읽는다, 안 되면 저장한 페이지를 받는다" 또는 "저장한 페이지를 받는다(Nimble은 YYYY-MM-DD에 안 됐다)". 로그인이 필요한 페이지는 열지 않는다
- ⑥: 한 세션으로 이어 가고 구현은 `superpowers:subagent-driven-development`. 새 세션을 권하는 낌새 세 가지(설계 문서 그대로)

`## 판단 기록`: PR 본문 끝 "판단 기록"에 판단마다 한 줄. 형식 예시 두 줄(설계 문서의 예시). 판단표를 바꾼 뒤에는 `(판단표 YYYY-MM-DD)`를 붙인다.

`## 점검`: 계획이 하나 끝날 때(`CLAUDE.md`의 "지금 상태"를 고칠 때) 한다. 볼 것 네 가지, 직접 만든 장치도 본다, 적는 곳(그 계획 문서 끝 "판단표 점검"), 고치는 권한(조심하는 쪽은 바로, 느슨한 쪽은 번호 선택지로 묻는다). 설계 문서 "설계 3" 그대로.

`## 직접 만든 장치`: 표(장치 | 없으면 무엇이 깨지나). 두 줄:
- `.claude/hooks/related-test.sh` | 파일을 고친 뒤 옆 테스트의 실패를 바로 모른다. 전체 테스트는 2분이 걸려 매번 돌리지 않는다
- `.claude/skills/ship/SKILL.md` | 올리는 순서(검사 → PR → 검토 → 합치기 → 확인)를 매번 문서에서 찾아 맞춰야 한다

- [x] **Step 4: Step 2의 확인 명령을 다시 돌린다**

Expected: 아무것도 출력되지 않는다(제목이 다 있고, 20줄을 넘는 판단 지점이 없다). 그리고 다음이 모두 한 번 이상 나온다:

```bash
grep -c "codex-review-state\|drizzle/\|처음 생긴\|한 번만\|이름, 횟수, 경로" docs/decision-rubrics.md
```

Expected: 5 이상

- [x] **Step 5: 커밋**

```bash
git add docs/decision-rubrics.md
git commit -m "docs: 판단 지점 여섯 개의 판단표"
```

### Task 2: `CLAUDE.md` 줄이기

**Files:**
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: Task 1의 `docs/decision-rubrics.md`와 그 제목들

- [x] **Step 1: 확인 명령을 돌려 지금 상태를 본다**

```bash
grep -n "새 세션은 이 파일과\|다음 작업 진행해\|decision-rubrics" CLAUDE.md; wc -l < CLAUDE.md
```

Expected: "새 세션은 이 파일과"와 "다음 작업 진행해"가 나오고 `decision-rubrics`는 없다. 56

- [x] **Step 2: `CLAUDE.md`를 고친다**

- 머리: "새 세션은 ... 시작한다"를 바꾼다 → "한 세션으로 이어 간다. 다른 세션이 이어받을 때는 이 파일과 `docs/`만 보고 아래 **지금 상태**의 다음 할 일부터 한다."
- "일하는 방식":
  - 순서 줄: "계획 → TDD 구현 → PR → 검토 → 합치기 → 배포 확인. 단계마다 멈출지는 `docs/decision-rubrics.md`로 채점해 정한다"
  - "합치기 전에 반드시 사용자에게 묻는다"와 "합치기 전: PR을 초안에서 풀고 ..." 두 줄을 → "`main`에 합치면 실제 서비스에 배포된다. AI가 합쳐도 되는지는 판단표 ②를 따른다"로 합친다
  - 묻는 방식 줄에 "선택지 끝에 늘 `기타 (짧게 적기)`를 둔다"를 더한다
- "지켜야 할 것", "개발 메모"는 그대로 둔다
- "지금 상태"의 끝 문장을 → "계획 하나가 끝날 때마다 이 "지금 상태"를 고치고, 판단표를 점검한다(`docs/decision-rubrics.md`의 "점검")"

- [x] **Step 3: 확인 명령을 다시 돌린다**

```bash
grep -c "새 세션은 이 파일과" CLAUDE.md; grep -c "decision-rubrics" CLAUDE.md; grep -c "기타 (짧게 적기)" CLAUDE.md; wc -l < CLAUDE.md
```

Expected: `0`, `3` 이상, `1`, 56 이하

- [x] **Step 4: 커밋**

```bash
git add CLAUDE.md
git commit -m "docs: 작업 안내를 한 세션 원칙과 판단표에 맞춰 줄인다"
```

### Task 3: `/ship`을 판단표에 맞추기

**Files:**
- Modify: `.claude/skills/ship/SKILL.md`

**Interfaces:**
- Consumes: Task 1의 `## ① Codex 재검토`, `## ② 합치기`, `## ④ 배포 후 확인`, `## 판단 기록`

- [x] **Step 1: 확인 명령을 돌려 지금 상태를 본다**

```bash
grep -n "disable-model-invocation\|사용자에게 묻는다\|decision-rubrics" .claude/skills/ship/SKILL.md; cat CLAUDE.md .claude/skills/ship/SKILL.md | wc -l
```

Expected: `disable-model-invocation: true`와 7번 "사용자에게 묻는다"가 나온다. `decision-rubrics`는 없다

- [x] **Step 2: `SKILL.md`를 고친다**

- 앞부분: `disable-model-invocation: true`를 지운다. 구현이 끝나면 AI가 스스로 부르게 한다. description을 "구현이 끝난 작업을 검사하고, PR을 올리고, 검토를 처리하고, 판단표에 따라 합치고 배포를 확인한다"로 바꾼다
- 1~4번(검사, 계획 문서, 커밋, PR)은 그대로 둔다. 4번에 "본문 끝에 `판단 기록`을 둔다(판단표의 "판단 기록")"를 더한다
- 5~7번을 하나로 합친다: "Codex 결과를 기다린다. 지적을 처리한 뒤 다시 받을지는 판단표 ①로 정하고 PR의 판단 기록에 적는다. 다시 받으면 `@codex review`를 남긴다"
- 새 6번: "합칠지는 판단표 ②로 정한다. 반드시 묻기가 있거나 점수가 높으면 사용자에게 묻는다"
- 8번(합친 뒤): "판단표 ④를 따른다"로 줄이고, "작업 브랜치를 `origin/main`에서 다시 시작한다"는 남긴다
- 맨 위의 "사용자가 합치라고 하기 전에는 합치지 않는다" 문장을 → "합치기는 판단표 ②를 따른다(`main`에 합치면 실제 서비스에 배포된다)"

- [x] **Step 3: 확인 명령을 다시 돌린다**

```bash
grep -c "disable-model-invocation" .claude/skills/ship/SKILL.md; grep -c "판단표" .claude/skills/ship/SKILL.md; cat CLAUDE.md .claude/skills/ship/SKILL.md | wc -l
```

Expected: `0`, `3` 이상, 78 미만

- [x] **Step 4: 커밋**

```bash
git add .claude/skills/ship/SKILL.md
git commit -m "docs: 올리기 순서가 판단표로 재검토·합치기·배포 확인을 정하게 한다"
```

### Task 4: 마무리 (PR #15 닫기, 계획 문서 기록)

**Files:**
- Modify: `docs/superpowers/plans/2026-11-17-ai-native-workflow.md` (끝에 "구현하면서 달라진 점")

- [x] **Step 1: PR #15를 닫는다**

`mcp__github__add_issue_comment`로 "이 PR은 절차를 더 적어 넣는 쪽이라, `docs/superpowers/specs/2026-11-17-ai-native-workflow-design.md`의 방향(덜어내고 판단표로 정한다)과 반대여서 닫습니다. 대신 [PR #16 주소]에서 다룹니다." 끝에 Claude Code 꼬리말을 붙인다. 그다음 `mcp__github__update_pull_request`로 `state: closed`.
확인: `mcp__github__pull_request_read`(get)에서 `state`가 `closed`

- [x] **Step 2: 전체 확인을 돌린다**

```bash
git diff --stat origin/main -- src drizzle .claude/settings.json .claude/hooks | tail -1; cat CLAUDE.md .claude/skills/ship/SKILL.md | wc -l
```

Expected: 첫 줄이 비어 있다(제품 코드, 설정, 훅을 바꾸지 않았다). 둘째 줄은 78 미만

- [x] **Step 3: 계획 문서 끝에 "구현하면서 달라진 점"을 적고 커밋한다**

Nimble 결과(Task 1 Step 1), 계획과 달라진 점. 그리고 `/ship`으로 올린다. 이 PR은 판단표를 바꾸므로 반드시 묻기에 해당하고, 사용자가 합친다.

```bash
git add docs/superpowers/plans/2026-11-17-ai-native-workflow.md
git commit -m "docs: AI가 더 맡는 개발 방식 계획의 구현 기록"
```

## 구현하면서 달라진 점

- (Task 1) Nimble 시험: 사람인 공고 하나(`rec_idx=54650098`)를 읽었다. 기본 설정(`vx6`, 글자)으로는 공고 주소에서 메뉴와 로그인 안내만 나왔다(본문이 끼워 넣은 페이지에 있다). 상세요강 주소(`relay/view-detail`)를 `driver: "vx8"`, `output_format: "simplified_html"`로 읽으니 본문 구조가 보였다. 이 공고는 본문이 그림 한 장이었다. 그래서 판정 기준을 "본문이 글로 나오면"에서 "본문 구조가 보이면"으로 바꿨고(⑤의 목적이 구조 확인이라서), ⑤에 이 설정을 적었다
- (Task 3) 계획은 `/ship`의 5~7번을 하나로 합치라 했으나, 지적 처리 절차(사실 확인, 테스트 먼저, 스레드 답)가 사라져서 5번(검토)과 6번(합치기)으로 나눴다. 작업 환경이 PR을 초안으로 만들기 때문에, 4번에 "초안이면 풀어서 Codex 검토를 시작한다"를 더했다
- 줄 수: `CLAUDE.md` 55줄 + `/ship` 18줄 = 73줄(전 78줄). 판단표 문서는 판단 지점마다 4~19줄

### 최종 검토에서 고친 것

- (검토) ②의 반드시 묻기를 경로 목록만으로 두면 연락처 가리기(`src/modules/ai/redact.ts`), 로그인 관문(`src/proxy.ts`), 관리자 화면 등이 빠졌다. "반드시 묻는 파일"을 따로 두어 넓히고, 경로와 상관없이 로그인·접근 허용·연락처·마이그레이션 적용 방식을 바꾸면 묻는 조건을 되살렸다
- (검토) 설계 문서(`docs/superpowers/specs/**`)와 `AGENTS.md`도 반드시 묻는 파일에 넣었다. ③은 "사용자가 승인한 설계 문서"로 고쳤다. AI가 설계를 고쳐 스스로 승인을 만들지 못하게 한다
- (검토) "AI가 합친 변경"은 판단 기록에 `→ AI가 합침`으로 적힌 PR이라고 정했다. 되돌리는 PR은 ②로 채점하지 않고 `check` 성공만 보고 합친다
- (검토) Vercel은 읽기만 한다. `main`에는 PR 합치기로만 올린다. 자료를 지우거나 덮어쓰는 코드를 바꾸면 묻는다
- (검토) ①에서 멈추면 Codex 상태가 head와 달라 ②에서 묻게 되고, 계획을 끝내는 PR은 `CLAUDE.md`를 고치므로 늘 묻는다. 이것이 정상임을 적었다
- (검토) `CLAUDE.md`의 "채용 사이트에 접속할 수 없다 … 저장한 페이지를 받는다"를 판단표 ⑤를 가리키게 고쳤다
- 미룬 것: `/ship` 문구 맞추기("합계 4 이상"), 지적 반박 전 묻기를 `/ship`에도 쓰기, 오류를 언제 다시 볼지, 배포 실패 때 묻기, ③에 "되돌리기 어려운 일", 판단 지점별 마지막 점검

### 합치기 전에 더 바꾼 것

- "지금 상태"를 `CLAUDE.md`에서 `docs/status.md`로 옮겼다(사용자가 정함). `CLAUDE.md`는 매 세션 읽히는 오래가는 규칙이고 "반드시 묻는 파일"인데, 진행 상황은 계획마다 바뀐다. 섞어 두면 계획을 끝내는 PR이 매번 묻게 되고, 끝난 계획 표가 매 세션 읽힌다. `docs/status.md`는 반드시 묻는 파일이 아니다. 설계의 "지금 상태는 그대로 둔다"를 바꾼 것이다. `CLAUDE.md`는 39줄, `CLAUDE.md` + `/ship` 57줄
