import { expect, test } from "vitest";
import { extraQuestionsFor } from "./extra-questions";
import { asksExperience, experienceMode, validateSurvey, weightsFromOrder } from "./survey";

const base = {
  name: "백엔드 개발",
  majorCode: "20",
  jobs: [{ ncsCode: "20010202", customName: null }],
  applicantType: "experienced",
  experienceMonths: 30,
  regions: ["seoul", "gyeonggi"],
  salaryMin: 4000,
  employmentTypes: ["regular"],
  importanceOrder: ["jobMatch", "location", "experience", "field", "preferred"],
  extraAnswers: { remoteWork: "prefer" },
};

function errorsOf(input: unknown) {
  const result = validateSurvey(input);
  return result.ok ? {} : result.errors;
}

function valueOf(input: unknown) {
  const result = validateSurvey(input);
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.value;
}

test("올바른 입력은 그대로 통과한다", () => {
  expect(valueOf(base)).toEqual(base);
});

test("지원 유형에 따라 일한 기간을 묻는 방식이 달라진다", () => {
  expect(asksExperience("experienced")).toBe("required");
  expect(asksExperience("any")).toBe("optional");
  expect(asksExperience("new")).toBe("skip");
  expect(asksExperience("intern")).toBe("skip");
});

test("신입·인턴은 일한 기간을 넣어 보내도 저장하지 않는다", () => {
  expect(valueOf({ ...base, applicantType: "new" }).experienceMonths).toBeNull();
  expect(valueOf({ ...base, applicantType: "intern" }).experienceMonths).toBeNull();
});

test("경력인데 일한 기간이 없으면 오류다", () => {
  expect(errorsOf({ ...base, experienceMonths: null }).experienceMonths).toBe("일한 기간을 입력해 주세요");
  expect(errorsOf({ ...base, experienceMonths: 0 }).experienceMonths).toBe("일한 기간을 입력해 주세요");
});

test("무관은 일한 기간을 비워도 된다", () => {
  expect(valueOf({ ...base, applicantType: "any", experienceMonths: null }).experienceMonths).toBeNull();
});

test("신입·인턴은 채점에서 신입 가능 여부를 보고, 경력·무관은 연차를 비교한다", () => {
  expect(experienceMode("new")).toBe("entryLevelOk");
  expect(experienceMode("intern")).toBe("entryLevelOk");
  expect(experienceMode("experienced")).toBe("compareYears");
  expect(experienceMode("any")).toBe("compareYears");
});

test("직무는 1개 이상 5개 이하여야 한다", () => {
  expect(errorsOf({ ...base, jobs: [] }).jobs).toBeDefined();
  const six = ["1", "2", "3", "4", "5", "6"].map((n) => ({ ncsCode: `2001020${n}`, customName: null }));
  expect(errorsOf({ ...base, jobs: six }).jobs).toBeDefined();
});

test("직무는 NCS 코드와 직접 입력 중 정확히 하나만 가져야 한다", () => {
  expect(errorsOf({ ...base, jobs: [{ ncsCode: null, customName: null }] }).jobs).toBeDefined();
  expect(errorsOf({ ...base, jobs: [{ ncsCode: "20010202", customName: "개발" }] }).jobs).toBeDefined();
  expect(errorsOf({ ...base, jobs: [{ ncsCode: "2001", customName: null }] }).jobs).toBeDefined();
});

test("같은 직무를 두 번 넣으면 한 번만 남고, 직접 입력은 공백을 지운다", () => {
  const jobs = [
    { ncsCode: "20010202", customName: null },
    { ncsCode: null, customName: " 그로스 해커 " },
    { ncsCode: "20010202", customName: null },
    { ncsCode: null, customName: "그로스 해커" },
  ];
  expect(valueOf({ ...base, jobs }).jobs).toEqual([
    { ncsCode: "20010202", customName: null },
    { ncsCode: null, customName: "그로스 해커" },
  ]);
});

