import { expect, test } from "vitest";
import { aliasKey, answerAlias, companyAlias, describeCompanyFact, resolveAlias } from "./text";

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

test.each([
  ["A1", 1],
  [" a2 ", 2],
  ["[A3]", 3],
  ["A1 (지원동기)", 1],
  ["A12:", 12],
])("answerAlias(%j) = %j", (raw, expected) => {
  expect(answerAlias(raw)).toBe(expected);
});

test.each(["", "A", "E1", "AE1", "A1a", "답 A1", "Plan A1"])("answerAlias(%j)는 null", (raw) => {
  expect(answerAlias(raw)).toBeNull();
});

test.each([
  ["C1", 1],
  [" c2 ", 2],
  ["[C3]", 3],
  ["C1 (인재상)", 1],
  ["C12:", 12],
])("companyAlias(%j) = %j", (raw, expected) => {
  expect(companyAlias(raw)).toBe(expected);
});

test.each(["", "C", "C0", "E1", "A1", "AC1", "C1a", "회사 C1"])("companyAlias(%j)는 null", (raw) => {
  expect(companyAlias(raw)).toBeNull();
});

test("describeCompanyFact: 인재상과 소식을 출처 호스트와 함께 한 줄로 적는다", () => {
  const base = { id: "f", url: "https://www.ganada.example/careers", title: "제목" };
  expect(describeCompanyFact({ ...base, kind: "talent", text: "끝까지 책임지는 사람", date: null })).toBe("인재상: 끝까지 책임지는 사람 (출처: ganada.example)");
  expect(describeCompanyFact({ ...base, kind: "news", text: "새 센터를 연다", date: "2026-10-15" })).toBe("소식(2026-10-15): 새 센터를 연다 (출처: ganada.example)");
  expect(describeCompanyFact({ ...base, kind: "news", text: "새 센터를 연다", date: null })).toBe("소식(날짜 모름): 새 센터를 연다 (출처: ganada.example)");
});
