import { APPLICATION_LIMITS } from "./options";
import type { QuestionInput } from "./repo";

// 자소서 문항 입력 검사와 붙여 넣은 글 나누기. 화면과 DB를 모르는 순수 함수

// 줄 맨 앞의 번호 표시: "1.", "2)", "Q3", "문항 4", "5번", "6번 문항", "[7]", "【문항 8】", "①".
// 점·괄호·번 표기는 뒤에 공백이 오거나 줄이 끝나야 한다("1.5배", "1번째", "2023년"은 번호가 아니다)
const MARKER =
  /^\s*(?:(?:\d+[.)]|(?:Q|문항)\s*\d+\s*[.):]?|\d+번(?:\s*문항)?\s*[.):]?)(?:\s+|$)|(?:[\[【]\s*(?:문항\s*)?\d+\s*[\]】]|[①-⑩])\s*[.):]?\s*)/i;

// 여러 문항을 한 번에 붙여 넣은 글을 번호 줄로 나눈다. 번호가 없으면 통째로 하나
export function splitQuestions(text: string): string[] {
  const chunks: string[][] = [[]];
  for (const line of text.split(/\r?\n/)) {
    const marker = MARKER.exec(line);
    if (marker) {
      chunks.push([line.slice(marker[0].length)]);
    } else {
      chunks[chunks.length - 1].push(line);
    }
  }
  return chunks.map((lines) => lines.join("\n").trim()).filter((chunk) => chunk !== "");
}

// 문항 글에서 "500자", "(1,000자 이내)" 같은 제한을 찾는다. 여러 개면 마지막 것
export function detectLimit(prompt: string): number | null {
  const found = [...prompt.matchAll(/(\d[\d,]*)\s*자/g)];
  if (found.length === 0) return null;
  const limit = Number(found[found.length - 1][1].replace(/,/g, ""));
  return limit >= APPLICATION_LIMITS.charLimitMin && limit <= APPLICATION_LIMITS.charLimitMax ? limit : null;
}

export type QuestionErrors = Partial<Record<keyof QuestionInput, string>>;

export function validateQuestion(raw: unknown): { ok: true; value: QuestionInput } | { ok: false; errors: QuestionErrors } {
  const data = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const errors: QuestionErrors = {};

  const prompt = typeof data.prompt === "string" ? data.prompt.trim() : "";
  if (prompt === "") errors.prompt = "문항을 적어 주세요";
  else if (prompt.length > APPLICATION_LIMITS.prompt) errors.prompt = `문항은 ${APPLICATION_LIMITS.prompt}자까지 적을 수 있습니다`;

  let charLimit: number | null = null;
  const rawLimit = typeof data.charLimit === "string" ? data.charLimit.trim() : data.charLimit;
  if (rawLimit !== null && rawLimit !== undefined && rawLimit !== "") {
    const limit = Number(rawLimit);
    if (!Number.isInteger(limit) || limit < APPLICATION_LIMITS.charLimitMin || limit > APPLICATION_LIMITS.charLimitMax) {
      errors.charLimit = `글자 수 제한은 ${APPLICATION_LIMITS.charLimitMin}~${APPLICATION_LIMITS.charLimitMax}자로 적어 주세요`;
    } else charLimit = limit;
  }

  const countSpaces = data.countSpaces === undefined ? true : data.countSpaces !== false;

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: { prompt, charLimit, countSpaces } };
}
