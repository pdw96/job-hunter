import { expect, test } from "vitest";
import { chosenDocuments, cleanFound } from "./documents";
import { DOCUMENT_WRITER } from "./options";

const text = "자기소개서: 지원 동기를 쓰시오 (500자)\n성장 과정을 쓰시오";
const q = (over: Record<string, unknown> = {}) => ({ prompt: "지원 동기를 쓰시오", charLimit: 500, countSpaces: true, ...over });

test("목록 밖 종류와 빈 이름(글이 아닌 값 포함)은 버린다", () => {
  const found = cleanFound(
    { documents: [{ kind: "resume", label: "이력서" }, { kind: "x", label: "?" }, { kind: "portfolio", label: "  " }, { kind: "other", label: 3 }, null], questions: [] },
    text,
  );
  expect(found.documents).toEqual([{ kind: "resume", label: "이력서" }]);
});

test("같은 종류·이름은 한 번만", () => {
  const found = cleanFound({ documents: [{ kind: "other", label: "졸업증명서" }, { kind: "other", label: " 졸업증명서 " }, { kind: "other", label: "성적증명서" }], questions: [] }, "");
  expect(found.documents.map((d) => d.label)).toEqual(["졸업증명서", "성적증명서"]);
});

test("서류 11개째부터 버리고 이름은 100자로 자른다", () => {
  const documents = Array.from({ length: 12 }, (_, i) => ({ kind: "other", label: `증명서${i}` }));
  expect(cleanFound({ documents, questions: [] }, "").documents).toHaveLength(10);
  expect(cleanFound({ documents: [{ kind: "other", label: "가".repeat(150) }], questions: [] }, "").documents[0].label).toHaveLength(100);
});

test("원문에 없는 문항은 버린다", () => {
  const found = cleanFound({ documents: [], questions: [{ prompt: "지원 동기를 쓰시오", charLimit: 500, countSpaces: true }] }, "자기소개서: 성장 과정을 쓰시오");
  expect(found.questions).toEqual([]);
});

test("띄어쓰기가 달라도 원문에 있으면 남긴다", () => {
  expect(cleanFound({ documents: [], questions: [q({ prompt: "지원동기를  쓰시오" })] }, text).questions).toEqual([
    { prompt: "지원동기를  쓰시오", charLimit: 500, countSpaces: true },
  ]);
});

test("charLimit -1·30·20000은 null", () => {
  for (const charLimit of [-1, 30, 20000, 500.5, "500"]) {
    expect(cleanFound({ documents: [], questions: [q({ charLimit })] }, text).questions[0].charLimit).toBeNull();
  }
  expect(cleanFound({ documents: [], questions: [q({ charLimit: 50 })] }, text).questions[0].charLimit).toBe(50);
});

test("countSpaces null은 true, false는 그대로", () => {
  expect(cleanFound({ documents: [], questions: [q({ countSpaces: null })] }, text).questions[0].countSpaces).toBe(true);
  expect(cleanFound({ documents: [], questions: [q({ countSpaces: false })] }, text).questions[0].countSpaces).toBe(false);
});

test("문항 11개째부터 버린다", () => {
  const many = Array.from({ length: 12 }, (_, i) => `문항${i}번을 쓰시오`);
  const found = cleanFound({ documents: [], questions: many.map((prompt) => q({ prompt })) }, many.join("\n"));
  expect(found.questions).toHaveLength(10);
});

test("빈 문항 글은 버린다", () => {
  expect(cleanFound({ documents: [], questions: [q({ prompt: "  " })] }, text).questions).toEqual([]);
});

test("객체가 아니면 빈 값", () => {
  for (const raw of [null, undefined, "x", 3, [], { documents: "a", questions: 1 }]) {
    expect(cleanFound(raw, text)).toEqual({ documents: [], questions: [] });
  }
});

test("chosenDocuments: 고른 것이 있으면 그것(순서는 종류 순서)", () => {
  expect(chosenDocuments({ foundDocuments: [{ kind: "resume", label: "이력서" }], chosenDocuments: ["portfolio", "resume"] })).toEqual(["resume", "portfolio"]);
});

test("chosenDocuments: 고른 것이 없으면 찾은 서류의 종류(중복 없이)", () => {
  expect(
    chosenDocuments({
      foundDocuments: [{ kind: "portfolio", label: "포트폴리오" }, { kind: "other", label: "a" }, { kind: "other", label: "b" }],
      chosenDocuments: null,
    }),
  ).toEqual(["portfolio", "other"]);
});

test("chosenDocuments: 둘 다 없으면 이력서·자기소개서", () => {
  expect(chosenDocuments({ foundDocuments: null, chosenDocuments: null })).toEqual(["resume", "cover_letter"]);
});

test("chosenDocuments: 찾았지만 빈 배열이면 이력서·자기소개서", () => {
  expect(chosenDocuments({ foundDocuments: [], chosenDocuments: [] })).toEqual(["resume", "cover_letter"]);
});

test("글이 아닌 문항 글은 버리고, countSpaces가 불린이 아니면 true", () => {
  const found = cleanFound({ documents: [], questions: [q({ prompt: 5 }), q({ countSpaces: "yes" })] }, text);
  expect(found.questions).toEqual([{ prompt: "지원 동기를 쓰시오", charLimit: 500, countSpaces: true }]);
});

test("DOCUMENT_WRITER: 이력서·자기소개서·경력기술서는 ai, 포트폴리오·기타는 self", () => {
  expect(DOCUMENT_WRITER).toEqual({ resume: "ai", cover_letter: "ai", career: "ai", portfolio: "self", other: "self" });
});
