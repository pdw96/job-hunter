import { expect, test } from "vitest";
import type { Research } from "@/modules/postings/research-repo";
import { researchView } from "./research-view";

const NOW = new Date("2026-11-24T03:00:00Z");
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);

const row = (over: Partial<Research>): Research => ({
  id: "r1",
  userId: "u1",
  companyKey: "가나다",
  company: "가나다",
  status: "done",
  failure: null,
  startedAt: minutesAgo(10),
  researchedAt: minutesAgo(9),
  talent: null,
  talentSkipped: false,
  news: [],
  updatedAt: minutesAgo(9),
  ...over,
});

test("조사 중이면 고르기를 끄고 다시 조사를 숨긴다", () => {
  const view = researchView(row({ status: "running", startedAt: minutesAgo(1) }), NOW);
  expect(view).toMatchObject({
    state: "running",
    headline: "회사를 조사하는 중입니다(1분쯤 걸립니다)",
    failure: null,
    canRerun: false,
    editable: false,
  });
});

test("5분 지난 조사 중은 실패 문구와 다시 조사", () => {
  const view = researchView(row({ status: "running", startedAt: minutesAgo(6) }), NOW);
  expect(view).toMatchObject({
    state: "stuck",
    headline: "조사가 끝나지 않았습니다",
    failure: "찾지 못했습니다. 인재상을 붙여 넣어 주세요",
    pasteLink: true,
    canRerun: true,
    rerunLabel: "다시 조사",
    editable: false,
  });
});

test("한도 실패는 한도 문구", () => {
  const view = researchView(row({ status: "failed", failure: "over_limit" }), NOW);
  expect(view).toMatchObject({
    state: "failed",
    failure: "이번 달 AI 사용 한도에 닿아 조사하지 못했습니다",
    pasteLink: false,
    canRerun: true,
  });
});

test("찾지 못함은 인재상 붙여 넣기 문구", () => {
  for (const failure of ["not_found", "unavailable"] as const) {
    const view = researchView(row({ status: "failed", failure }), NOW);
    expect(view).toMatchObject({ failure: "찾지 못했습니다. 인재상을 붙여 넣어 주세요", pasteLink: true, canRerun: true });
  }
});

test("91일 지난 조사는 오래된 조사 문구와 날짜", () => {
  const at = daysAgo(91);
  const view = researchView(row({ startedAt: at, researchedAt: at }), NOW);
  expect(view).toMatchObject({ state: "stale", staleNote: "오래된 조사입니다(2026-08-25)", canRerun: true, editable: true });
  // 90일이 안 됐으면 조사일만 보인다
  const fresh = researchView(row({}), NOW);
  expect(fresh).toMatchObject({ state: "done", headline: "조사일 2026-11-24", staleNote: null, failure: null, editable: true });
});

test("조사 전이면 다시 조사 단추가 '조사하기'", () => {
  const view = researchView(null, NOW);
  expect(view).toMatchObject({
    state: "none",
    headline: "아직 조사하지 않았습니다",
    canRerun: true,
    rerunLabel: "조사하기",
    editable: false,
  });
});
