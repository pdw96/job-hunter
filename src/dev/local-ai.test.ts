import { expect, test } from "vitest";
import { z } from "zod";
import { ai } from "./local-ai";

// DB를 쓰는 시험은 파일에서 처음 PGlite에 마이그레이션을 적용하고 모듈을 늦게 불러와, 느린 CI에서 기본 5초를 넘는다
const DB_TEST_TIMEOUT = 30_000;

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
}, DB_TEST_TIMEOUT);

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

test("옮기기 흉내는 첫 줄로 나누기·주장·소속 답을 고른다", async () => {
  const { createTestDb } = await import("@/db/test-db");
  const { user } = await import("@/modules/auth/schema");
  const { createExperience } = await import("@/modules/experiences/repo");
  const { moveRecord, affiliateProjects } = await import("@/modules/experiences/move");
  const { listFacts } = await import("@/modules/experiences/facts-repo");
  const { listScenes } = await import("@/modules/experiences/scenes-repo");
  const db = await createTestDb();
  await db.insert(user).values({ id: "u1", name: "A", email: "u1@example.com" });
  const base = {
    organization: null,
    role: null,
    isOngoing: false,
    situation: null,
    actions: null,
    result: null,
    metrics: [],
    notDone: null,
    bannedPhrases: [],
    evidenceNote: null,
    tags: [],
  };
  const school = await createExperience(db, "u1", { ...base, name: "한국대학교 경영학과", kind: "school", startMonth: "2016-03", endMonth: "2022-02" });
  const job = await createExperience(db, "u1", {
    ...base,
    name: "가나다커머스 마케팅",
    kind: "job",
    organization: "가나다커머스",
    role: "마케팅팀",
    startMonth: "2022-03",
    endMonth: "2024-02",
    actions: "SNS 채널을 운영했다",
  });
  const certificate = await createExperience(db, "u1", { ...base, name: "정보처리기사", kind: "certificate", startMonth: "2021-11", endMonth: null });
  const project = await createExperience(db, "u1", {
    ...base,
    name: "브랜드 리뉴얼 TF",
    kind: "project",
    organization: "가나다커머스",
    startMonth: "2023-06",
    endMonth: "2023-09",
    actions: "회의 자료를 만들었다",
  });
  for (const id of [school, job, certificate, project]) expect(await moveRecord(db, ai, "u1", id)).toEqual({ ok: true });
  expect(await affiliateProjects(db, ai, "u1")).toEqual({ ok: true });

  const facts = await listFacts(db, "u1");
  expect(facts.education.map((e) => e.value.schoolName)).toEqual(["한국대학교 경영학과"]);
  expect(facts.job.map((j) => j.value.company)).toEqual(["가나다커머스"]);
  expect(facts.credential.map((c) => c.value.name)).toEqual(["정보처리기사"]);
  expect(facts.project.map((p) => p.value.name)).toEqual(["브랜드 리뉴얼 TF"]);
  // 경력 장면 하나와 프로젝트 장면 하나
  expect(await listScenes(db, "u1")).toHaveLength(2);
}, DB_TEST_TIMEOUT);

test("옮기기 정리 흉내는 구분과 이름이 같은 기록을 앞의 것의 duplicate로, 나머지는 구분별 기본값으로 답한다", async () => {
  const { createTestDb } = await import("@/db/test-db");
  const { user } = await import("@/modules/auth/schema");
  const { requestClassify } = await import("@/modules/experiences/move-classify");
  const db = await createTestDb();
  await db.insert(user).values({ id: "u1", name: "A", email: "u1@example.com" });
  const record = (name: string, kind: "school" | "job" | "project") => ({
    name,
    kind,
    organization: null,
    role: null,
    startMonth: null,
    endMonth: null,
    isOngoing: false,
    body: "",
  });
  const result = await requestClassify(db, ai, "u1", [record("한국대학교", "school"), record("한국대학교", "school"), record("가나다", "job"), record("리뉴얼", "project")]);
  expect(result).toEqual({
    ok: true,
    roles: [
      { role: "fact", ref: null },
      { role: "duplicate", ref: 0 },
      { role: "head", ref: null },
      { role: "head", ref: null },
    ],
  });
}, DB_TEST_TIMEOUT);

test("묻기 흉내는 질문 2개에 선택지 3개씩이고, 기록이 있으면 첫 기록을 연결고리로 적는다", async () => {
  const schema = z.object({ items: z.array(z.object({ topic: z.string(), link: z.string(), question: z.string(), options: z.array(z.string()) })) });
  const ask = async (records: string) => {
    const text = ["[문항]\n지원 동기", "[물을 주제]\nmotive (지원동기)\naspiration (입사 후 포부)", "[공고]\n백엔드", `[내 기록]\n${records}`].join("\n\n");
    const result = await ai.complete({ purpose: "application_ask", system: "", messages: [{ role: "user", text }], schema, effort: "low", maxTokens: 4000 });
    if (!result.ok) throw new Error(result.reason);
    return result.value.items;
  };
  const withHook = await ask("- 교육 과정: Kotlin 백엔드 개발 과정 · 나다아카데미");
  expect(withHook.map((x) => [x.topic, x.options.length])).toEqual([
    ["motive", 3],
    ["aspiration", 3],
  ]);
  expect(withHook[0].link).toContain("Kotlin 백엔드 개발 과정");
  expect((await ask("없음"))[0].link).toBe("");
});

test("쓰기 흉내는 [내 답]이 있으면 A1을 근거로 한 첫 문단을 쓰고, 경험이 있으면 E1 문단을 잇는다", async () => {
  const { createTestDb } = await import("@/db/test-db");
  const { user } = await import("@/modules/auth/schema");
  const { writeText } = await import("@/modules/applications/write");
  const { SAMPLE_SOURCES } = await import("@/modules/applications/prompt-check");
  const db = await createTestDb();
  await db.insert(user).values({ id: "u1", name: "A", email: "u1@example.com" });
  const answer = {
    id: "a1",
    topic: "motive" as const,
    question: "왜 이 회사인가요?",
    answer: "많은 사람이 쓰는 서비스를 만들고 싶다",
    postingId: null,
    company: "가나다",
    companyKey: "가나다",
    createdAt: new Date(),
  };
  const base = { prompt: "지원 동기", charLimit: 300, countSpaces: true, postingText: "공고" };
  const onlyAnswer = await writeText(db, ai, "u1", { ...base, sources: [], kinds: ["motive"], answers: [answer], unanswered: [] });
  expect(onlyAnswer.ok && onlyAnswer.value.paragraphs).toEqual([{ text: answer.answer, sources: [], answers: ["a1"], edited: false }]);
  const both = await writeText(db, ai, "u1", { ...base, sources: [SAMPLE_SOURCES[0]], kinds: ["experience", "motive"], answers: [answer], unanswered: [] });
  expect(both.ok && both.value.paragraphs.map((p) => [p.sources, p.answers])).toEqual([
    [[], ["a1"]],
    [[SAMPLE_SOURCES[0].id], []],
    [[SAMPLE_SOURCES[0].id], []],
  ]);
}, DB_TEST_TIMEOUT);
