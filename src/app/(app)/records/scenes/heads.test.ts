import { describe, expect, test } from "vitest";
import type { Fact, FactsByKind } from "@/modules/experiences/facts-repo";
import type { FactKind } from "@/modules/experiences/record-options";
import { headOptionsOf } from "./heads";

function fact<K extends FactKind>(kind: K, id: string, value: Record<string, unknown>): Fact<K> {
  return { kind, id, value, isConfirmed: false } as unknown as Fact<K>;
}

describe("headOptionsOf", () => {
  test("사례 소속 후보는 경력·학력·교육 기관·대내외활동·프로젝트 순서", () => {
    const facts: FactsByKind = {
      project: [fact("project", "p1", { name: "물류 대시보드" })],
      activity: [fact("activity", "a1", { name: "□□ 동아리" })],
      course: [fact("course", "c1", { name: "백엔드 부트캠프" })],
      education: [fact("education", "e1", { schoolName: "가나대" })],
      job: [fact("job", "j1", { company: "○○커머스" })],
      gap: [],
      credential: [],
    };
    const options = headOptionsOf(facts);
    expect(options.map((o) => o.label)).toEqual([
      "경력 · ○○커머스",
      "학력 · 가나대",
      "교육 기관 · 백엔드 부트캠프",
      "대내외활동 · □□ 동아리",
      "프로젝트 · 물류 대시보드",
    ]);
    expect(options.map((o) => o.value)).toEqual(["job:j1", "education:e1", "course:c1", "activity:a1", "project:p1"]);
  });
});
