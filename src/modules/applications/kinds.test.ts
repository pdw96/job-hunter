import { expect, test } from "vitest";
import { answerUnused, freeformQuestions, needsAnswers, topicsFor, unansweredKinds, unansweredTopics } from "./kinds";

test("유형에 맞는 주제만 남기고 빈 유형에는 기본 주제를 더한다", () => {
  expect(topicsFor(["motive"], ["growth"])).toEqual(["motive"]);
  expect(topicsFor(["experience", "self"], ["values", "motive"])).toEqual(["values"]);
  expect(topicsFor(["experience"], ["motive"])).toEqual([]);
  expect(topicsFor(["self"], [])).toEqual(["other"]);
});

test("답이 필요한 유형", () => {
  expect(needsAnswers(null)).toBe(false);
  expect(needsAnswers(["experience"])).toBe(false);
  expect(needsAnswers(["experience", "self"])).toBe(true);
});

test("자유양식 지원동기는 유형 motive·주제 motive·글자 수 800", () => {
  const result = freeformQuestions(["motive"], [], 800);
  expect(result).toEqual({
    ok: true,
    value: [{ prompt: "지원동기", charLimit: 800, countSpaces: true, kinds: ["motive"], topics: ["motive"], freeformItem: "motive" }],
  });
});

test("경험형 항목은 주제가 비어 있다", () => {
  const result = freeformQuestions(["competence"], [], 800);
  expect(result.ok && result.value[0]).toMatchObject({ kinds: ["experience"], topics: [] });
});

test("직접 추가 항목은 유형·주제 null", () => {
  const result = freeformQuestions([], ["  나의 강점  "], 500);
  expect(result).toEqual({
    ok: true,
    value: [{ prompt: "나의 강점", charLimit: 500, countSpaces: true, kinds: null, topics: null, freeformItem: "custom" }],
  });
});

test("모르는 항목 id는 message", () => {
  const result = freeformQuestions(["nope"], [], 800);
  expect(result.ok).toBe(false);
});

test("빈 직접 항목은 버린다", () => {
  const result = freeformQuestions(["motive"], ["", "   "], 800);
  expect(result.ok && result.value).toHaveLength(1);
});

test("100자 넘는 직접 항목은 message", () => {
  expect(freeformQuestions([], ["가".repeat(101)], 800).ok).toBe(false);
});

test("글자 수 범위를 벗어나면 message, 아무것도 없으면 message", () => {
  expect(freeformQuestions(["motive"], [], 10).ok).toBe(false);
  expect(freeformQuestions([], [], 800).ok).toBe(false);
});

test("유형마다 그 유형 주제의 답이 없으면 답이 없는 유형으로 돌려준다", () => {
  expect(unansweredKinds(["experience", "motive", "self"], ["motive"])).toEqual(["self"]);
  expect(unansweredKinds(["motive", "self"], ["aspiration", "values"])).toEqual([]);
  expect(unansweredKinds(["experience"], [])).toEqual([]);
  expect(unansweredKinds(null, [])).toEqual([]);
});

test("붙인 답이 없는 주제를 문항의 주제 순서로 돌려준다", () => {
  expect(unansweredTopics(["motive", "aspiration"], ["motive"])).toEqual(["aspiration"]);
  expect(unansweredTopics(["motive"], ["motive", "growth"])).toEqual([]);
  expect(unansweredTopics(null, [])).toEqual([]);
});

test("쓰기에 보내지 않는 답: 주제가 없으면 kind, 다른 회사에 묶였으면 company", () => {
  expect(answerUnused({ topic: "motive", companyKey: "가나다" }, ["motive"], "가나다")).toBeNull();
  expect(answerUnused({ topic: "motive", companyKey: "가나다" }, ["motive"], "라마바")).toBe("company");
  expect(answerUnused({ topic: "growth", companyKey: null }, ["growth"], "라마바")).toBeNull();
  expect(answerUnused({ topic: "growth", companyKey: null }, [], "라마바")).toBe("kind");
  expect(answerUnused({ topic: "motive", companyKey: "가나다" }, null, "가나다")).toBe("kind");
});
