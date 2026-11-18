import { expect, test } from "vitest";
import { aliasKey } from "./text";

test.each([
  ["E1", "E1"],
  [" E1 ", "E1"],
  ["e1", "E1"],
  ["[E1]", "E1"],
  ["E1:", "E1"],
  ["E1(주문 조회 API 개선)", "E1"],
  ["E1 (주문 조회 API 개선)", "E1"],
  ["경험 E12", "E12"],
  ["E1주문", "E1"],
])("aliasKey(%j) = %j", (raw, expected) => {
  expect(aliasKey(raw)).toBe(expected);
});

test.each(["", "경험", "E", "E1, E2", "E1 E1", "AE1", "E1a", "E"])("aliasKey(%j)는 null", (raw) => {
  expect(aliasKey(raw)).toBeNull();
});
