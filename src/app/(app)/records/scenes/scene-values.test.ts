import { expect, test } from "vitest";
import { mergeServerPhrases } from "./scene-values";

test("사용자가 지운 표현은 다시 들어오지 않고, 서버에 새로 생긴 표현은 더해진다", () => {
  expect(mergeServerPhrases(["b"], ["a", "b"], ["a", "b", "c"])).toEqual(["b", "c"]);
});
test("이미 있는 표현은 겹치지 않는다", () => {
  expect(mergeServerPhrases(["a", "c"], ["a"], ["a", "c"])).toEqual(["a", "c"]);
});
test("서버 목록이 그대로면 그대로", () => {
  expect(mergeServerPhrases(["x"], ["a"], ["a"])).toEqual(["x"]);
});