test("지역은 1개 이상이고 목록에 있어야 하며 순서가 유지된다", () => {
  expect(errorsOf({ ...base, regions: [] }).regions).toBeDefined();
  expect(errorsOf({ ...base, regions: ["mars"] }).regions).toBeDefined();
  expect(errorsOf({ ...base, regions: ["seoul", "busan", "daegu", "incheon", "jeju", "ulsan"] }).regions).toBeDefined();
  expect(valueOf({ ...base, regions: ["busan", "seoul", "busan"] }).regions).toEqual(["busan", "seoul"]);
});

test("전국 어디든을 고르면 다른 지역은 버린다", () => {
  expect(valueOf({ ...base, regions: ["seoul", "anywhere"] }).regions).toEqual(["anywhere"]);
});

test("고용 형태는 1개 이상이고, 무관을 고르면 무관만 남는다", () => {
  expect(errorsOf({ ...base, employmentTypes: [] }).employmentTypes).toBeDefined();
  expect(errorsOf({ ...base, employmentTypes: ["slave"] }).employmentTypes).toBeDefined();
  expect(valueOf({ ...base, employmentTypes: ["regular", "any"] }).employmentTypes).toEqual(["any"]);
});

test("중요도 순서는 다섯 항목을 한 번씩 담아야 한다", () => {
  expect(errorsOf({ ...base, importanceOrder: ["jobMatch", "location"] }).importanceOrder).toBeDefined();
  expect(
    errorsOf({ ...base, importanceOrder: ["jobMatch", "jobMatch", "experience", "field", "preferred"] }).importanceOrder,
  ).toBeDefined();
});

test("순서를 배점으로 바꾸면 1위 30점, 5위 10점이고 합은 100이다", () => {
  const weights = weightsFromOrder(["location", "jobMatch", "preferred", "field", "experience"]);
  expect(weights).toEqual({ location: 30, jobMatch: 25, preferred: 20, field: 15, experience: 10 });
  expect(Object.values(weights).reduce((a, b) => a + b, 0)).toBe(100);
});

test("분야에 따라 추가 질문이 달라진다", () => {
  expect(extraQuestionsFor("20").map((q) => q.id)).toEqual(["remoteWork"]);
  expect(extraQuestionsFor("14").map((q) => q.id)).toEqual(["shiftWork", "fieldWork"]);
  expect(extraQuestionsFor("02")).toEqual([]);
});

test("그 분야에 없는 질문의 답과 선택지에 없는 답은 버린다", () => {
  expect(valueOf({ ...base, majorCode: "02", extraAnswers: { remoteWork: "prefer" } }).extraAnswers).toEqual({});
  expect(valueOf({ ...base, extraAnswers: { remoteWork: "sometimes", shiftWork: "yes" } }).extraAnswers).toEqual({});
});

test("희망 연봉은 비울 수 있고, 음수나 숫자가 아닌 값은 오류다", () => {
  expect(valueOf({ ...base, salaryMin: null }).salaryMin).toBeNull();
  expect(errorsOf({ ...base, salaryMin: -1 }).salaryMin).toBeDefined();
  expect(errorsOf({ ...base, salaryMin: "많이" }).salaryMin).toBeDefined();
  expect(errorsOf({ ...base, salaryMin: 3000.5 }).salaryMin).toBeDefined();
});

test("트랙 이름은 비어 있거나 50자를 넘으면 오류이고, 앞뒤 공백은 지운다", () => {
  expect(errorsOf({ ...base, name: "  " }).name).toBeDefined();
  expect(errorsOf({ ...base, name: "가".repeat(51) }).name).toBeDefined();
  expect(valueOf({ ...base, name: "  기획  " }).name).toBe("기획");
});

test("분야 코드와 지원 유형이 올바르지 않으면 오류다", () => {
  expect(errorsOf({ ...base, majorCode: "2" }).majorCode).toBeDefined();
  expect(errorsOf({ ...base, applicantType: "boss" }).applicantType).toBeDefined();
});

test("객체가 아닌 입력은 오류로 돌려주고 예외를 던지지 않는다", () => {
  expect(validateSurvey(null).ok).toBe(false);
  expect(validateSurvey("x").ok).toBe(false);
  expect(validateSurvey({}).ok).toBe(false);
});
