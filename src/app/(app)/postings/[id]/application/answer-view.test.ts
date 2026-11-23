import { expect, test } from "vitest";
import type { Answer } from "@/modules/applications/answers-repo";
import type { AskItem } from "@/modules/applications/types";
import { answerNames, answerViews, picksToSend, toggled, writesWithoutExperience } from "./answer-view";

const answer = (id: string, topic: Answer["topic"], text: string): Answer => ({
  id,
  topic,
  question: "q",
  answer: text,
  postingId: null,
  company: "가나다",
  companyKey: null,
  createdAt: new Date("2026-11-01T00:00:00Z"),
});
const item = (id: string): AskItem => ({ id, topic: "motive", link: "", question: "?", options: ["a", "b"], previous: [] });

test("붙인 답을 붙인 순서로 주제 이름과 함께 보인다. 없는 답은 뺀다", () => {
  const list = [answer("a1", "motive", "하나"), answer("a2", "growth", "둘")];
  expect(answerViews(["a2", "gone", "a1"], list)).toEqual([
    { id: "a2", topic: "growth", label: "성장과정", text: "둘" },
    { id: "a1", topic: "motive", label: "지원동기", text: "하나" },
  ]);
});

test("근거 이름은 내 답: 주제다", () => {
  expect(answerNames([answer("a1", "motive", "x")])).toEqual({ a1: "내 답: 지원동기" });
});

test("번호를 켜고 끄며 번호 순서를 지킨다", () => {
  expect(toggled([2], 0, true)).toEqual([0, 2]);
  expect(toggled([0, 2], 0, false)).toEqual([2]);
  expect(toggled([0], 0, true)).toEqual([0]);
});

test("아무것도 고르지 않은 질문은 보내지 않고 기타는 공백을 뗀다", () => {
  const items = [item("x"), item("y"), item("z")];
  expect(
    picksToSend(items, {
      x: { options: [1], previous: [], note: "" },
      y: { options: [], previous: [], note: "   " },
      z: { options: [], previous: [0], note: " 직접 " },
    }),
  ).toEqual([
    { id: "x", options: [1], previous: [], note: "" },
    { id: "z", options: [], previous: [0], note: "직접" },
  ]);
});

test("경험형이 없는 문항만 고르기 없이 쓴다", () => {
  expect(writesWithoutExperience(["motive"])).toBe(true);
  expect(writesWithoutExperience(["experience", "motive"])).toBe(false);
  expect(writesWithoutExperience(null)).toBe(false);
});
