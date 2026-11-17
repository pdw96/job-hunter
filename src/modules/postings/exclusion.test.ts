import { expect, test } from "vitest";
import { daysLeft, exclusionReasons } from "./exclusion";

const today = "2026-11-17";
const posting = {
  deadline: "2026-11-30",
  isRolling: false,
  regions: ["seoul"],
  careerType: "both" as const,
  minYears: null as number | null,
  employmentType: "regular" as const,
};
const track = {
  applicantType: "experienced" as const,
  experienceMonths: 36 as number | null,
  regions: ["seoul", "gyeonggi"],
  employmentTypes: ["regular" as const],
};

test("조건이 모두 맞으면 사유가 없다", () => {
  expect(exclusionReasons(posting, track, today)).toEqual([]);
});

test("마감일이 오늘보다 앞이면 걸린다. 오늘이 마감이면 걸리지 않는다", () => {
  expect(exclusionReasons({ ...posting, deadline: "2026-11-16" }, track, today)).toEqual(["deadline_passed"]);
  expect(exclusionReasons({ ...posting, deadline: today }, track, today)).toEqual([]);
});

test("상시 채용이거나 마감일을 모르면 마감으로 걸리지 않는다", () => {
  expect(exclusionReasons({ ...posting, deadline: "2020-01-01", isRolling: true }, track, today)).toEqual([]);
  expect(exclusionReasons({ ...posting, deadline: null }, track, today)).toEqual([]);
});

test("요구 경력이 내 경력보다 2년 넘게 높으면 걸린다", () => {
  // 내 경력 3년: 5년까지는 걸리지 않고 6년부터 걸린다
  expect(exclusionReasons({ ...posting, minYears: 5 }, track, today)).toEqual([]);
  expect(exclusionReasons({ ...posting, minYears: 6 }, track, today)).toEqual(["experience_too_high"]);
});

test("요구 연차나 내 경력을 모르면 경력으로 걸리지 않는다", () => {
  expect(exclusionReasons({ ...posting, minYears: null, careerType: "experienced" }, track, today)).toEqual([]);
  expect(exclusionReasons({ ...posting, minYears: 10 }, { ...track, experienceMonths: null }, today)).toEqual([]);
});

test("신입·인턴 트랙은 경력만 뽑는 공고가 걸린다", () => {
  const entry = { ...track, applicantType: "new" as const, experienceMonths: null };
  expect(exclusionReasons({ ...posting, careerType: "experienced", minYears: 1 }, entry, today)).toEqual(["experienced_only"]);
  expect(exclusionReasons({ ...posting, careerType: "both", minYears: 3 }, entry, today)).toEqual([]);
  expect(exclusionReasons({ ...posting, careerType: "any" }, { ...entry, applicantType: "intern" }, today)).toEqual([]);
});

test("근무지가 희망 지역과 하나도 겹치지 않으면 걸린다", () => {
  expect(exclusionReasons({ ...posting, regions: ["busan"] }, track, today)).toEqual(["location_outside"]);
  expect(exclusionReasons({ ...posting, regions: ["busan", "gyeonggi"] }, track, today)).toEqual([]);
});

test("전국 어디든이거나 공고의 지역을 모르면 근무지로 걸리지 않는다", () => {
  expect(exclusionReasons({ ...posting, regions: ["busan"] }, { ...track, regions: ["anywhere"] }, today)).toEqual([]);
  expect(exclusionReasons({ ...posting, regions: [] }, track, today)).toEqual([]);
});

test("고용 형태가 희망에 없으면 걸린다. 무관이거나 공고에 없으면 걸리지 않는다", () => {
  expect(exclusionReasons({ ...posting, employmentType: "contract" }, track, today)).toEqual(["employment_mismatch"]);
  expect(exclusionReasons({ ...posting, employmentType: "contract" }, { ...track, employmentTypes: ["any"] }, today)).toEqual([]);
  expect(exclusionReasons({ ...posting, employmentType: "unknown" }, track, today)).toEqual([]);
});

test("여러 사유가 함께 걸린다", () => {
  expect(
    exclusionReasons({ ...posting, deadline: "2026-01-01", regions: ["jeju"], employmentType: "intern", minYears: 9 }, track, today),
  ).toEqual(["deadline_passed", "experience_too_high", "location_outside", "employment_mismatch"]);
});

test("마감까지 남은 날을 센다", () => {
  expect(daysLeft("2026-11-20", today)).toBe(3);
  expect(daysLeft(today, today)).toBe(0);
  expect(daysLeft("2026-11-10", today)).toBe(-7);
  expect(daysLeft(null, today)).toBeNull();
});
