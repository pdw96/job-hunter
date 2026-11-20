import { describe, expect, it } from "vitest";
import type { ResumeSource } from "@/modules/experiences/writing";
import { checkResume } from "./resume-check";
import type { ResumeContent, ResumeEntry } from "./types";

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
  metrics: [{ text: "응답 시간 1.2초 → 0.4초", basis: "" }] as ResumeSource["metrics"],
  scope: "use",
  ...over,
});

const entry = (over: Partial<ResumeEntry> = {}): ResumeEntry => ({
  experienceId: "e1",
  contentVersion: 1,
  kind: "project",
  heading: { name: "결제 서버 개선", organization: "회사", role: "백엔드 개발", period: "2023.03 ~ 2023.08" },
  detail: "full",
  emphasized: false,
  lines: [{ text: "응답 시간을 줄였다", edited: false }],
  writtenAt: "2026-11-18T00:00:00.000Z",
  ...over,
});
const content = (entries: ResumeEntry[], commonVersion: number | null = null): ResumeContent => ({ entries, commonVersion });
const first = (c: ResumeContent, s: ResumeSource[], v: number | null = null) => checkResume(c, s, v).entries[0];

describe("checkResume 숫자", () => {
  it("기록에 없는 숫자를 표시한다", () => {
    const out = first(content([entry({ lines: [{ text: "처리량 40% 개선", edited: false }] })]), [source()]);
    expect(out.ungrounded).toEqual(["40"]);
  });
  it("기간·수치 칸의 숫자는 통과", () => {
    const out = first(content([entry({ lines: [{ text: "2023년 3월부터 1.2초에서 0.4초로", edited: false }] })]), [source()]);
    expect(out.ungrounded).toEqual([]);
  });
  it("직접 고친 줄은 숫자를 보지 않는다", () => {
    const out = first(content([entry({ lines: [{ text: "처리량 40% 개선", edited: true }] })]), [source()]);
    expect(out.ungrounded).toEqual([]);
  });
});

describe("checkResume 금지 표현", () => {
  it("금지 표현을 표시한다", () => {
    const out = first(content([entry({ lines: [{ text: "신규 API 개발 주도", edited: false }] })]), [source({ bannedPhrases: ["주도"] })]);
    expect(out.banned).toEqual(["주도"]);
  });
  it("직접 고친 줄도 금지 표현은 본다", () => {
    const out = first(content([entry({ lines: [{ text: "신규 API 개발 주 도", edited: true }] })]), [source({ bannedPhrases: ["주도"] })]);
    expect(out.banned).toEqual(["주도"]);
  });
});

describe("checkResume 쓸 수 없음·바뀜", () => {
  it("경험이 목록에 없으면 unavailable이고 나머지는 비운다", () => {
    const out = first(content([entry({ lines: [{ text: "처리량 40% 개선", edited: false }] })]), []);
    expect(out).toEqual({ unavailable: true, structureChanged: false, empty: false, stale: false, scopeChanged: false, banned: [], ungrounded: [] });
  });
  it("항목 id가 oldIds에 있으면 structureChanged이고 unavailable은 아니다", () => {
    const old = entry({ experienceId: "old1", lines: [{ text: "처리량 40% 개선", edited: false }] });
    const out = checkResume(content([old, entry()]), [source()], null, { oldIds: new Set(["old1"]) });
    expect(out.entries[0]).toEqual({ unavailable: false, structureChanged: true, empty: false, stale: false, scopeChanged: false, banned: [], ungrounded: [] });
    expect(out.entries[1].structureChanged).toBe(false);
  });
  it("oldIds가 없으면 옛 id 항목은 지금처럼 unavailable", () => {
    const old = entry({ experienceId: "old1" });
    expect(first(content([old]), [source()]).unavailable).toBe(true);
    expect(checkResume(content([old]), [source()], null, { oldIds: new Set() }).entries[0]).toMatchObject({ unavailable: true, structureChanged: false });
  });
  it("버전이 다르면 stale", () => {
    expect(first(content([entry()]), [source({ contentVersion: 2 })]).stale).toBe(true);
    expect(first(content([entry()]), [source()]).stale).toBe(false);
  });
  it("공통본에서 사용이 요약만으로 바뀌면 scopeChanged, 맞춤본에서는 아니다", () => {
    const summary = source({ scope: "summary" });
    expect(first(content([entry()]), [summary], null).scopeChanged).toBe(true);
    expect(first(content([entry()], 2), [summary], 2).scopeChanged).toBe(false);
  });
});

describe("checkResume 빠진 것", () => {
  it("항목에 없는 쓸 수 있는 경험은 missing(sources 순서)", () => {
    const out = checkResume(content([entry()]), [source({ id: "e3" }), source(), source({ id: "e2" })], null);
    expect(out.missing).toEqual(["e3", "e2"]);
  });
  it("맞춤본은 공통본 version이 다르면 commonChanged", () => {
    expect(checkResume(content([entry()], 2), [source()], 3).commonChanged).toBe(true);
    expect(checkResume(content([entry()], 2), [source()], 2).commonChanged).toBe(false);
    expect(checkResume(content([entry()]), [source()], null).commonChanged).toBe(false);
  });
});

describe("checkResume 코드 줄", () => {
  it("코드 줄의 숫자는 근거가 있는 숫자로 본다", () => {
    const school = source({ kind: "school", codeLines: ["산업공학과 · 학사 · 졸업 · 학점 3.8/4.5"], metrics: [] });
    const out = first(content([entry({ kind: "school", lines: [{ text: "산업공학과 · 학사 · 졸업 · 학점 3.8/4.5", edited: false }] })]), [school]);
    expect(out.ungrounded).toEqual([]);
  });
  it("코드 줄 원천의 자세히 항목은 줄이 없어도 empty가 아니다", () => {
    const gap = source({ kind: "gap", codeLines: [], metrics: [] });
    expect(first(content([entry({ kind: "gap", lines: [] })]), [gap]).empty).toBe(false);
  });
});

describe("checkResume 빈 줄", () => {
  it("자세히 항목에 줄이 없으면 empty", () => {
    expect(first(content([entry({ lines: [] })]), [source()]).empty).toBe(true);
  });
  it("담당 업무가 있는 경력 항목은 줄이 없어도 empty가 아니다", () => {
    const heading = { name: "가나다 주식회사", organization: null, role: null, period: "2022.03 ~ 2024.08" };
    const job = source({ kind: "job" });
    expect(first(content([entry({ kind: "job", lines: [], heading: { ...heading, duties: ["결제 서버 운영"] } })]), [job]).empty).toBe(false);
    expect(first(content([entry({ kind: "job", lines: [], heading: { ...heading, duties: [] } })]), [job]).empty).toBe(true);
    expect(first(content([entry({ kind: "job", lines: [], heading })]), [job]).empty).toBe(true);
  });
  it("줄이 있으면 아니다", () => {
    expect(first(content([entry()]), [source()]).empty).toBe(false);
  });
  it("요약 항목, 학력·자격, 쓸 수 없는 항목은 아니다", () => {
    expect(first(content([entry({ lines: [], detail: "summary" })]), [source()]).empty).toBe(false);
    expect(first(content([entry({ lines: [], kind: "school" })]), [source({ kind: "school" })]).empty).toBe(false);
    expect(first(content([entry({ lines: [], kind: "certificate" })]), [source({ kind: "certificate" })]).empty).toBe(false);
    expect(first(content([entry({ lines: [] })]), []).empty).toBe(false);
  });
});
