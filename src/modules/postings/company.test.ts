import { expect, test } from "vitest";
import { companyKey } from "./company";

test("(주)·주식회사·㈜는 같은 회사로 본다", () => {
  expect(companyKey("(주)가나다")).toBe(companyKey("가나다 주식회사"));
  expect(companyKey("㈜ 가나다")).toBe(companyKey("가나다 주식회사"));
});

test("이름이 더 긴 회사는 다른 회사", () => {
  expect(companyKey("가나다랩")).not.toBe(companyKey("가나다"));
});

test("영문 대소문자는 무시한다", () => {
  expect(companyKey("ABC Corp")).toBe(companyKey("abc corp"));
});

test("(유)는 뺀다", () => {
  expect(companyKey("가나다(유)")).toBe(companyKey("가나다"));
});

test("앞이나 뒤의 법인 표기와 괄호를 뺀다", () => {
  expect(companyKey("주식회사 가나다")).toBe(companyKey("가나다"));
  expect(companyKey("가나다 유한회사")).toBe(companyKey("가나다"));
  expect(companyKey("가나다(서울)")).toBe("가나다서울");
});
