import { expect, test } from "vitest";
import { z } from "zod";
import { looseSystem, parseLoose } from "./loose-json";

const schema = z.object({ name: z.string(), kind: z.enum(["a", "b"]), items: z.array(z.object({ text: z.string() })) });

test("looseSystem은 원래 지시 뒤에 JSON만 쓰라는 말과 스키마를 붙인다", () => {
  const system = looseSystem("기록을 나눕니다.", schema);
  expect(system.startsWith("기록을 나눕니다.")).toBe(true);
  expect(system).toContain("JSON");
  expect(system).toContain('"kind"');
  expect(system).toContain('"enum"');
  // 같은 입력이면 같은 글(프롬프트 캐시가 깨지지 않게)
  expect(looseSystem("기록을 나눕니다.", schema)).toBe(system);
});

test("parseLoose는 JSON 글을 스키마로 검사해 돌려준다", () => {
  expect(parseLoose('{"name":"가","kind":"a","items":[{"text":"x"}]}', schema)).toEqual({
    ok: true,
    value: { name: "가", kind: "a", items: [{ text: "x" }] },
  });
});

test("parseLoose는 코드 블록이나 앞뒤 말이 있어도 가장 바깥 객체를 읽는다", () => {
  const text = '정리했습니다.\n```json\n{"name":"가","kind":"b","items":[]}\n```\n';
  expect(parseLoose(text, schema)).toEqual({ ok: true, value: { name: "가", kind: "b", items: [] } });
});

test("parseLoose는 JSON이 아니거나 스키마에 안 맞으면 실패한다", () => {
  expect(parseLoose("모르겠습니다", schema)).toEqual({ ok: false });
  expect(parseLoose('{"name":"가","kind":"c","items":[]}', schema)).toEqual({ ok: false });
  expect(parseLoose('{"name":"가","kind":"a","items":[', schema)).toEqual({ ok: false });
});
