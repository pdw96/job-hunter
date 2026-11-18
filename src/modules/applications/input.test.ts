import { describe, expect, it } from "vitest";
import { detectLimit, splitQuestions, validateQuestion } from "./input";

describe("splitQuestions", () => {
  it("번호 붙은 세 문항을 나눈다", () => {
    expect(splitQuestions("1. 지원 동기 (500자)\n2) 입사 후 포부\nQ3 협업 경험")).toEqual([
      "지원 동기 (500자)",
      "입사 후 포부",
      "협업 경험",
    ]);
  });

  it("번호가 없으면 통째로 하나", () => {
    expect(splitQuestions("  지원 동기를 적어 주세요.\n구체적으로 쓰세요.  ")).toEqual(["지원 동기를 적어 주세요.\n구체적으로 쓰세요."]);
  });

  it("문항 1, 문항 2 표기를 나눈다", () => {
    expect(splitQuestions("문항 1. 지원 동기\n문항 2: 포부\n문항 3\n협업 경험")).toEqual(["지원 동기", "포부", "협업 경험"]);
  });

  it("번호 없는 줄은 앞 문항에 이어 붙이고, 빈 문항은 버린다", () => {
    expect(splitQuestions("1. 지원 동기\n자세히 적어 주세요\n\n2.\n3. 포부")).toEqual(["지원 동기\n자세히 적어 주세요", "포부"]);
  });

  it("줄 맨 앞의 소수나 연도는 번호로 보지 않는다", () => {
    expect(splitQuestions("1. 성과\n1.5배 성장한 경험\n2023년 일")).toEqual(["성과\n1.5배 성장한 경험\n2023년 일"]);
  });

  it("빈 글은 빈 목록", () => {
    expect(splitQuestions("  \n ")).toEqual([]);
  });
});

describe("detectLimit", () => {
  it("글자 수 제한을 찾는다", () => {
    expect(detectLimit("지원 동기 (1,000자 이내)")).toBe(1000);
    expect(detectLimit("지원 동기 500자")).toBe(500);
  });

  it("마지막 것을 쓴다", () => {
    expect(detectLimit("300자 이상 600자 이내")).toBe(600);
  });

  it("없거나 범위 밖이면 null", () => {
    expect(detectLimit("지원 동기")).toBeNull();
    expect(detectLimit("30자")).toBeNull();
    expect(detectLimit("20000자")).toBeNull();
  });
});

describe("validateQuestion", () => {
  it("값을 다듬어 돌려준다", () => {
    expect(validateQuestion({ prompt: "  지원 동기 ", charLimit: "500", countSpaces: false })).toEqual({
      ok: true,
      value: { prompt: "지원 동기", charLimit: 500, countSpaces: false },
    });
  });

  it("제한이 비면 null, 기준이 없으면 공백 포함", () => {
    for (const charLimit of ["", null, undefined, "  "]) {
      expect(validateQuestion({ prompt: "a", charLimit })).toEqual({
        ok: true,
        value: { prompt: "a", charLimit: null, countSpaces: true },
      });
    }
  });

  it("빈 문항", () => {
    expect(validateQuestion({ prompt: "  " })).toEqual({ ok: false, errors: { prompt: "문항을 적어 주세요" } });
    expect(validateQuestion(null)).toEqual({ ok: false, errors: { prompt: "문항을 적어 주세요" } });
  });

  it("문항이 너무 길면", () => {
    const result = validateQuestion({ prompt: "가".repeat(1001) });
    expect(result).toEqual({ ok: false, errors: { prompt: "문항은 1000자까지 적을 수 있습니다" } });
  });

  it("제한이 범위 밖이거나 정수가 아니면", () => {
    const message = "글자 수 제한은 50~10000자로 적어 주세요";
    for (const charLimit of [49, 10001, 1.5, "abc", "100.5"]) {
      expect(validateQuestion({ prompt: "a", charLimit })).toEqual({ ok: false, errors: { charLimit: message } });
    }
  });
});
