import { describe, expect, it } from "vitest";
import type { WritingSource } from "@/modules/experiences/writing";
import { answerText, checkDraft, countChars } from "./check";
import type { Draft, Paragraph } from "./types";

const source = (over: Partial<WritingSource> = {}): WritingSource => ({
  id: "e1",
  name: "결제 서버 개선",
  kind: "project",
  organization: "회사",
  role: "백엔드 개발",
  startMonth: "2023-03",
  endMonth: "2023-08",
  isOngoing: false,
  situation: "응답 시간 1.2초",
  actions: "캐시를 넣었다",
  result: "안정화했다",
  notDone: null,
  bannedPhrases: [],
  contentVersion: 1,
  metrics: [],
  ...over,
});

const paragraph = (over: Partial<Paragraph> = {}): Paragraph => ({ text: "캐시를 넣었다", sources: ["e1"], edited: false, ...over });
const draft = (paragraphs: Paragraph[], over: Partial<Draft> = {}): Draft => ({
  questionVersion: 1,
  basedOn: [{ experienceId: "e1", contentVersion: 1 }],
  paragraphs,
  shortage: "",
  writtenAt: "2026-11-18T00:00:00Z",
  ...over,
});
const question = { prompt: "지원 동기", charLimit: null, countSpaces: true, version: 1 };

describe("countChars", () => {
  it("공백 포함은 줄바꿈까지 세고 공백 제외는 모든 공백을 뺀다", () => {
    expect(countChars("가 나\n다", true)).toBe(5);
    expect(countChars("가 나\n다", false)).toBe(3);
  });

  it("이모지 하나는 1", () => {
    expect(countChars("👍", true)).toBe(1);
  });
});

describe("answerText / 글자 수", () => {
  it("문단을 줄바꿈 하나로 잇는다", () => {
    expect(answerText(draft([paragraph({ text: "가" }), paragraph({ text: "나" })]))).toBe("가\n나");
  });

  it("제한을 넘으면 over, 제한이 없으면 over false", () => {
    const d = draft([paragraph({ text: "가나다" }), paragraph({ text: "라마" })]);
    expect(checkDraft(d, { ...question, charLimit: 5 }, [source()]).length).toEqual({ count: 6, limit: 5, over: true });
    expect(checkDraft(d, { ...question, charLimit: 6 }, [source()]).length.over).toBe(false);
    expect(checkDraft(d, question, [source()]).length).toEqual({ count: 6, limit: null, over: false });
  });

  it("공백 제외 기준으로 센다", () => {
    const d = draft([paragraph({ text: "가 나" })]);
    expect(checkDraft(d, { ...question, countSpaces: false, charLimit: 2 }, [source()]).length).toEqual({ count: 2, limit: 2, over: false });
  });
});

describe("숫자 검사", () => {
  it("기록에 없는 숫자를 표시한다", () => {
    const result = checkDraft(draft([paragraph({ text: "응답 시간을 40% 개선했다" })]), question, [source()]);
    expect(result.paragraphs[0].ungrounded).toEqual(["40"]);
  });

  it("글 칸, 기간, 수치 칸과 문항 글의 숫자는 통과", () => {
    const s = source({ metrics: [{ text: "처리량 300건", basis: "대시보드 7일 평균" }] });
    const text = "1.2초 걸리던 것을 2023년 3월부터 300건, 7일, 500자 안에 썼다";
    const result = checkDraft(draft([paragraph({ text })]), { ...question, prompt: "500자 이내" }, [s]);
    expect(result.paragraphs[0].ungrounded).toEqual([]);
  });

  it("그 문단의 근거 경험만 본다", () => {
    const other = source({ id: "e2", situation: "사용자 99명" });
    const d = draft([paragraph({ text: "99명이 썼다", sources: ["e1"] })], {
      basedOn: [
        { experienceId: "e1", contentVersion: 1 },
        { experienceId: "e2", contentVersion: 1 },
      ],
    });
    expect(checkDraft(d, question, [source(), other]).paragraphs[0].ungrounded).toEqual(["99"]);
  });

  it("직접 수정한 문단은 숫자·근거 검사를 하지 않는다", () => {
    const p = paragraph({ text: "40% 개선했다", sources: [], edited: true });
    const result = checkDraft(draft([p]), question, [source()]);
    expect(result.paragraphs[0]).toMatchObject({ ungrounded: [], noSource: false });
  });
});

describe("금지 표현", () => {
  it("금지 표현을 표시한다", () => {
    const s = source({ bannedPhrases: ["주도"] });
    const result = checkDraft(draft([paragraph({ text: "프로젝트를 주도하며" })]), question, [s]);
    expect(result.paragraphs[0].banned).toEqual(["주도"]);
  });

  it("공백·대소문자를 무시하고 저장된 표기로 한 번만 돌려준다", () => {
    const s = source({ bannedPhrases: ["Lead er", "리더 십"] });
    const result = checkDraft(draft([paragraph({ text: "LEADER로서 leader 일을 했고 리더십도 보였다" })]), question, [s]);
    expect(result.paragraphs[0].banned).toEqual(["Lead er", "리더 십"]);
  });

  it("직접 수정한 문단도 금지 표현은 본다", () => {
    const s = source({ bannedPhrases: ["주도"] });
    const p = paragraph({ text: "주도했다", sources: [], edited: true });
    expect(checkDraft(draft([p]), question, [s]).paragraphs[0].banned).toEqual(["주도"]);
  });

  it("basedOn에 없는 경험의 금지 표현은 보지 않는다", () => {
    const s = source({ bannedPhrases: ["주도"] });
    const d = draft([paragraph({ text: "주도했다" })], { basedOn: [] });
    expect(checkDraft(d, question, [s]).paragraphs[0].banned).toEqual([]);
  });
});

describe("근거 검사", () => {
  it("근거 없는 문단을 표시한다", () => {
    const result = checkDraft(draft([paragraph({ sources: [] })]), question, [source()]);
    expect(result.paragraphs[0].noSource).toBe(true);
  });

  it("승인 목록에 없는 id만 있으면 noSource", () => {
    const result = checkDraft(draft([paragraph({ sources: ["e9"] })]), question, [source(), source({ id: "e9" })]);
    expect(result.paragraphs[0].noSource).toBe(true);
  });

  it("근거 경험이 바뀌거나 사라지면 staleSource", () => {
    const p = [paragraph()];
    expect(checkDraft(draft(p), question, [source()]).paragraphs[0].staleSource).toBe(false);
    expect(checkDraft(draft(p), question, [source({ contentVersion: 2 })]).paragraphs[0].staleSource).toBe(true);
    expect(checkDraft(draft(p), question, []).paragraphs[0].staleSource).toBe(true);
  });

  it("직접 수정한 문단도 근거 경험이 사라지면 staleSource", () => {
    const p = paragraph({ edited: true });
    expect(checkDraft(draft([p]), question, []).paragraphs[0].staleSource).toBe(true);
  });

  it("basedOn에 없는 id는 지금 목록에 있으면 stale로 보지 않는다", () => {
    const p = paragraph({ sources: ["e9"] });
    expect(checkDraft(draft([p]), question, [source({ id: "e9", contentVersion: 5 })]).paragraphs[0].staleSource).toBe(false);
  });
});

describe("문항 변경", () => {
  it("문항 version이 다르면 questionChanged", () => {
    expect(checkDraft(draft([paragraph()]), { ...question, version: 2 }, [source()]).questionChanged).toBe(true);
    expect(checkDraft(draft([paragraph()]), question, [source()]).questionChanged).toBe(false);
  });
});
