import type { Fact, FactsByKind } from "@/modules/experiences/facts-repo";
import type { FactKind, ProjectParent } from "@/modules/experiences/record-options";
import type { SceneSummary } from "@/modules/experiences/scenes-repo";

// 이력·경험 사례 두 화면이 같이 쓰는 대분류 묶음. 화면 파일이므로 모듈에서는 타입만 가져온다

export type SectionId = "job" | "school" | "course" | "activity" | "personal" | "credential";

export const SECTIONS: { id: SectionId; label: string }[] = [
  { id: "job", label: "경력" },
  { id: "school", label: "학력" },
  { id: "course", label: "교육 기관" },
  { id: "activity", label: "대내외활동" },
  { id: "personal", label: "개인" },
  { id: "credential", label: "자격·어학·수상" },
];

export type ProjectNode = { fact: Fact<"project">; scenes: SceneSummary[] };
export type OrgNode = {
  fact: Fact<"job" | "gap" | "education" | "course" | "activity">;
  scenes: SceneSummary[];
  projects: ProjectNode[];
};
export type Section = {
  id: SectionId;
  label: string;
  orgs: OrgNode[];
  projects: ProjectNode[]; // personal에서만 찬다
  credentials: Fact<"credential">[]; // credential에서만 찬다
};

type OrgKind = "job" | "education" | "course" | "activity";
const SECTION_OF_ORG: Record<OrgKind | "gap", SectionId> = {
  job: "job",
  gap: "job",
  education: "school",
  course: "course",
  activity: "activity",
};

export function sectionOf(kind: FactKind, parent?: ProjectParent): SectionId {
  if (kind === "project") return parent ? SECTION_OF_ORG[parent.kind] : "personal";
  if (kind === "credential") return "credential";
  return SECTION_OF_ORG[kind];
}

// 시작 월 최근 순, 월이 없으면 아래, 같으면 만든 때가 최근인 것이 위
function byRecent<T>(items: T[], start: (item: T) => string | null | undefined, createdAt: (item: T) => Date): T[] {
  return [...items].sort((a, b) => {
    const sa = start(a) ?? null;
    const sb = start(b) ?? null;
    if (sa !== sb) {
      if (sa === null) return 1;
      if (sb === null) return -1;
      return sa < sb ? 1 : -1;
    }
    return createdAt(b).getTime() - createdAt(a).getTime();
  });
}

const startOf = (fact: Fact): string | null => {
  const value = fact.value as { startMonth?: string | null; month?: string | null };
  return (fact.kind === "credential" ? value.month : value.startMonth) ?? null;
};
const sortFacts = <T extends Fact>(facts: T[]): T[] => byRecent(facts, startOf, (f) => f.createdAt);

export function buildRecordTree(facts: FactsByKind, scenes: SceneSummary[]): Section[] {
  const scenesOf = new Map<string, SceneSummary[]>();
  for (const scene of scenes) {
    const list = scenesOf.get(scene.head.id) ?? [];
    list.push(scene);
    scenesOf.set(scene.head.id, list);
  }
  const scenesFor = (id: string) => scenesOf.get(id) ?? [];

  const orgs = new Map<string, OrgNode>();
  const bySection = new Map<SectionId, OrgNode[]>();
  const orgList = (
    [
      ...facts.job,
      ...facts.gap,
      ...facts.education,
      ...facts.course,
      ...facts.activity,
    ] as OrgNode["fact"][]
  );
  for (const fact of sortFacts(orgList)) {
    const node: OrgNode = { fact, scenes: scenesFor(fact.id), projects: [] };
    orgs.set(fact.id, node);
    const id = SECTION_OF_ORG[fact.kind];
    bySection.set(id, [...(bySection.get(id) ?? []), node]);
  }

  const personal: ProjectNode[] = [];
  for (const fact of sortFacts(facts.project)) {
    const node: ProjectNode = { fact, scenes: scenesFor(fact.id) };
    const parent = fact.value.parent;
    const org = parent ? orgs.get(parent.id) : undefined;
    if (org && org.fact.kind === parent?.kind) org.projects.push(node);
    else personal.push(node);
  }

  return SECTIONS.map(({ id, label }) => ({
    id,
    label,
    orgs: bySection.get(id) ?? [],
    projects: id === "personal" ? personal : [],
    credentials: id === "credential" ? sortFacts(facts.credential) : [],
  }));
}
