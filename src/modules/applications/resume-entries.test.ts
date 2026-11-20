import { describe, expect, it } from "vitest";
import type { ResumeSource } from "@/modules/experiences/writing";
import {
  buildEntry,
  cleanLines,
  detailFor,
  emphasize,
  moveEntry,
  parseLines,
  removeEntry,
  replaceLines,
  resumeText,
  sections,
  upsertEntries,
} from "./resume-entries";
import type { ResumeContent, ResumeEntry } from "./types";

const NOW = new Date("2026-11-18T00:00:00Z");

const source = (over: Partial<ResumeSource> = {}): ResumeSource => ({
  id: "e1",
  name: "결제 서버 개선",
  kind: "project",
  organization: "회사",
  role: "백엔드 개발",
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
  scope: "use",
  ...over,
});

const entry = (id: string, kind: ResumeEntry["kind"], over: Partial<ResumeEntry> = {}): ResumeEntry => ({
  experienceId: id,
  contentVersion: 1,
  kind,
  heading: { name: id, organization: null, role: null, period: "2023.03 ~ 2023.08" },
  detail: "full",
  emphasized: false,
  lines: [{ text: `${id} 줄`, edited: false }],
  writtenAt: "2026-11-18T00:00:00.000Z",
  ...over,
});
const content = (entries: ResumeEntry[], commonVersion: number | null = null): ResumeContent => ({ entries, commonVersion });
const ids = (c: ResumeContent) => c.entries.map((e) => e.experienceId);

describe("detailFor", () => {
  it("사용은 자세히, 요약만은 요약", () => {
    expect(detailFor("use")).toBe("full");
    expect(detailFor("summary")).toBe("summary");
  });
});

describe("buildEntry", () => {
  it("머리를 기록에서 만들고 자격은 '2023.06 취득'", () => {
    const built = buildEntry(source({ kind: "certificate", name: "정보처리기사", startMonth: "2023-06", endMonth: null }), "full", false, ["합격"], NOW);
    expect(built.heading).toEqual({ name: "정보처리기사", organization: "회사", role: "백엔드 개발", period: "2023.06 취득" });
    expect(built.lines).toEqual([{ text: "합격", edited: false }]);
    expect(built).toMatchObject({ experienceId: "e1", contentVersion: 1, kind: "certificate", detail: "full", emphasized: false, writtenAt: NOW.toISOString() });
  });
  it("코드 줄이 있으면 받은 줄 대신 코드 줄로 채운다", () => {
    const built = buildEntry(source({ kind: "school", codeLines: ["산업공학과 · 학사 · 졸업", "학점 3.8/4.5"] }), "full", false, ["AI 줄"], NOW);
    expect(built.lines).toEqual([
      { text: "산업공학과 · 학사 · 졸업", edited: false },
      { text: "학점 3.8/4.5", edited: false },
    ]);
  });
  it("담당 업무가 있으면 머리에 넣고, 빈 배열이면 넣지 않는다", () => {
    expect(buildEntry(source({ kind: "job", duties: ["결제 서버 운영", "장애 대응"] }), "full", false, [], NOW).heading.duties).toEqual([
      "결제 서버 운영",
      "장애 대응",
    ]);
    expect(buildEntry(source({ kind: "job", duties: [] }), "full", false, [], NOW).heading).not.toHaveProperty("duties");
    expect(buildEntry(source(), "full", false, [], NOW).heading).not.toHaveProperty("duties");
  });
});

describe("cleanLines", () => {
  it("글머리표를 떼고 빈 줄을 버리고 150자·max개로 자른다", () => {
    const out = cleanLines(["- 하나", "• 둘", "·  셋", "* 넷", "○ 다섯", "   ", "", "여섯"], 4);
    expect(out).toEqual(["하나", "둘", "셋", "넷"]);
    expect(cleanLines(["가".repeat(200)], 1)[0]).toHaveLength(150);
  });
  it("이모지는 반쪽으로 자르지 않는다", () => {
    const [line] = cleanLines(["😀".repeat(200)], 1);
    expect([...line]).toHaveLength(150);
    expect(line).toBe("😀".repeat(150));
  });
});

describe("parseLines", () => {
  it("줄바꿈으로 나누고 글머리표를 떼고 빈 줄을 버리되 자르지 않는다", () => {
    const long = "가".repeat(200);
    const out = parseLines(`- 하나\r\n\n  • 둘  \n${long}\n3\n4\n5\n6\n7\n8\n9`);
    expect(out).toEqual(["하나", "둘", long, "3", "4", "5", "6", "7", "8", "9"]);
  });
});

