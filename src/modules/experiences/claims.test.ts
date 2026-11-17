import { expect, test } from "vitest";
import { blocksConfirmation, claimsAfterEdit, type Claim, findClaims, mergeClaims, stillPresent } from "./claims";
import type { ExperienceInput } from "./input";

const base: ExperienceInput = {
  name: "결제 시스템 개편",
  kind: "project",
  organization: "가나다 주식회사",
  role: "백엔드 개발",
  startMonth: "2023-03",
  endMonth: "2023-11",
  isOngoing: false,
  situation: "기존 결제 모듈의 장애가 잦았다.",
  actions: "결제 승인 API 개선 프로젝트를 주도했다. 테스트 코드를 작성했다.",
  result: "장애가 80% 감소했다. 팀 분위기가 좋아졌다.",
  metrics: [{ text: "월 장애 5건에서 1건", basis: null }],
  notDone: null,
  bannedPhrases: [],
  evidenceNote: null,
  tags: [],
};

const quotes = (input: ExperienceInput, kind: string) =>
  findClaims(input)
    .filter((claim) => claim.kind === kind)
    .map((claim) => claim.quote);

test("기간이 있으면 기간 주장이 하나 생긴다", () => {
  expect(quotes(base, "period")).toEqual(["2023-03 ~ 2023-11"]);
  expect(quotes({ ...base, isOngoing: true, endMonth: null }, "period")).toEqual(["2023-03 ~ 진행 중"]);
  expect(quotes({ ...base, kind: "certificate", endMonth: null }, "period")).toEqual(["2023-03 취득"]);
  expect(quotes({ ...base, startMonth: null, endMonth: null }, "period")).toEqual([]);
});

test("수치 칸의 줄과 본문의 숫자가 든 문장이 수치 주장이 된다", () => {
  expect(quotes(base, "metric")).toEqual(["월 장애 5건에서 1건", "장애가 80% 감소했다."]);
});

test("숫자가 없는 문장은 수치 주장이 아니다", () => {
  expect(quotes(base, "metric")).not.toContain("팀 분위기가 좋아졌다.");
  expect(quotes(base, "metric")).not.toContain("기존 결제 모듈의 장애가 잦았다.");
});

test("날짜만 있는 문장은 수치 주장이 아니다", () => {
  const input = { ...base, situation: "2023년 3월에 시작했다. 2023.03 ~ 2023.11 동안 진행했다.", result: null, metrics: [] };
  expect(quotes(input, "metric")).toEqual([]);
});

test("과장되기 쉬운 낱말이 든 문장이 역할 주장이 되고, 금지할 표현은 그 낱말이다", () => {
  const role = findClaims(base).filter((claim) => claim.kind === "role");
  expect(role).toEqual([
    { kind: "role", quote: "결제 승인 API 개선 프로젝트를 주도했다.", phrase: "주도", origin: "code" },
  ]);
  expect(quotes({ ...base, actions: "배포 자동화를 혼자 구축하고 운영을 총괄했다" }, "role")).toEqual([
    "배포 자동화를 혼자 구축하고 운영을 총괄했다",
  ]);
});

test("과장 낱말이 없는 평범한 문장은 역할 주장이 아니다", () => {
  expect(quotes({ ...base, actions: "테스트 코드를 작성했다. 문서를 정리했다." }, "role")).toEqual([]);
});

test("줄바꿈과 글머리 기호로 나뉜 줄도 따로 본다", () => {
  const input = { ...base, actions: "- 인덱스 2개 추가\n- 응답 시간 측정\n• 팀 리딩", result: null, metrics: [] };
  expect(quotes(input, "metric")).toEqual(["인덱스 2개 추가"]);
  expect(quotes(input, "role")).toEqual(["팀 리딩"]);
});

test("AI가 짚은 구절은 본문에 실제로 있을 때만 더해지고, 겹치면 하나로 합친다", () => {
  const merged = mergeClaims(findClaims(base), ["결제 승인 API 개선 프로젝트를 주도했다.", "장애 제로 달성", "테스트 코드를 작성했다."], base);
  const role = merged.filter((claim) => claim.kind === "role");
  expect(role.map((claim) => claim.quote)).toEqual(["결제 승인 API 개선 프로젝트를 주도했다.", "테스트 코드를 작성했다."]);
  expect(role[1]).toMatchObject({ origin: "ai", phrase: "테스트 코드를 작성했다." });
});

test("주장은 30개까지만 만든다", () => {
  const actions = Array.from({ length: 50 }, (_, i) => `작업 ${i + 1}건을 처리했다`).join("\n");
  expect(mergeClaims(findClaims({ ...base, actions }), [], base).length).toBe(30);
});

const claim = (over: Partial<Claim>): Claim => ({
  id: "c1",
  kind: "metric",
  quote: "장애가 80% 감소했다.",
  phrase: null,
  origin: "code",
  status: "pending",
  ...over,
});

test("구절이 기록에 남아 있는지 본다", () => {
  expect(stillPresent(claim({}), base)).toBe(true);
  expect(stillPresent(claim({}), { ...base, result: "장애가 줄었다." })).toBe(false);
  expect(stillPresent(claim({ kind: "period", quote: "2023-03 ~ 2023-11" }), base)).toBe(true);
  expect(stillPresent(claim({ kind: "period", quote: "2023-03 ~ 2023-11" }), { ...base, endMonth: "2023-12" })).toBe(false);
  expect(stillPresent(claim({ quote: "월 장애 5건에서 1건" }), { ...base, metrics: [] })).toBe(false);
});

