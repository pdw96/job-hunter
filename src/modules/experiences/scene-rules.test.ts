import { expect, test } from "vitest";
import { narrowerScope, sceneState, sceneUsable, scenePeriodStatus, versionHash } from "./scene-rules";
import { initialRubric } from "./verification";

const head = { startMonth: "2022-03", endMonth: "2024-08", isOngoing: false };
const none = { startMonth: null, endMonth: null, isOngoing: false };

test("장면의 기간이 없으면 머리의 기간으로 판정한다", () => {
  expect(scenePeriodStatus(none, head)).toBe("met");
  expect(scenePeriodStatus(none, { ...head, startMonth: null })).toBe("unmet");
  expect(scenePeriodStatus(none, { startMonth: "2022-03", endMonth: null, isOngoing: true })).toBe("met");
});

test("장면에 기간이 있으면 그 기간으로 판정한다", () => {
  expect(scenePeriodStatus({ startMonth: "2023-05", endMonth: "2023-02", isOngoing: false }, head)).toBe("unmet");
  expect(scenePeriodStatus({ startMonth: "2023-02", endMonth: "2023-05", isOngoing: false }, { ...head, startMonth: null })).toBe("met");
});

test("장면의 확인 상태는 프로젝트 규칙(기간·역할·수준)을 따른다", () => {
  const rubric = { ...initialRubric("project", "met"), role: "met" as const, level: "met" as const };
  expect(sceneState(rubric, false)).toBe("unconfirmed");
  expect(sceneState(rubric, true)).toBe("confirmed");
  expect(sceneState({ ...rubric, level: "unmet" }, true)).toBe("partial");
});

test("지원서에는 장면과 머리가 모두 확인됐을 때만 쓴다", () => {
  expect(sceneUsable("confirmed", true)).toBe(true);
  expect(sceneUsable("confirmed", false)).toBe(false);
  expect(sceneUsable("partial", true)).toBe(false);
});

test("더 좁은 범위가 이긴다", () => {
  expect(narrowerScope("summary", "exclude")).toBe("exclude");
  expect(narrowerScope("use", "summary")).toBe("summary");
  expect(narrowerScope("use", "use")).toBe("use");
  expect(narrowerScope("exclude", "use")).toBe("exclude");
});

test("versionHash는 같은 입력에 같은 값, 다른 입력에 다른 값, 0 이상 정수", () => {
  expect(versionHash(["a", 1])).toBe(versionHash(["a", 1]));
  expect(versionHash(["a", 1])).not.toBe(versionHash(["a", 2]));
  expect(Number.isInteger(versionHash(["가", 7]))).toBe(true);
  expect(versionHash(["가", 7])).toBeGreaterThanOrEqual(0);
});
