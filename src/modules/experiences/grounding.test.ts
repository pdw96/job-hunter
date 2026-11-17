import { expect, test } from "vitest";
import { numbersIn, ungroundedNumbers } from "./grounding";
import type { ExperienceInput } from "./input";

const draft: ExperienceInput = {
  name: "결제 시스템 개편",
  kind: "project",
  organization: null,
  role: null,
  startMonth: "2023-03",
  endMonth: "2023-11",
  isOngoing: false,
  situation: "월 장애가 5건 있었다",
  actions: "API를 다시 설계했다",
  result: "장애가 1건으로 줄었다",
  metrics: [{ text: "월 장애 5건에서 1건", basis: "전후 3개월 평균" }],
  notDone: null,
  bannedPhrases: [],
  evidenceNote: null,
  tags: [],
};
const said = ["2023년 3월부터 11월까지 했어요", "장애가 한 달에 5건이었는데 1건으로 줄었습니다. 전후 3개월 평균이에요"];

test("사용자가 말한 숫자만 있으면 경고가 없다", () => {
  expect(ungroundedNumbers(draft, said)).toEqual({});
});

test("대화에 없던 숫자가 있는 칸을 찾아 그 숫자를 알려 준다", () => {
  const found = ungroundedNumbers(
    { ...draft, result: "처리 시간을 30% 단축했다", metrics: [{ text: "응답 속도 2배", basis: "40명 대상 측정" }] },
    said,
  );
  expect(found).toEqual({ result: ["30"], metrics: ["2", "40"] });
});

test("쉼표와 전각 숫자, 앞자리 0이 달라도 같은 숫자로 본다", () => {
  expect(ungroundedNumbers({ ...draft, result: "1,200건 처리, ５건" }, [...said, "1200건을 처리했어요"])).toEqual({});
  expect(ungroundedNumbers({ ...draft, result: "1,200건 처리" }, said)).toEqual({ result: ["1200"] });
});

test("기간은 표기가 달라도 말한 연도와 월이면 경고가 없고, 말하지 않은 달이면 경고한다", () => {
  expect(ungroundedNumbers({ ...draft, endMonth: "2023-12" }, said)).toEqual({ endMonth: ["12"] });
  expect(ungroundedNumbers({ ...draft, startMonth: "2022-03" }, said)).toEqual({ startMonth: ["2022"] });
});

test("소수는 통째로 한 숫자로 본다", () => {
  expect(ungroundedNumbers({ ...draft, result: "평점 4.5" }, [...said, "평점이 4.5였어요"])).toEqual({});
  expect(ungroundedNumbers({ ...draft, result: "평점 4.5" }, said)).toEqual({ result: ["4.5"] });
});

test("숫자가 없는 초안은 경고가 없다", () => {
  expect(ungroundedNumbers({ ...draft, startMonth: null, endMonth: null, situation: null, result: null, metrics: [] }, [])).toEqual({});
});

test("점이나 빗금으로 적은 날짜는 소수가 아니라 연도와 월로 본다", () => {
  const sources = ["결제 시스템 개편 (2023.03 ~ 2023.11), 2024/1/15 발표"];
  expect(ungroundedNumbers({ ...draft, situation: null, result: null, metrics: [] }, sources)).toEqual({});
  expect(ungroundedNumbers({ ...draft, situation: "2024년 1월 15일에 발표했다", result: null, metrics: [] }, sources)).toEqual({});
});

test("소수로 적은 금액은 날짜로 보지 않는다", () => {
  expect(numbersIn("매출 1200.50만원")).toEqual(["1200.5"]);
  expect(numbersIn("매출 1200.5만원")).toEqual(["1200.5"]);
  expect(numbersIn("2023.03 ~ 2023.11.")).toEqual(["2023", "3", "2023", "11"]);
});