describe("upsertEntries", () => {
  it("있는 항목을 제자리에서 바꾸고 새 경력 항목은 경력 섹션 끝(프로젝트 앞)에 붙인다", () => {
    const base = content([entry("j1", "job"), entry("p1", "project"), entry("p2", "project")], 3);
    const out = upsertEntries(base, [entry("p1", "project", { lines: [{ text: "새 줄", edited: false }] }), entry("j2", "job")]);
    expect(ids(out)).toEqual(["j1", "j2", "p1", "p2"]);
    expect(out.entries[2].lines[0].text).toBe("새 줄");
    expect(out.commonVersion).toBe(3);
  });
});

describe("moveEntry", () => {
  it("다른 섹션 항목을 건너뛰고 같은 섹션의 앞 항목과 바꾼다", () => {
    const base = content([entry("p1", "project"), entry("j1", "job"), entry("p2", "project")]);
    expect(ids(moveEntry(base, "p2", "up"))).toEqual(["p2", "j1", "p1"]);
    expect(ids(moveEntry(base, "p1", "down"))).toEqual(["p2", "j1", "p1"]);
  });
  it("섹션 끝이면 그대로", () => {
    const base = content([entry("p1", "project"), entry("j1", "job")]);
    expect(moveEntry(base, "p1", "up")).toEqual(base);
    expect(moveEntry(base, "p1", "down")).toEqual(base);
    expect(moveEntry(base, "없음", "up")).toEqual(base);
  });
});

describe("removeEntry", () => {
  it("항목을 뺀다", () => {
    expect(ids(removeEntry(content([entry("a", "job"), entry("b", "job")]), "a"))).toEqual(["b"]);
  });
});

describe("replaceLines", () => {
  it("그대로인 줄의 edited를 지키고 바뀐 줄은 edited로 한다", () => {
    const base = content([
      entry("a", "job", { lines: [{ text: "첫", edited: true }, { text: "둘", edited: false }, { text: "셋", edited: false }] }),
    ]);
    const out = replaceLines(base, "a", ["첫", "둘", "다른 셋", "넷"]);
    expect(out.entries[0].lines).toEqual([
      { text: "첫", edited: true },
      { text: "둘", edited: false },
      { text: "다른 셋", edited: true },
      { text: "넷", edited: true },
    ]);
  });
});

describe("emphasize", () => {
  it("고른 경험을 섹션 맨 위로 순서대로 올리고 commonVersion을 적는다", () => {
    const common = content([entry("j1", "job"), entry("j2", "job"), entry("j3", "job"), entry("p1", "project")]);
    const out = emphasize(common, [entry("j3", "job", { emphasized: true }), entry("j2", "job", { emphasized: true })], 7);
    expect(ids(out)).toEqual(["j3", "j2", "j1", "p1"]);
    expect(out.entries[0].emphasized).toBe(true);
    expect(out.commonVersion).toBe(7);
  });
});

describe("sections", () => {
  it("경력 → … → 공백기 순서이고 빈 섹션은 뺀다", () => {
    const out = sections(content([entry("g", "gap"), entry("p", "project"), entry("j", "job"), entry("c", "certificate")]));
    expect(out.map((s) => s.label)).toEqual(["경력", "프로젝트", "자격", "공백기"]);
    expect(out[0].entries.map((e) => e.experienceId)).toEqual(["j"]);
  });
});

describe("resumeText", () => {
  it("섹션 이름, 머리, '- 줄' 모양", () => {
    const text = resumeText(
      content([
        entry("j", "job", { heading: { name: "회사A", organization: "조직", role: "개발", period: "2023.03 ~ 진행 중" }, lines: [{ text: "API 개발", edited: false }] }),
        entry("c", "certificate", { heading: { name: "정보처리기사", organization: null, role: null, period: "2023.06 취득" }, lines: [] }),
      ]),
    );
    expect(text).toBe("경력\n회사A | 조직 | 개발 | 2023.03 ~ 진행 중\n- API 개발\n\n자격\n정보처리기사 | 2023.06 취득");
  });
  it("담당 업무는 머리 아래 '담당: ' 한 줄이고, 빈 배열이면 줄이 없다", () => {
    const heading = { name: "회사A", organization: null, role: null, period: "2023.03 ~ 진행 중" };
    const withDuties = resumeText(content([entry("j", "job", { heading: { ...heading, duties: ["결제 서버 운영", "장애 대응"] } })]));
    expect(withDuties).toBe("경력\n회사A | 2023.03 ~ 진행 중\n담당: 결제 서버 운영, 장애 대응\n- j 줄");
    const empty = resumeText(content([entry("j", "job", { heading: { ...heading, duties: [] } })]));
    expect(empty).toBe("경력\n회사A | 2023.03 ~ 진행 중\n- j 줄");
  });
});
