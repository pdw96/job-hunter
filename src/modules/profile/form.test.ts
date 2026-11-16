import { expect, test } from "vitest";
import { parseContactForm } from "./form";

function form(values: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(values)) fd.set(k, v);
  return fd;
}

test("입력값의 앞뒤 공백을 지우고 빈 칸은 null로 바꾼다", () => {
  expect(
    parseContactForm(form({ legalName: " 홍길동 ", phone: "", address: "   ", birthDate: "1996-01-02" })),
  ).toEqual({ legalName: "홍길동", phone: null, address: null, birthDate: "1996-01-02", contactEmail: null });
});

test("날짜 형식이 아닌 생년월일은 null로 바꾼다", () => {
  expect(parseContactForm(form({ birthDate: "96년 1월" })).birthDate).toBeNull();
  expect(parseContactForm(form({ birthDate: "1996-13-40" })).birthDate).toBeNull();
});
