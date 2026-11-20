import { type ZodType, z } from "zod";

// 답 모양이 너무 커서 API가 문법(grammar)으로 강제하지 못하는 요청에 쓴다("The compiled grammar is too large").
// 모양을 지시에 적어 JSON 글로 받고, 같은 스키마로 코드가 검사한다. 맞지 않으면 invalid로 실패한다.

export function looseSystem(system: string, schema: ZodType<unknown>): string {
  const shape = JSON.stringify(z.toJSONSchema(schema, { io: "input" }));
  return [
    system,
    "답은 아래 JSON 스키마에 맞는 JSON 객체 하나만 씁니다. 설명, 머리말, 코드 블록 표시를 붙이지 않습니다. 모든 칸을 빠짐없이 씁니다.",
    shape,
  ].join("\n\n");
}

export function parseLoose<T>(text: string, schema: ZodType<T>): { ok: true; value: T } | { ok: false } {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return { ok: false };
  let json: unknown;
  try {
    json = JSON.parse(text.slice(start, end + 1));
  } catch {
    return { ok: false };
  }
  const parsed = schema.safeParse(json);
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false };
}
