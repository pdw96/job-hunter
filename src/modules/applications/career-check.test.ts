import { describe, expect, it } from "vitest";
import type { CareerItemSource, CareerSource } from "@/modules/experiences/sources";
import { buildCompany } from "./career-entries";
import { checkCareer } from "./career-check";
import type { CareerCompany, CareerContent, CareerItem } from "./types";

const itemSource = (id: string, over: Partial<CareerItemSource> = {}): CareerItemSource => ({
  id,
  name: `항목 ${id}`,
  kind: "project",
  organization: "A사",
  role: "백엔드",
  startMonth: "2023-03",
  endMonth: "2023-08",
  isOngoing: false,
  situation: null,
  actions: null,
  result: null,
  notDone: null,
  bannedPhrases: [],
  contentVersion: 1,
  metrics: [],
  itemKind: "project",
  tools: [],
  scope: "use",
  ...over,
});

const companySource = (id: string, items: CareerItemSource[] = [], over: Partial<CareerSource> = {}): CareerSource => ({
  id,
  company: `${id}사`,
  department: null,
  title: null,
  startMonth: "2022-01",
  endMonth: null,
  isOngoing: true,
  duties: [],
  contentVersion: 1,
  scope: "use",
  items,
  ...over,
});

const item = (id: string, over: Partial<CareerItem> = {}): CareerItem => ({
  experienceId: id,
  contentVersion: 1,
  kind: "project",
  heading: { name: `항목 ${id}`, role: null, period: "", tools: [] },
  detail: "full",
  emphasized: false,
  done: [{ text: "한 일", edited: false }],
  results: [],
  writtenAt: "2026-11-24T00:00:00.000Z",
  ...over,
});

const company = (id: string, items: CareerItem[], over: Partial<CareerCompany> = {}): CareerCompany => ({
  ...buildCompany(companySource(id)),
  items,
  ...over,
});
const content = (companies: CareerCompany[], commonVersion: number | null = null): CareerContent => ({ companies, commonVersion });
const line = (text: string, edited = false) => ({ text, edited });

describe("checkCareer", () => {
  it("다른 회사로 옮긴 항목은 unavailable이고 새 회사의 missing이다", () => {
    const sources = [companySource("j2", [itemSource("p1")]), companySource("j1")];
    const out = checkCareer(content([company("j2", []), company("j1", [item("p1")])]), sources, null);
    expect(out.companies[1].items[0].unavailable).toBe(true);
    expect(out.missing).toEqual([{ id: "p1", name: "항목 p1", companyId: "j2" }]);
  });
  it("없는 회사는 missing에 회사와 그 항목이 함께 들어간다", () => {
    const out = checkCareer(content([]), [companySource("j1", [itemSource("p1")])], null);
    expect(out.missing).toEqual([
      { id: "j1", name: "j1사", companyId: "j1" },
      { id: "p1", name: "항목 p1", companyId: "j1" },
    ]);
  });
  it("다른 항목의 숫자는 이 항목의 근거가 아니다", () => {
    const sources = [
      companySource("j1", [
        itemSource("p1", { metrics: [{ text: "응답 40% 단축", basis: "" }] as CareerItemSource["metrics"] }),
        itemSource("p2", { metrics: [{ text: "비용 90% 절감", basis: "" }] as CareerItemSource["metrics"] }),
      ]),
    ];
    const c = content([company("j1", [item("p1", { results: [line("응답 40% 단축"), line("비용 90% 절감")] })])]);
    expect(checkCareer(c, sources, null).companies[0].items[0].ungrounded).toEqual(["90"]);
  });
  it("직접 고친 줄의 숫자는 보지 않는다", () => {
    const c = content([company("j1", [item("p1", { done: [line("처리량 77% 개선", true)] })])]);
    expect(checkCareer(c, [companySource("j1", [itemSource("p1")])], null).companies[0].items[0].ungrounded).toEqual([]);
  });
  it("금지 표현을 띄어쓰기와 상관없이 찾는다", () => {
    const c = content([company("j1", [item("p1", { done: [line("압도 적인 성과")] })])]);
    const out = checkCareer(c, [companySource("j1", [itemSource("p1", { bannedPhrases: ["압도적인"] })])], null);
    expect(out.companies[0].items[0].banned).toEqual(["압도적인"]);
  });
  it("항목 없는 회사는 표시하지 않는다", () => {
    const out = checkCareer(content([company("j1", [])]), [companySource("j1")], null);
    expect(out.companies).toEqual([{ unavailable: false, stale: false, items: [] }]);
    expect(out.missing).toEqual([]);
  });
  it("기록이 바뀌면 stale, 경력 머리가 바뀌면 회사 stale", () => {
    const c = content([company("j1", [item("p1")])]);
    const out = checkCareer(c, [companySource("j1", [itemSource("p1", { contentVersion: 2 })], { contentVersion: 3 })], null);
    expect(out.companies[0].stale).toBe(true);
    expect(out.companies[0].items[0].stale).toBe(true);
  });
  it("공통본에서만 scopeChanged", () => {
    const sources = [companySource("j1", [itemSource("p1", { scope: "summary" })])];
    const c = content([company("j1", [item("p1")])]);
    expect(checkCareer(c, sources, null).companies[0].items[0].scopeChanged).toBe(true);
    expect(checkCareer({ ...c, commonVersion: 1 }, sources, 1).companies[0].items[0].scopeChanged).toBe(false);
  });
  it("자세히 항목에 한 일이 없으면 empty", () => {
    const c = content([company("j1", [item("p1", { done: [] }), item("p2", { done: [], detail: "summary" })])]);
    const out = checkCareer(c, [companySource("j1", [itemSource("p1"), itemSource("p2")])], null);
    expect(out.companies[0].items.map((i) => i.empty)).toEqual([true, false]);
  });
  it("맞춤본은 공통본 version이 다르면 commonChanged", () => {
    const c = content([], 1);
    expect(checkCareer(c, [], 2).commonChanged).toBe(true);
    expect(checkCareer(c, [], 1).commonChanged).toBe(false);
    expect(checkCareer(content([]), [], null).commonChanged).toBe(false);
  });
  it("없는 경력은 회사 unavailable", () => {
    const out = checkCareer(content([company("j9", [item("p1")])]), [], null);
    expect(out.companies[0].unavailable).toBe(true);
    expect(out.companies[0].items[0].unavailable).toBe(true);
  });
});
