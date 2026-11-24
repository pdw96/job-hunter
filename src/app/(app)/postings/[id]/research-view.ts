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
  pasteLink: boolean; // 인재상 붙여 넣기(공고 고치기) 링크를 보일지
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
      // 지난 결과가 있으면 그것은 그대로 고를 수 있다
      return { ...base, headline: "조사하지 못했습니다", failure: overLimit ? OVER_LIMIT : NOT_FOUND, pasteLink: !overLimit, editable: true };
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
