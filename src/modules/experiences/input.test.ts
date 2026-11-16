import { expect, test } from "vitest";
import { validateExperience } from "./input";

const base = {
  name: "결제 시스템 개편",
  kind: "project",
  organization: "가나다 주식회사",
  role: "백엔드 개발",
  startMonth: "2023-03",
  endMonth: "2023-11",
  isOngoing: false,
  situation: "기존 결제 모듈의 장애가 잦았다",
  actions: "결제 승인 API를 다시 설계하고 구현했다",
  result: "장애가 줄었다",
  metrics: [{ text: "월 장애 5건에서 1건", basis: "사내 장애 보고서 기준" }],
  notDone: "프론트엔드는 하지 않았다",
  bannedPhrases: ["결제 시스템 전체를 혼자 구축"],
  evidenceNote: "장애 보고서 사본 보관",
  tags: ["결제", "API"],
};

const errorsOf = (input: unknown) => {
  const r = validateExperience(input);
  return r.ok ? {} : r.errors;
};
const valueOf = (input: unknown) => {
  const r = validateExperience(input);
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.value;
};

test("올바른 입력은 그대로 통과한다", () => {
  expect(valueOf(base)).toEqual(base);
});

test("이름은 필수이고 100자까지다", () => {
  expect(errorsOf({ ...base, name: " " }).name).toBeDefined();
  expect(errorsOf({ ...base, name: "가".repeat(101) }).name).toBeDefined();
});

test("구분이 목록에 없으면 오류다", () => {
  expect(errorsOf({ ...base, kind: "hobby" }).kind).toBeDefined();
});

test("빈 칸과 공백뿐인 칸은 null로 저장한다", () => {
  const value = valueOf({ ...base, organization: "  ", situation: "", notDone: undefined });
  expect(value.organization).toBeNull();
  expect(value.situation).toBeNull();
  expect(value.notDone).toBeNull();
});

test("월은 YYYY-MM이어야 하고, 끝 월이 시작 월보다 앞서면 오류다", () => {
  expect(errorsOf({ ...base, startMonth: "2023-13" }).startMonth).toBeDefined();
  expect(errorsOf({ ...base, endMonth: "23-11" }).endMonth).toBeDefined();
  expect(errorsOf({ ...base, startMonth: "2023-12", endMonth: "2023-11" }).endMonth).toBe(
    "끝 월이 시작 월보다 앞섭니다",
  );
});

test("진행 중이면 끝 월을 버린다", () => {
  const value = valueOf({ ...base, isOngoing: true });
  expect(value.endMonth).toBeNull();
  expect(value.isOngoing).toBe(true);
});

test("자격은 끝 월과 진행 중을 저장하지 않는다", () => {
  const value = valueOf({ ...base, kind: "certificate", isOngoing: true });
  expect(value.endMonth).toBeNull();
  expect(value.isOngoing).toBe(false);
});

test("수치는 내용이 빈 줄을 버리고, 근거가 비면 null로 둔다", () => {
  const value = valueOf({
    ...base,
    metrics: [
      { text: " 처리 시간 30% 단축 ", basis: " " },
      { text: "", basis: "근거만 있음" },
    ],
  });
  expect(value.metrics).toEqual([{ text: "처리 시간 30% 단축", basis: null }]);
});

test("수치는 10개까지다", () => {
  const metrics = Array.from({ length: 11 }, (_, i) => ({ text: `수치 ${i}`, basis: null }));
  expect(errorsOf({ ...base, metrics }).metrics).toBeDefined();
});

test("태그와 금지 표현은 공백을 지우고 중복을 없앤다", () => {
  const value = valueOf({ ...base, tags: [" 결제 ", "결제", "", "API"], bannedPhrases: ["주도", " 주도 "] });
  expect(value.tags).toEqual(["결제", "API"]);
  expect(value.bannedPhrases).toEqual(["주도"]);
});

test("태그는 10개까지다", () => {
  expect(errorsOf({ ...base, tags: Array.from({ length: 11 }, (_, i) => `t${i}`) }).tags).toBeDefined();
});

test("긴 글 칸은 4,000자까지다", () => {
  expect(errorsOf({ ...base, actions: "가".repeat(4001) }).actions).toBeDefined();
});

test("객체가 아닌 입력은 오류로 돌려주고 예외를 던지지 않는다", () => {
  expect(validateExperience(null).ok).toBe(false);
  expect(validateExperience({}).ok).toBe(false);
});
