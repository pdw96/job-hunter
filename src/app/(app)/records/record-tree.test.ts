import { describe, expect, test } from "vitest";
import type { Fact, FactsByKind } from "@/modules/experiences/facts-repo";
import type { FactKind, HeadRef } from "@/modules/experiences/record-options";
import type { SceneSummary } from "@/modules/experiences/scenes-repo";
import { buildRecordTree, sectionOf } from "./record-tree";

let seq = 0;
function fact<K extends FactKind>(kind: K, id: string, value: Record<string, unknown>, createdAt = new Date(2026, 0, 1, 0, 0, seq++)): Fact<K> {
  return {
    kind,
    id,
    value,
    isConfirmed: false,
    contentVersion: 0,
    source: "manual",
    trackScopes: {},
    movedFrom: null,
    createdAt,
    updatedAt: createdAt,
  } as unknown as Fact<K>;
}
const empty = (): FactsByKind => ({ education: [], course: [], job: [], gap: [], credential: [], project: [], activity: [] });
const job = (id: string, startMonth: string | null) => fact("job", id, { startMonth });
const project = (id: string, parent: { kind: string; id: string } | null, startMonth: string | null = null) =>
  fact("project", id, { startMonth, parent });
const scene = (id: string, head: HeadRef) => ({ id, head, title: id }) as unknown as SceneSummary;
const section = (tree: ReturnType<typeof buildRecordTree>, id: string) => tree.find((s) => s.id === id)!;

describe("buildRecordTree", () => {
  test("대분류는 경력·학력·교육 기관·대내외활동·개인·자격 순서다", () => {
    const tree = buildRecordTree(empty(), []);
    expect(tree.map((s) => s.id)).toEqual(["job", "school", "course", "activity", "personal", "credential"]);
    expect(tree.map((s) => s.label)).toEqual(["경력", "학력", "교육 기관", "대내외활동", "개인", "자격·어학·수상"]);
  });

  test("프로젝트는 소속 기관 아래, 소속 없으면 개인에", () => {
    const f = empty();
    f.job = [job("A", "2023-01")];
    f.education = [fact("education", "S", { startMonth: "2015-03" })];
    f.course = [fact("course", "C", { startMonth: "2022-01" })];
    f.activity = [fact("activity", "V", { startMonth: "2021-01" })];
    f.project = [
      project("pa", { kind: "job", id: "A" }),
      project("ps", { kind: "education", id: "S" }),
      project("pc", { kind: "course", id: "C" }),
      project("pv", { kind: "activity", id: "V" }),
      project("pp", null),
    ];
    const tree = buildRecordTree(f, []);
    for (const [sec, p] of [["job", "pa"], ["school", "ps"], ["course", "pc"], ["activity", "pv"]]) {
      expect(section(tree, sec).orgs[0].projects.map((x) => x.fact.id)).toEqual([p]);
    }
    expect(section(tree, "personal").projects.map((x) => x.fact.id)).toEqual(["pp"]);
    expect(section(tree, "job").projects).toEqual([]);
  });

  test("경력 묶음은 공백을 시작 월 최근 순으로 섞는다", () => {
    const f = empty();
    f.job = [job("j2023", "2023-01"), job("j2020", "2020-03")];
    f.gap = [fact("gap", "g", { startMonth: "2025-01" })];
    expect(section(buildRecordTree(f, []), "job").orgs.map((o) => o.fact.id)).toEqual(["g", "j2023", "j2020"]);
  });

  test("기관과 프로젝트는 시작 월 최근 순, 월이 없으면 아래", () => {
    const f = empty();
    f.job = [job("none", null), job("old", "2019-01"), job("new", "2024-01")];
    f.project = [project("p-none", null), project("p-old", null, "2019-01"), project("p-new", null, "2024-01")];
    const tree = buildRecordTree(f, []);
    expect(section(tree, "job").orgs.map((o) => o.fact.id)).toEqual(["new", "old", "none"]);
    expect(section(tree, "personal").projects.map((p) => p.fact.id)).toEqual(["p-new", "p-old", "p-none"]);
  });

  test("같은 시작 월이면 만든 때가 최근인 것이 위", () => {
    const f = empty();
    f.job = [fact("job", "first", { startMonth: "2024-01" }, new Date(2026, 0, 1)), fact("job", "second", { startMonth: "2024-01" }, new Date(2026, 5, 1))];
    expect(section(buildRecordTree(f, []), "job").orgs.map((o) => o.fact.id)).toEqual(["second", "first"]);
  });

  test("자격은 취득 월 최근 순", () => {
    const f = empty();
    f.credential = [
      fact("credential", "c-old", { month: "2018-05" }),
      fact("credential", "c-none", { month: null }),
      fact("credential", "c-new", { month: "2024-02" }),
    ];
    expect(section(buildRecordTree(f, []), "credential").credentials.map((c) => c.id)).toEqual(["c-new", "c-old", "c-none"]);
  });

  test("사례는 머리로 기관이나 프로젝트에 붙는다", () => {
    const f = empty();
    f.job = [job("A", "2023-01")];
    f.education = [fact("education", "S", { startMonth: "2015-03" })];
    f.project = [project("pa", { kind: "job", id: "A" })];
    const tree = buildRecordTree(f, [
      scene("s1", { kind: "job", id: "A" }),
      scene("s2", { kind: "project", id: "pa" }),
      scene("s3", { kind: "project", id: "pa" }),
      scene("s4", { kind: "education", id: "S" }),
    ]);
    const a = section(tree, "job").orgs[0];
    expect(a.scenes.map((s) => s.id)).toEqual(["s1"]);
    expect(a.projects[0].scenes).toHaveLength(2);
    expect(section(tree, "school").orgs[0].scenes).toHaveLength(1);
  });

  test("소속 기관이 목록에 없는 프로젝트는 개인에 둔다", () => {
    const f = empty();
    f.project = [project("orphan", { kind: "job", id: "missing" })];
    const tree = buildRecordTree(f, []);
    expect(section(tree, "personal").projects.map((p) => p.fact.id)).toEqual(["orphan"]);
  });
});

test("sectionOf는 저장 뒤 돌아갈 대분류를 돌려 준다", () => {
  expect(sectionOf("gap")).toBe("job");
  expect(sectionOf("job")).toBe("job");
  expect(sectionOf("education")).toBe("school");
  expect(sectionOf("course")).toBe("course");
  expect(sectionOf("activity")).toBe("activity");
  expect(sectionOf("project", { kind: "activity", id: "x" })).toBe("activity");
  expect(sectionOf("project", { kind: "education", id: "x" })).toBe("school");
  expect(sectionOf("project", null)).toBe("personal");
  expect(sectionOf("credential")).toBe("credential");
});
