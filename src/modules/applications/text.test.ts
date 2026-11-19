import { expect, test } from "vitest";
import { aliasKey, resolveAlias } from "./text";

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

const sources = [{ name: "주문 조회 API 개선" }, { name: "결제 시스템 개편" }];

test("resolveAlias: 별명으로 찾는다", () => {
  expect(resolveAlias("E2", sources)).toBe(sources[1]);
  expect(resolveAlias("[e1]", sources)).toBe(sources[0]);
  expect(resolveAlias("E3", sources)).toBeUndefined();
});

test("resolveAlias: 경험 이름이 정확히 같으면 찾는다", () => {
  expect(resolveAlias("주문 조회 API 개선", sources)).toBe(sources[0]);
});

test("resolveAlias: 이름에 공백·따옴표·괄호가 더 있어도 찾는다", () => {
  expect(resolveAlias('  "주문   조회 API  개선" ', sources)).toBe(sources[0]);
  expect(resolveAlias("[결제 시스템 개편]", sources)).toBe(sources[1]);
  expect(resolveAlias("‘결제 시스템 개편’", sources)).toBe(sources[1]);
});

test("resolveAlias: 이름이 같은 경험이 둘이면 고르지 않고, 모르는 이름이나 빈 글도 못 찾는다", () => {
  const dup = [{ name: "프로젝트" }, { name: "프로젝트" }];
  expect(resolveAlias("프로젝트", dup)).toBeUndefined();
  expect(resolveAlias("없는 경험", sources)).toBeUndefined();
  expect(resolveAlias("  ", sources)).toBeUndefined();
});
