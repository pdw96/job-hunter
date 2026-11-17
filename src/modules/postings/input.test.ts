import { expect, test } from "vitest";
import { isDate, validatePosting } from "./input";

const raw = {
  company: " 가나다 주식회사 ",
  title: "백엔드 개발자",
  deadline: "2026-11-30",
  isRolling: false,
  locationText: "서울 강남구",
  regions: ["seoul", "seoul"],
  careerType: "experienced",
  minYears: "3",
  employmentType: "regular",
  url: "",
  rawText: "\n공고 원문  그대로\n",
  companyNote: "  ",
};
const errorsOf = (over: Record<string, unknown>) => {
  const result = validatePosting({ ...raw, ...over });
  return result.ok ? {} : result.errors;
};

test("맞는 입력은 다듬어서 돌려준다. 원문 안쪽의 띄어쓰기는 그대로 둔다", () => {
  const result = validatePosting(raw);
  expect(result).toEqual({
    ok: true,
    value: {
      company: "가나다 주식회사",
      title: "백엔드 개발자",
      deadline: "2026-11-30",
      isRolling: false,
      locationText: "서울 강남구",
      regions: ["seoul"],
      careerType: "experienced",
      minYears: 3,
      employmentType: "regular",
      url: null,
      rawText: "공고 원문  그대로",
      companyNote: null,
    },
  });
});

test("회사명, 직무명, 원문은 꼭 있어야 한다", () => {
  expect(Object.keys(errorsOf({ company: "", title: " ", rawText: "" }))).toEqual(["company", "title", "rawText"]);
});

test("마감일은 실제로 있는 날짜여야 한다. 상시 채용이면 마감일을 비운다", () => {
  expect(isDate("2026-02-28")).toBe(true);
  expect(isDate("2026-02-30")).toBe(false);
  expect(isDate("26-2-3")).toBe(false);
  expect(errorsOf({ deadline: "2026-13-01" })).toHaveProperty("deadline");
  const rolling = validatePosting({ ...raw, isRolling: true });
  expect(rolling.ok && rolling.value.deadline).toBeNull();
});

test("지역은 목록에 있는 것만 받고, 전국 어디든은 공고의 근무지로 받지 않는다", () => {
  expect(errorsOf({ regions: ["mars"] })).toHaveProperty("regions");
  expect(errorsOf({ regions: ["anywhere"] })).toHaveProperty("regions");
  expect(errorsOf({ regions: [] })).toEqual({});
});

test("요구 경력은 0~40의 정수이거나 비어 있어야 한다", () => {
  expect(errorsOf({ minYears: "" })).toEqual({});
  expect(errorsOf({ minYears: 0 })).toEqual({});
  expect(errorsOf({ minYears: -1 })).toHaveProperty("minYears");
  expect(errorsOf({ minYears: 2.5 })).toHaveProperty("minYears");
  expect(errorsOf({ minYears: 41 })).toHaveProperty("minYears");
});

test("구분과 고용 형태는 목록의 값이어야 하고, 주소는 http로 시작해야 한다", () => {
  expect(errorsOf({ careerType: "senior" })).toHaveProperty("careerType");
  expect(errorsOf({ employmentType: "freelance" })).toHaveProperty("employmentType");
  expect(errorsOf({ url: "javascript:alert(1)" })).toHaveProperty("url");
  expect(errorsOf({ url: "https://example.com/jobs/1" })).toEqual({});
});

test("길이 한도를 넘으면 알린다", () => {
  expect(errorsOf({ rawText: "가".repeat(30_001) })).toHaveProperty("rawText");
  expect(errorsOf({ companyNote: "가".repeat(10_001) })).toHaveProperty("companyNote");
  expect(errorsOf({ company: "가".repeat(101) })).toHaveProperty("company");
});
