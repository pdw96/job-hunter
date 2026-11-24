import { describe, expect, it } from "vitest";
import type { CareerItemSource, CareerSource } from "@/modules/experiences/sources";
import { buildCompany, buildItem, careerText, emphasizeItems, itemCount, moveItem, removeItem, replaceItemLines, upsertItems } from "./career-entries";
import type { CareerCompany, CareerContent, CareerItem } from "./types";

const NOW = new Date("2026-11-24T00:00:00Z");

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
  tools: ["Go"],
  scope: "use",
  ...over,
});

const companySource = (id: string, over: Partial<CareerSource> = {}): CareerSource => ({
  id,
  company: `${id}사`,
  department: "개발팀",
  title: "대리",
  startMonth: "2022-01",
  endMonth: null,
  isOngoing: true,
  duties: ["서버 개발"],
  contentVersion: 1,
  scope: "use",
  items: [],
  ...over,
});

const item = (id: string, over: Partial<CareerItem> = {}): CareerItem => ({
  experienceId: id,
  contentVersion: 1,
  kind: "project",
  heading: { name: `항목 ${id}`, role: "백엔드", period: "2023.03 ~ 2023.08", tools: [] },
  detail: "full",
  emphasized: false,
  done: [{ text: `${id} 한 일`, edited: false }],
  results: [],
  writtenAt: NOW.toISOString(),
  ...over,
});

const company = (id: string, items: CareerItem[] = []): CareerCompany => ({ ...buildCompany(companySource(id)), items });
const content = (companies: CareerCompany[], commonVersion: number | null = null): CareerContent => ({ companies, commonVersion });
const ids = (c: CareerContent) => c.companies.map((co) => [co.experienceId, co.items.map((i) => i.experienceId)]);

describe("buildCompany / buildItem", () => {
  it("buildCompany는 경력 머리와 formatPeriod 기간을 만든다", () => {
    const out = buildCompany(companySource("j1"));
    expect(out).toEqual({
      experienceId: "j1",
      contentVersion: 1,
      heading: { company: "j1사", department: "개발팀", title: "대리", period: "2022.01 ~ 진행 중", duties: ["서버 개발"] },
      items: [],
    });
  });
  it("buildItem은 줄을 cleanLines로 자르고 edited false", () => {
    const out = buildItem(itemSource("p1"), "summary", true, { done: ["- 하나", "", "둘", "셋"], results: ["a", "b"] }, NOW);
    expect(out.done).toEqual([
      { text: "하나", edited: false },
      { text: "둘", edited: false },
    ]);
    expect(out.results).toEqual([{ text: "a", edited: false }]);
    expect(out.heading).toEqual({ name: "항목 p1", role: "백엔드", period: "2023.03 ~ 2023.08", tools: ["Go"] });
    expect(out.emphasized).toBe(true);
    expect(out.kind).toBe("project");
  });
});

describe("upsertItems", () => {
  const sources = [companySource("j3"), companySource("j2"), companySource("j1")];
  it("없는 회사를 원천 순서 자리에 넣는다", () => {
    const out = upsertItems(content([company("j3"), company("j1")]), sources, [{ companyId: "j2", item: item("p1") }]);
    expect(ids(out)).toEqual([["j3", []], ["j2", ["p1"]], ["j1", []]]);
  });
  it("있는 항목은 그 자리에서, 없는 항목은 회사 끝에 넣고 머리를 새로 고친다", () => {
    const base = content([company("j1", [item("a"), item("b")])]);
    const fresh = { ...sources[2], company: "새 이름" };
    const out = upsertItems(base, [fresh], [
      { companyId: "j1", item: item("a", { emphasized: true }) },
      { companyId: "j1", item: item("c") },
    ]);
    expect(out.companies[0].items.map((i) => [i.experienceId, i.emphasized])).toEqual([["a", true], ["b", false], ["c", false]]);
    expect(out.companies[0].heading.company).toBe("새 이름");
  });
});

describe("moveItem / removeItem / replaceItemLines", () => {
  const base = content([company("j1", [item("a"), item("b")]), company("j2", [item("c")])]);
  it("moveItem은 회사 경계를 넘지 않는다", () => {
    expect(ids(moveItem(base, "b", "down"))).toEqual(ids(base));
    expect(ids(moveItem(base, "c", "up"))).toEqual(ids(base));
    expect(ids(moveItem(base, "b", "up"))).toEqual([["j1", ["b", "a"]], ["j2", ["c"]]]);
  });
  it("removeItem에 경력 id를 주면 회사째 빠진다", () => {
    expect(ids(removeItem(base, "j1"))).toEqual([["j2", ["c"]]]);
    expect(ids(removeItem(base, "a"))).toEqual([["j1", ["b"]], ["j2", ["c"]]]);
  });
  it("replaceItemLines는 같은 글의 줄만 edited를 지킨다", () => {
    const withLines = content([company("j1", [item("a", { done: [{ text: "그대로", edited: false }, { text: "옛 글", edited: false }] })])]);
    const out = replaceItemLines(withLines, "a", "done", ["그대로", "새 글"]);
    expect(out.companies[0].items[0].done).toEqual([
      { text: "그대로", edited: false },
      { text: "새 글", edited: true },
    ]);
    expect(out.companies[0].items[0].results).toEqual([]);
  });
});

describe("emphasizeItems", () => {
  it("강조 항목을 회사 맨 위로 올리고 공통본의 같은 항목은 뺀다", () => {
    const sources = [companySource("j2"), companySource("j1")];
    const common = content([company("j1", [item("a"), item("b"), item("c")])]);
    const out = emphasizeItems(
      common,
      [
        { companyId: "j1", item: item("c", { emphasized: true }) },
        { companyId: "j2", item: item("z", { emphasized: true }) },
        { companyId: "j1", item: item("b", { emphasized: true }) },
      ],
      sources,
      7,
    );
    expect(ids(out)).toEqual([["j2", ["z"]], ["j1", ["c", "b", "a"]]]);
    expect(out.commonVersion).toBe(7);
    expect(common.companies[0].items).toHaveLength(3);
  });
});

describe("careerText", () => {
  it("빈 칸·빈 구역을 빼고 정한 모양으로 쓴다", () => {
    const full = item("a", {
      heading: { name: "결제", role: "백엔드", period: "2023.03 ~ 2023.08", tools: ["Go", "Redis"] },
      done: [{ text: "서버를 고쳤다", edited: false }, { text: "배포했다", edited: false }],
      results: [{ text: "응답 40% 단축", edited: false }],
    });
    const bare = item("b", { heading: { name: "정산", role: null, period: "기간 없음", tools: [] }, done: [], results: [] });
    const first = { ...company("j1", [full, bare]) };
    const second = { ...company("j2"), heading: { company: "B사", department: null, title: null, period: "2020.01 ~ 2021.12", duties: [] } };
    expect(careerText(content([first, second]))).toBe(
      [
        "j1사 | 개발팀 | 대리 | 2022.01 ~ 진행 중",
        "담당: 서버 개발",
        "■ 결제 | 백엔드 | 2023.03 ~ 2023.08",
        "기술: Go, Redis",
        "한 일",
        "- 서버를 고쳤다",
        "- 배포했다",
        "성과",
        "- 응답 40% 단축",
        "",
        "■ 정산 | 기간 없음",
        "",
        "",
        "B사 | 2020.01 ~ 2021.12",
      ].join("\n"),
    );
  });
  it("itemCount는 모든 회사의 항목 수", () => {
    expect(itemCount(content([company("j1", [item("a"), item("b")]), company("j2")]))).toBe(2);
  });
});
