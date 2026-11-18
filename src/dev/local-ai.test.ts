import { expect, test } from "vitest";
import { z } from "zod";
import { ai } from "./local-ai";

// 로컬 미리보기의 가짜 맞대기. 실제 analyze.ts가 보내는 글 모양 그대로 넣는다
const message = (rawText: string) =>
  [
    "[지원 직무]\n백엔드 개발자",
    "[분야]\n정보통신",
    `[공고 원문]\n${rawText}`,
    "[인재상·회사 소개]\n없음",
    "[경험 기록]\n없음",
  ].join("\n\n");

async function requirementsOf(rawText: string) {
  const result = await ai.complete({
    purpose: "posting_match",
    system: "",
    messages: [{ role: "user", text: message(rawText) }],
    schema: z.object({ requirements: z.array(z.object({ kind: z.string(), text: z.string() })) }),
    effort: "medium",
    maxTokens: 16000,
  });
  if (!result.ok) throw new Error(result.reason);
  return result.value.requirements;
}

test("[자격요건]처럼 대괄호로 적힌 제목 아래 줄도 요구 사항으로 본다", async () => {
  const rawText = "가나다 백엔드 개발자\n\n[자격요건]\n- Java 개발 경험\n\n[우대사항]\n- 대용량 트래픽 경험\n\n[근무조건]\n- 정규직";
  expect(await requirementsOf(rawText)).toEqual([
    { kind: "required", text: "Java 개발 경험" },
    { kind: "preferred", text: "대용량 트래픽 경험" },
  ]);
});

test("대괄호 없는 제목도 그대로 읽는다", async () => {
  const rawText = "가나다 백엔드 개발자\n자격 요건\n- Java 개발 경험\n우대 사항: 대용량 트래픽 경험";
  expect(await requirementsOf(rawText)).toEqual([
    { kind: "required", text: "Java 개발 경험" },
    { kind: "preferred", text: "대용량 트래픽 경험" },
  ]);
});
