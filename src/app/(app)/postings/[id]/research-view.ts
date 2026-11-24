import { researchState } from "@/modules/postings/research";
import type { Research } from "@/modules/postings/research-repo";
import { koreaDate } from "@/modules/postings/today";

// 공고 화면의 회사 조사 구역이 보일 문구와 단추. 화면(서버)이 그릴 때 계산해 넘긴다

export type ResearchViewState = ReturnType<typeof researchState>;
export type ResearchView = {
  state: ResearchViewState;
  headline: string;
  staleNote: string | null;
  failure: string | null;
  pasteLink: boolean; // 인재상 붙여 넣기(공고 고치기) 링크를 보일지(실패했을 때)
  canRerun: boolean;
  rerunLabel: "조사하기" | "다시 조사";
  editable: boolean; // 맞음·아님, 소식 체크를 바꿀 수 있는가(조사 중이면 서버도 거절한다)
};

const NOT_FOUND = "찾지 못했습니다. 인재상을 붙여 넣어 주세요";
const OVER_LIMIT = "이번 달 AI 사용 한도에 닿아 조사하지 못했습니다";

export function researchView(r: Research | null, now: Date): ResearchView {
  const state = researchState(r, now);
  const base = { state, staleNote: null, failure: null, pasteLink: false, canRerun: true, rerunLabel: "다시 조사" as const, editable: false };
  switch (state) {
    case "none":
      return { ...base, headline: "아직 조사하지 않았습니다", rerunLabel: "조사하기" };
    case "running":
      return { ...base, headline: "회사를 조사하는 중입니다(1분쯤 걸립니다)", canRerun: false };
    case "stuck":
      return { ...base, headline: "조사가 끝나지 않았습니다", failure: NOT_FOUND, pasteLink: true };
    case "failed": {
      const overLimit = r?.failure === "over_limit";
      // 지난 결과가 있으면 그것은 그대로 고를 수 있다. 한도에 닿았어도 인재상은 붙여 넣어 쓸 수 있다
      return { ...base, headline: "조사하지 못했습니다", failure: overLimit ? OVER_LIMIT : NOT_FOUND, pasteLink: true, editable: true };
    }
    case "done":
    case "stale": {
      const date = r?.researchedAt ? koreaDate(r.researchedAt) : "";
      return {
        ...base,
        headline: `조사일 ${date}`,
        staleNote: state === "stale" ? `오래된 조사입니다(${date})` : null,
        editable: true,
      };
    }
  }
}

// 조사를 맡긴 직후(지원·다시 조사) 조사 줄이 잡힐 때까지 기다리는 시간. 그동안 자주 다시 그린다
export const KICK_LIMIT_MS = 20_000;
export type Kick = { at: number; runKey: string };

// 지원 직후에 그린 화면인가: 지원 공고이고, 조사 줄이 아직 없고, 지원한 지 KICK_LIMIT_MS 안이다.
// 이 기능 전에 지원했거나 오래전에 지원한 공고는 기다리지 않고 '조사하기'를 보인다. 기다리기 시작한 때(ms)를 돌려준다
export function kickFromApply(p: { isApply: boolean; state: ResearchViewState; appliedAt: string | null }, now: Date): number | null {
  if (!p.isApply || p.state !== "none" || !p.appliedAt) return null;
  const at = Date.parse(p.appliedAt);
  if (Number.isNaN(at)) return null;
  const age = now.getTime() - at;
  return age >= 0 && age < KICK_LIMIT_MS ? at : null;
}

// 아직 기다리는 중인가: 맡긴 뒤 새 조사가 잡히지 않았고(runKey 그대로, 조사 중 아님) KICK_LIMIT_MS가 지나지 않았다
export function waitingForStart(kick: Kick | null, runKey: string, state: ResearchViewState, now: number): boolean {
  return kick !== null && kick.runKey === runKey && state !== "running" && now - kick.at < KICK_LIMIT_MS;
}

// 인재상을 찾지 않은 조사(talentSkipped)는 회사 단위지만, 생략한 까닭(인재상 글)은 조사를 돌린 공고의 것이다.
// 그래서 문구는 지금 보는 공고를 보고 고른다. 생략하지 않았으면 null(인재상 줄을 그대로 보인다)
export function talentSkipNote(p: { rowSkipped: boolean; postingWantsTalent: boolean; isApply: boolean }): string | null {
  if (!p.rowSkipped) return null;
  if (!p.postingWantsTalent) return "공고의 인재상을 씁니다";
  return p.isApply ? "이 공고에는 인재상이 없습니다. 다시 조사하면 인재상도 찾습니다" : "인재상은 찾지 않았습니다";
}
