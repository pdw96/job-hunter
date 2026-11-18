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
    expect(out).toEqual({ unavailable: true, stale: false, scopeChanged: false, banned: [], ungrounded: [] });
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
