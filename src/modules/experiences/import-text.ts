import mammoth from "mammoth";
import { extractText as extractPdfText, getDocumentProxy } from "unpdf";

// 가져오기용 글자 뽑기. 파일은 여기서 글자만 뽑고 버린다(저장하지 않는다).

export const MAX_FILE_BYTES = 4 * 1024 * 1024;
export const MAX_SOURCE_CHARS = 40_000;

type ExtractFailure = "unsupported" | "too_large" | "no_text" | "unreadable";

const TEXT_EXTENSIONS = ["md", "txt", "csv"];

export async function extractText(file: {
  name: string;
  bytes: Uint8Array;
}): Promise<{ ok: true; text: string } | { ok: false; reason: ExtractFailure }> {
  const extension = file.name.includes(".") ? file.name.split(".").pop()!.toLowerCase() : "";
  if (!["pdf", "docx", ...TEXT_EXTENSIONS].includes(extension)) return { ok: false, reason: "unsupported" };
  if (file.bytes.byteLength > MAX_FILE_BYTES) return { ok: false, reason: "too_large" };

  let text: string;
  try {
    if (extension === "pdf") {
      const pdf = await getDocumentProxy(file.bytes);
      text = (await extractPdfText(pdf, { mergePages: true })).text;
    } else if (extension === "docx") {
      text = (await mammoth.extractRawText({ buffer: Buffer.from(file.bytes) })).value;
    } else {
      text = new TextDecoder("utf-8").decode(file.bytes);
    }
  } catch {
    // 확장자와 내용이 다르거나 깨진 파일
    return { ok: false, reason: "unreadable" };
  }
  // 스캔한 PDF처럼 글자가 없는 파일
  if (text.trim() === "") return { ok: false, reason: "no_text" };
  return { ok: true, text };
}

// 붙여 넣은 글이나 뽑은 글을 정리하고 길이를 본다. 자르지 않는다(넘으면 나눠 올리라고 알린다)
export function prepareSource(text: string): { ok: true; text: string } | { ok: false; reason: "empty" | "too_long" } {
  const cleaned = text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, "").replace(/^[ \t]+/g, (indent) => (indent.length > 8 ? "        " : indent)))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (cleaned === "") return { ok: false, reason: "empty" };
  if (cleaned.length > MAX_SOURCE_CHARS) return { ok: false, reason: "too_long" };
  return { ok: true, text: cleaned };
}
