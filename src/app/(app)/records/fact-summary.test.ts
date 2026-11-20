import { expect, test } from "vitest";
import type { Fact } from "@/modules/experiences/facts-repo";
import { cardOf } from "./fact-summary";

const gap = (startMonth: string | null, endMonth: string | null, note: string | null = null) =>
  ({
    kind: "gap",
    id: "g1",
    value: { startMonth, endMonth, note },
    isConfirmed: false,
    contentVersion: 0,
    source: "manual",
    trackScopes: {},
    movedFrom: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  }) as Fact<"gap">;

test("공백 카드: 끝 월이 없으면 진행 중, 두 월이 없으면 기간 없음", () => {
  expect(cardOf(gap("2024-03", "2024-08")).lines).toEqual(["2024.03 ~ 2024.08"]);
  expect(cardOf(gap("2024-03", null, "취업 준비")).lines).toEqual(["2024.03 ~ 진행 중", "취업 준비"]);
  expect(cardOf(gap(null, null)).lines).toEqual(["기간 없음"]);
  expect(cardOf(gap(null, "2024-08")).lines).toEqual(["~ 2024.08"]);
});
