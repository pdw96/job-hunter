import { describe, expect, it } from "vitest";
import type { Career } from "@/modules/applications/career-repo";
import { buildCompany } from "@/modules/applications/career-entries";
import type { CareerCompany, CareerContent, CareerItem } from "@/modules/applications/types";
import type { CareerItemSource, CareerSource } from "@/modules/experiences/sources";
import { careerEditorData } from "./editor-data";

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

const companySource = (id: string, items: CareerItemSource[] = []): CareerSource => ({
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

const company = (id: string, items: CareerItem[]): CareerCompany => ({ ...buildCompany(companySource(id)), items });

const career = (content: CareerContent | null): Career => ({
  id: "c1",
  trackId: "t1",
  postingId: null,
  version: 3,
  selection: null,
  content,
  createdAt: new Date(),
  updatedAt: new Date(),
});

describe("careerEditorData", () => {
  it("검사 결과를 회사·항목 순서에 맞춰 붙인다", () => {
    const sources = [companySource("j1", [itemSource("p1"), itemSource("p2")]), companySource("j2", [itemSource("p3")])];
    const content: CareerContent = {
      companies: [company("j1", [item("p2", { contentVersion: 0 }), item("p1")]), company("gone", [item("p9")])],
      commonVersion: null,
    };
    const data = careerEditorData(career(content), sources, null, new Map([["p1", "/records/facts/project/p1"]]))!;
    expect(data.careerId).toBe("c1");
    expect(data.version).toBe(3);
    expect(data.companies.map((view) => view.company.experienceId)).toEqual(["j1", "gone"]);
    expect(data.companies[0].check.unavailable).toBe(false);
    expect(data.companies[1].check.unavailable).toBe(true);
    const [p2, p1] = data.companies[0].items;
    expect(p2.item.experienceId).toBe("p2");
    expect(p2.check.stale).toBe(true);
    expect(p2.href).toBeNull();
    expect(p1.item.experienceId).toBe("p1");
    expect(p1.check.stale).toBe(false);
    expect(p1.href).toBe("/records/facts/project/p1");
    expect(data.companies[1].items[0].check.unavailable).toBe(true);
  });

  it("missing에 회사 id와 회사 이름을 붙인다(회사째 빠진 것은 id가 회사 id와 같다)", () => {
    const sources = [companySource("j1", [itemSource("p1"), itemSource("p2")]), companySource("j2", [itemSource("p3")])];
    const content: CareerContent = { companies: [company("j1", [item("p1")])], commonVersion: null };
    const data = careerEditorData(career(content), sources, null, new Map())!;
    expect(data.missing).toEqual([
      { id: "p2", name: "항목 p2", companyId: "j1", companyName: "j1사" },
      { id: "j2", name: "j2사", companyId: "j2", companyName: "j2사" },
      { id: "p3", name: "항목 p3", companyId: "j2", companyName: "j2사" },
    ]);
  });

  it("30개면 full", () => {
    const ids = Array.from({ length: 30 }, (_, index) => `p${index}`);
    const sources = [companySource("j1", ids.map((id) => itemSource(id)))];
    const make = (count: number): CareerContent => ({ companies: [company("j1", ids.slice(0, count).map((id) => item(id)))], commonVersion: null });
    expect(careerEditorData(career(make(29)), sources, null, new Map())!.full).toBe(false);
    expect(careerEditorData(career(make(30)), sources, null, new Map())!.full).toBe(true);
  });

  it("맞춤본은 공통본 version이 다르면 commonChanged이고 복사 글을 준다", () => {
    const sources = [companySource("j1", [itemSource("p1")])];
    const content: CareerContent = { companies: [company("j1", [item("p1")])], commonVersion: 2 };
    const data = careerEditorData(career(content), sources, 3, new Map())!;
    expect(data.commonChanged).toBe(true);
    expect(data.copyText).toContain("■ 항목 p1");
  });

  it("content가 없으면 null", () => {
    expect(careerEditorData(career(null), [companySource("j1")], null, new Map())).toBeNull();
  });
});
