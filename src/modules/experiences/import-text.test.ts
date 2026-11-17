import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { extractText, MAX_FILE_BYTES, MAX_SOURCE_CHARS, prepareSource } from "./import-text";

const fixture = (name: string) => new Uint8Array(readFileSync(`src/modules/experiences/__fixtures__/${name}`));
const file = (name: string, bytes: Uint8Array) => ({ name, bytes });

test("워드 파일에서 글을 뽑는다", async () => {
  const result = await extractText(file("이력서.docx", fixture("sample.docx")));
  expect(result).toMatchObject({ ok: true });
  if (result.ok) {
    expect(result.text).toContain("결제 시스템 개편 프로젝트");
    expect(result.text).toContain("결제 승인 API를 다시 설계했다");
  }
});

test("PDF 파일에서 글을 뽑는다", async () => {
  const result = await extractText(file("resume.PDF", fixture("sample.pdf")));
  expect(result).toMatchObject({ ok: true });
  if (result.ok) expect(result.text).toContain("Payment system project");
});

test("글 파일(.md, .txt, .csv)은 그대로 읽는다", async () => {
  const bytes = new TextEncoder().encode("# 경력\n결제 시스템 개편");
  for (const name of ["노션.md", "메모.txt", "표.csv"]) {
    expect(await extractText(file(name, bytes))).toEqual({ ok: true, text: "# 경력\n결제 시스템 개편" });
  }
});

test("글자가 없는 PDF는 no_text다", async () => {
  expect(await extractText(file("scan.pdf", fixture("no-text.pdf")))).toEqual({ ok: false, reason: "no_text" });
});

test("지원하지 않는 형식은 unsupported다", async () => {
  expect(await extractText(file("이력서.hwp", new Uint8Array([1, 2, 3])))).toEqual({ ok: false, reason: "unsupported" });
  expect(await extractText(file("이력서.doc", new Uint8Array([1, 2, 3])))).toEqual({ ok: false, reason: "unsupported" });
  expect(await extractText(file("확장자없음", new Uint8Array([1, 2, 3])))).toEqual({ ok: false, reason: "unsupported" });
});

test("확장자와 내용이 다른 파일은 unreadable이다", async () => {
  const text = new TextEncoder().encode("그냥 글자입니다");
  expect(await extractText(file("가짜.pdf", text))).toEqual({ ok: false, reason: "unreadable" });
  expect(await extractText(file("가짜.docx", text))).toEqual({ ok: false, reason: "unreadable" });
});

test("4MB를 넘는 파일은 too_large다", async () => {
  expect(await extractText(file("큰파일.txt", new Uint8Array(MAX_FILE_BYTES + 1)))).toEqual({ ok: false, reason: "too_large" });
});

test("글을 정리한다: 줄 끝 공백을 지우고 빈 줄이 이어지면 하나로 줄인다", () => {
  expect(prepareSource("  경력  \r\n\r\n\r\n\r\n결제 시스템   \n")).toEqual({ ok: true, text: "경력\n\n결제 시스템" });
});

test("공백뿐이면 empty, 4만 자를 넘으면 too_long이다", () => {
  expect(prepareSource(" \n\t ")).toEqual({ ok: false, reason: "empty" });
  expect(prepareSource("가".repeat(MAX_SOURCE_CHARS + 1))).toEqual({ ok: false, reason: "too_long" });
  expect(prepareSource("가".repeat(MAX_SOURCE_CHARS))).toMatchObject({ ok: true });
});
