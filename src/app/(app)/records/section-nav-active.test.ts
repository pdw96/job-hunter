import { describe, expect, test } from "vitest";
import { activeSection } from "./section-nav-active";

describe("activeSection", () => {
  const tops = [
    { id: "a", top: 0 },
    { id: "b", top: 500 },
    { id: "c", top: 900 },
  ];

  test("기준선 위로 올라간 마지막 묶음이 지금 묶음", () => {
    expect(activeSection(tops, 600)).toBe("b");
  });

  test("아직 첫 묶음 위면 첫 묶음", () => {
    expect(activeSection(tops, -10)).toBe("a");
  });

  test("빈 목록이면 null", () => {
    expect(activeSection([], 120)).toBeNull();
  });
});
