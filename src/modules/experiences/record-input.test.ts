import { describe, expect, it } from "vitest";
import { FACT_CONTENT_FIELDS, SCENE_CONTENT_FIELDS, validateFact, validateScene } from "./record-input";

const err = (r: { ok: boolean; errors?: Record<string, string> }) => (r.ok ? {} : r.errors!);

describe("validateFact", () => {
  it("학력: 필수 칸이 비면 그 칸에 오류", () => {
    const r = validateFact("education", { degree: "bachelor", status: "graduated" });
    expect(err(r).schoolName).toBeTruthy();
  });

  it("월 형식과 끝 월 순서", () => {
    expect(err(validateFact("course", { name: "a", startMonth: "2023-13" })).startMonth).toBeTruthy();
    expect(err(validateFact("course", { name: "a", startMonth: "2023-03", endMonth: "2023-01" })).endMonth).toBeTruthy();
  });

  it("재직 중이면 끝 월이 null", () => {
    const r = validateFact("job", { company: "회사", employment: "regular", startMonth: "2023-01", endMonth: "2024-01", isOngoing: true });
    expect(r.ok && r.value.endMonth).toBeNull();
  });

  it("공백은 시작·끝 월이 필수", () => {
    const r = validateFact("gap", {});
    expect(err(r).startMonth).toBeTruthy();
    expect(err(r).endMonth).toBeTruthy();
  });

  it("학력: 재학이면 졸업 월을 받지 않는다", () => {
    const r = validateFact("education", { schoolName: "대학", degree: "bachelor", status: "enrolled", endMonth: "2025-02" });
    expect(r.ok && r.value.endMonth).toBeNull();
  });

  it("학력: 학점은 척도를 넘지 못하고 척도가 필요하다", () => {
    const base = { schoolName: "대학", degree: "bachelor", status: "graduated" };
    expect(err(validateFact("education", { ...base, gpa: "4.6", gpaScale: "4.5" })).gpa).toBeTruthy();
    expect(err(validateFact("education", { ...base, gpa: "3.8" })).gpaScale).toBeTruthy();
    expect(validateFact("education", { ...base, gpa: "3.8", gpaScale: "4.5" }).ok).toBe(true);
  });

  it("학력: 고등학교는 전공이 없어도 되고 소재지는 100자까지", () => {
    const base = { schoolName: "고등학교", degree: "high", status: "graduated" };
    const r = validateFact("education", { ...base, location: " 서울 " });
    expect(r.ok && r.value.location).toBe("서울");
    expect(err(validateFact("education", { ...base, location: "가".repeat(101) })).location).toBeTruthy();
  });

  it("경력: 담당 업무는 8줄, 줄마다 100자, 빈 줄은 버린다", () => {
    const base = { company: "회사", employment: "regular" };
    expect(err(validateFact("job", { ...base, duties: Array(9).fill(0).map((_, i) => `일${i}`) })).duties).toBeTruthy();
    expect(err(validateFact("job", { ...base, duties: ["가".repeat(101)] })).duties).toBeTruthy();
    const r = validateFact("job", { ...base, duties: ["a", " ", "", "b"] });
    expect(r.ok && r.value.duties).toEqual(["a", "b"]);
  });

  it("과정 시간은 1~10000 정수", () => {
    expect(err(validateFact("course", { name: "a", hours: 0 })).hours).toBeTruthy();
    expect(err(validateFact("course", { name: "a", hours: 1.5 })).hours).toBeTruthy();
    expect(validateFact("course", { name: "a", hours: 40 }).ok).toBe(true);
  });

  it("자격: 종류와 이름이 필수", () => {
    const e = err(validateFact("credential", {}));
    expect(e.type).toBeTruthy();
    expect(e.name).toBeTruthy();
  });

  it("프로젝트: 딸린 곳은 job·education·course만, null은 개인", () => {
    expect(err(validateFact("project", { name: "p", parent: { kind: "activity", id: "x" } })).parent).toBeTruthy();
    expect(err(validateFact("project", { name: "p", parent: { kind: "job", id: " " } })).parent).toBeTruthy();
    expect(validateFact("project", { name: "p", parent: null }).ok).toBe(true);
    const r = validateFact("project", { name: "p", parent: { kind: "course", id: "c1" } });
    expect(r.ok && r.value.parent).toEqual({ kind: "course", id: "c1" });
  });

  it("활동: 이름이 필수", () => {
    expect(err(validateFact("activity", {})).name).toBeTruthy();
  });
});

describe("validateScene", () => {
  const ok = { head: { kind: "job", id: "j1" }, title: "장면" };

  it("머리와 제목이 필수", () => {
    expect(err(validateScene({ title: "x" })).head).toBeTruthy();
    expect(err(validateScene({ head: ok.head })).title).toBeTruthy();
    expect(validateScene(ok).ok).toBe(true);
  });

  it("머리 종류는 job·project·activity만", () => {
    expect(err(validateScene({ ...ok, head: { kind: "education", id: "e" } })).head).toBeTruthy();
  });

  it("긴 칸은 4000자, 수치는 10개까지", () => {
    expect(err(validateScene({ ...ok, situation: "가".repeat(4001) })).situation).toBeTruthy();
    const metrics = Array.from({ length: 11 }, (_, i) => ({ text: `m${i}`, basis: null }));
    expect(err(validateScene({ ...ok, metrics })).metrics).toBeTruthy();
  });
});

describe("내용 칸", () => {
  it("프로젝트의 parent는 내용 칸이 아니다", () => {
    expect(FACT_CONTENT_FIELDS.project).not.toContain("parent");
    expect(SCENE_CONTENT_FIELDS).toContain("head");
  });
});
