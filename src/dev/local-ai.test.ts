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

test("새 가져오기 흉내는 학력 하나와 경력 하나(장면 하나)를 만든다", async () => {
  const { createTestDb } = await import("@/db/test-db");
  const { user } = await import("@/modules/auth/schema");
  const { requestRecordImport } = await import("@/modules/experiences/record-import");
  const db = await createTestDb();
  await db.insert(user).values({ id: "u1", name: "A", email: "u1@example.com" });
  const source = "한국대학교 경영학과 2016.03 ~ 2022.02\n\n가나다커머스 마케팅팀 2022.03 ~ 2024.02\n- SNS 채널 운영\n- 신규 고객 캠페인 기획";
  for (const purpose of ["import_records", "migrate"] as const) {
    const result = await requestRecordImport(db, ai, "u1", source, { purpose });
    if (!result.ok) throw new Error(result.reason);
    expect(result.plan.education.map((e) => e.schoolName)).toEqual(["한국대학교"]);
    expect(result.plan.jobs.map((j) => j.input.company)).toEqual(["가나다커머스 마케팅팀"]);
    expect(result.plan.jobs[0].scenes).toHaveLength(1);
  }
});

test("사례 정리 흉내는 첫 답을 상황과 한 일로 옮긴다", async () => {
  const { sceneDraftSchema } = await import("@/modules/experiences/scene-interview");
  const result = await ai.complete({
    purpose: "extract_scene",
    system: "",
    messages: [{ role: "user", text: "[인터뷰 대화]\n질문: 무슨 일?\n지원자: 배송 지연 문의를 맡았어요" }],
    schema: sceneDraftSchema,
    effort: "medium",
    maxTokens: 16000,
  });
  if (!result.ok) throw new Error(result.reason);
  expect(result.value).toMatchObject({ situation: "배송 지연 문의를 맡았어요", actions: "배송 지연 문의를 맡았어요" });
});