test("열린 주장(대기, 고쳐야 함)이 있으면 확인을 막는다", () => {
  expect(blocksConfirmation([claim({ status: "confirmed" }), claim({ status: "fixed" }), claim({ status: "removed" })])).toBe(false);
  expect(blocksConfirmation([claim({ status: "confirmed" }), claim({ status: "pending" })])).toBe(true);
  expect(blocksConfirmation([claim({ status: "needs_fix" })])).toBe(true);
  expect(blocksConfirmation([])).toBe(false);
});

test("고쳐야 하는 구절을 본문에서 지우면 fixed가 된다", () => {
  const existing = [claim({ id: "a", status: "needs_fix" })];
  const result = claimsAfterEdit(existing, { ...base, result: "장애가 줄었다.", metrics: [], startMonth: null, actions: null });
  expect(result.updates).toEqual([{ id: "a", status: "fixed" }]);
});

test("확인한 주장은 구절이 남아 있으면 유지되고, 사라지면 지워진다", () => {
  const existing = [claim({ id: "a", status: "confirmed" })];
  expect(claimsAfterEdit(existing, base).updates).toEqual([]);
  expect(claimsAfterEdit(existing, base).deletes).toEqual([]);
  expect(claimsAfterEdit(existing, { ...base, result: "장애가 줄었다." }).deletes).toEqual(["a"]);
});

test("본문에 새로 생긴 숫자와 과장 낱말은 새 대기 주장이 된다", () => {
  const existing = findClaims(base).map((found, index) => ({ ...found, id: `c${index}`, status: "confirmed" as const }));
  const result = claimsAfterEdit(existing, { ...base, result: "장애가 80% 감소했다. 응답 속도를 3배 높였다." });
  expect(result.adds).toEqual([{ kind: "metric", quote: "응답 속도를 3배 높였다.", phrase: null, origin: "code" }]);
  expect(result.deletes).toEqual([]);
});

test("고쳤다가 같은 구절을 다시 써 넣으면 다시 대기로 돌아간다", () => {
  const existing = [claim({ id: "a", status: "fixed" }), claim({ id: "b", quote: "월 장애 5건에서 1건", status: "removed" })];
  const result = claimsAfterEdit(existing, { ...base, actions: null, startMonth: null });
  expect(result.updates).toEqual([
    { id: "a", status: "pending" },
    { id: "b", status: "pending" },
  ]);
  expect(result.adds).toEqual([]);
});

test("긴 문장은 조각으로 나눠 뒤쪽의 숫자와 과장 낱말도 찾는다", () => {
  const long = `${"가나다라 ".repeat(50)}끝에 매출이 37% 늘었고 이 일을 총괄했다.`;
  const input = { ...base, situation: null, actions: long, result: null, metrics: [] };
  const found = findClaims(input);
  const metric = found.find((claim) => claim.kind === "metric");
  const role = found.find((claim) => claim.kind === "role");
  expect(metric?.quote).toContain("37%");
  expect(role?.quote).toContain("총괄");
  for (const claim of found) {
    expect(claim.quote.length).toBeLessThanOrEqual(200);
    expect(stillPresent(claim, input)).toBe(true);
  }
});

test("닫힌 옛 주장이 30개여도 새 숫자는 새 주장이 되고, 옛 것이 그만큼 지워진다", () => {
  const old: Claim[] = Array.from({ length: 30 }, (_, index) => ({
    id: `old${index}`,
    kind: "metric",
    quote: `옛 수치 ${index + 100}건`,
    phrase: null,
    origin: "code",
    status: index % 2 === 0 ? "fixed" : "removed",
  }));
  const input = { ...base, startMonth: null, endMonth: null, actions: null, metrics: [], result: "매출이 37% 늘었다." };
  const { adds, deletes, updates } = claimsAfterEdit(old, input);
  expect(adds.map((claim) => claim.quote)).toEqual(["매출이 37% 늘었다."]);
  expect(deletes).toEqual(["old0"]);
  expect(updates).toEqual([]);
});

test("긴 수치 줄은 조각으로 나눠 뒤쪽 숫자도 묻고, 그 숫자를 고치면 주장이 닫힌다", () => {
  const text = `${"가나다라 ".repeat(50)}그래서 매출이 37% 늘었다`;
  const input = { ...base, startMonth: null, endMonth: null, situation: null, actions: null, result: null, metrics: [{ text, basis: null }] };
  const found = findClaims(input);
  expect(found).toHaveLength(2);
  expect(found[1].quote).toContain("37%");
  const existing: Claim[] = found.map((claim, index) => ({ ...claim, id: `c${index}`, status: "needs_fix" }));
  const edited = { ...input, metrics: [{ text: text.replace("37%", "12%"), basis: null }] };
  const { updates, adds } = claimsAfterEdit(existing, edited);
  expect(updates).toEqual([{ id: "c1", status: "fixed" }]);
  expect(adds.map((claim) => claim.quote).join()).toContain("12%");
});
