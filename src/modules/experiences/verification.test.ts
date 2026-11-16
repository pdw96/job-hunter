import { expect, test } from "vitest";
import { KINDS, RUBRIC_ITEMS } from "./options";
import {
  appliesTo,
  canClose,
  initialRubric,
  judgePeriod,
  type Rubric,
  requiredItems,
  rubricAfterContentEdit,
  usableInApplications,
  verificationState,
} from "./verification";

const allMet: Rubric = { period: "met", role: "met", level: "met", metrics: "met", evidence: "met" };

test("재직·프로젝트·교육·기타는 기간·본인 역할·수준이 필수다", () => {
  for (const kind of ["job", "project", "training", "other"] as const) {
    expect(requiredItems(kind)).toEqual(["period", "role", "level"]);
  }
});

test("학력·자격·공백은 기간만 필수이고 본인 역할·수준은 적용하지 않는다", () => {
  for (const kind of ["school", "certificate", "gap"] as const) {
    expect(requiredItems(kind)).toEqual(["period"]);
    expect(appliesTo(kind, "role")).toBe(false);
    expect(appliesTo(kind, "level")).toBe(false);
  }
});

test("수치와 증빙은 모든 구분에 적용되지만 필수는 아니다", () => {
  for (const kind of KINDS) {
    expect(appliesTo(kind, "metrics")).toBe(true);
    expect(appliesTo(kind, "evidence")).toBe(true);
    expect(requiredItems(kind)).not.toContain("metrics");
    expect(requiredItems(kind)).not.toContain("evidence");
  }
});

test("기간은 시작 월이 있고 끝 월이 있거나 진행 중이면 충족이다", () => {
  expect(judgePeriod("job", "2022-03", "2024-01", false)).toBe("met");
  expect(judgePeriod("job", "2022-03", null, true)).toBe("met");
  expect(judgePeriod("job", "2022-03", "2022-03", false)).toBe("met");
  expect(judgePeriod("job", "2022-03", null, false)).toBe("unmet");
  expect(judgePeriod("job", null, "2024-01", false)).toBe("unmet");
  expect(judgePeriod("job", null, null, true)).toBe("unmet");
});

test("끝 월이 시작 월보다 앞서거나 월 형식이 틀리면 기간 미달이다", () => {
  expect(judgePeriod("job", "2024-02", "2024-01", false)).toBe("unmet");
  expect(judgePeriod("job", "2024-13", "2024-12", false)).toBe("unmet");
  expect(judgePeriod("job", "2024-00", null, true)).toBe("unmet");
  expect(judgePeriod("job", "2024-1", null, true)).toBe("unmet");
  expect(judgePeriod("job", "2022-03", "어제", false)).toBe("unmet");
});

test("자격은 취득 월 하나로 기간을 충족한다", () => {
  expect(judgePeriod("certificate", "2023-06", null, false)).toBe("met");
  expect(judgePeriod("certificate", null, null, false)).toBe("unmet");
});

test("처음 루브릭은 적용하지 않는 항목이 na, 기간은 코드 판정, 나머지는 미판정이다", () => {
  expect(initialRubric("job", "met")).toEqual({
    period: "met",
    role: "unjudged",
    level: "unjudged",
    metrics: "unjudged",
    evidence: "unjudged",
  });
  expect(initialRubric("school", "unmet")).toEqual({
    period: "unmet",
    role: "na",
    level: "na",
    metrics: "unjudged",
    evidence: "unjudged",
  });
});

test("사용자가 확인하지 않으면 필수 항목이 모두 충족이어도 미확인이다", () => {
  expect(verificationState("job", allMet, false)).toBe("unconfirmed");
});

test("확인했고 필수 항목이 모두 충족이면 확인됨이다", () => {
  expect(verificationState("job", allMet, true)).toBe("confirmed");
});

test("확인했지만 필수 항목 중 미달이나 미판정이 있으면 부분 확인이다", () => {
  expect(verificationState("job", { ...allMet, role: "unmet" }, true)).toBe("partial");
  expect(verificationState("job", { ...allMet, level: "unjudged" }, true)).toBe("partial");
  expect(verificationState("job", { ...allMet, period: "unmet" }, true)).toBe("partial");
});

test("수치와 증빙은 어떤 상태든 확인됨을 막지 않는다", () => {
  for (const status of ["unjudged", "unmet", "closed"] as const) {
    expect(verificationState("job", { ...allMet, metrics: status, evidence: status }, true)).toBe("confirmed");
  }
});

test("학력은 기간만 충족하면 확인됨이다", () => {
  expect(verificationState("school", initialRubric("school", "met"), true)).toBe("confirmed");
  expect(verificationState("school", initialRubric("school", "unmet"), true)).toBe("partial");
});

test("재직은 AI 판정 전에는 확인해도 부분 확인에 머문다", () => {
  expect(verificationState("job", initialRubric("job", "met"), true)).toBe("partial");
});

test("닫을 수 있는 것은 수치와 증빙뿐이다", () => {
  for (const kind of KINDS) {
    expect(canClose(kind, "metrics")).toBe(true);
    expect(canClose(kind, "evidence")).toBe(true);
    expect(canClose(kind, "period")).toBe(false);
    expect(canClose(kind, "role")).toBe(false);
    expect(canClose(kind, "level")).toBe(false);
  }
});

test("내용을 고치면 판정된 항목은 미판정으로 돌아가고, 닫은 항목은 유지되며, 기간은 다시 계산한다", () => {
  const before: Rubric = { period: "met", role: "met", level: "unmet", metrics: "closed", evidence: "met" };
  expect(rubricAfterContentEdit("job", before, "unmet")).toEqual({
    period: "unmet",
    role: "unjudged",
    level: "unjudged",
    metrics: "closed",
    evidence: "unjudged",
  });
});

test("내용을 고치면서 구분을 바꾸면 새 구분에 적용하지 않는 항목은 na가 된다", () => {
  const before: Rubric = { period: "met", role: "met", level: "met", metrics: "closed", evidence: "unjudged" };
  expect(rubricAfterContentEdit("school", before, "met")).toEqual({
    period: "met",
    role: "na",
    level: "na",
    metrics: "closed",
    evidence: "unjudged",
  });
  const school = initialRubric("school", "met");
  expect(rubricAfterContentEdit("job", school, "met").role).toBe("unjudged");
});

test("지원서에는 확인됨만 쓸 수 있다", () => {
  expect(usableInApplications("confirmed")).toBe(true);
  expect(usableInApplications("partial")).toBe(false);
  expect(usableInApplications("unconfirmed")).toBe(false);
});

test("루브릭은 항상 다섯 항목을 모두 담는다", () => {
  for (const kind of KINDS) expect(Object.keys(initialRubric(kind, "met")).sort()).toEqual([...RUBRIC_ITEMS].sort());
});
