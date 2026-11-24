import { expect, test } from "vitest";
import type { Answer } from "@/modules/applications/answers-repo";
import type { AskItem } from "@/modules/applications/types";
import { answerNames, answerViews, companyNames, initialChecked, missingTopicsText, picksToSend, toggled, wantsExperience, writePlan } from "./answer-view";

const answer = (id: string, topic: Answer["topic"], text: string): Answer => ({
  id,
  topic,
  question: "q",
  answer: text,
  postingId: null,
  company: "가나다",
  companyKey: null,
  createdAt: new Date("2026-11-01T00:00:00Z"),
});
const item = (id: string): AskItem => ({ id, topic: "motive", link: "", question: "?", options: ["a", "b"], previous: [] });

test("붙인 답을 붙인 순서로 주제 이름과 함께 보인다. 없는 답은 뺀다", () => {
  const list = [answer("a1", "motive", "하나"), answer("a2", "growth", "둘")];
  expect(answerViews(["a2", "gone", "a1"], list, ["motive", "growth"], "가나다")).toEqual([
    { id: "a2", topic: "growth", label: "성장과정", text: "둘", unused: null },
    { id: "a1", topic: "motive", label: "지원동기", text: "하나", unused: null },
  ]);
});

test("쓰지 않는 답: 주제가 문항에 없으면 kind, 다른 회사에 묶인 답이면 company", () => {
  const list = [
    { ...answer("a1", "motive", "가나다 동기"), companyKey: "가나다" },
    { ...answer("a2", "motive", "라마바 동기"), companyKey: "라마바" },
    answer("a3", "growth", "성장"),
  ];
  expect(answerViews(["a1", "a2", "a3"], list, ["motive"], "가나다").map((v) => [v.id, v.unused])).toEqual([
    ["a1", null],
    ["a2", "company"],
    ["a3", "kind"],
  ]);
});

test("빈 승인은 다시 열어도 아무것도 체크하지 않는다", () => {
  const picks = [{ experienceId: "e1", name: "결제" }, { experienceId: "e2", name: null }];
  expect(initialChecked({ approvedIds: [], picks })).toEqual([]);
  expect(initialChecked({ approvedIds: ["e9"], picks })).toEqual(["e9"]);
});

test("승인 전이면 고른 경험을 체크한다(지금 쓸 수 없는 경험은 빼고)", () => {
  const picks = [{ experienceId: "e1", name: "결제" }, { experienceId: "e2", name: null }];
  expect(initialChecked({ approvedIds: null, picks })).toEqual(["e1"]);
  expect(initialChecked(null)).toEqual([]);
});

test("근거 이름은 내 답: 주제다", () => {
  expect(answerNames([answer("a1", "motive", "x")])).toEqual({ a1: "내 답: 지원동기" });
});

test("번호를 켜고 끄며 번호 순서를 지킨다", () => {
  expect(toggled([2], 0, true)).toEqual([0, 2]);
  expect(toggled([0, 2], 0, false)).toEqual([2]);
  expect(toggled([0], 0, true)).toEqual([0]);
});

test("아무것도 고르지 않은 질문은 보내지 않고 기타는 공백을 뗀다", () => {
  const items = [item("x"), item("y"), item("z")];
  expect(
    picksToSend(items, {
      x: { options: [1], previous: [], note: "" },
      y: { options: [], previous: [], note: "   " },
      z: { options: [], previous: [0], note: " 직접 " },
    }),
  ).toEqual([
    { id: "x", options: [1], previous: [], note: "" },
    { id: "z", options: [], previous: [0], note: "직접" },
  ]);
});

test("경험형이 들어 있는지(유형을 모르면 경험형)", () => {
  expect(wantsExperience(["motive"])).toBe(false);
  expect(wantsExperience(["experience", "motive"])).toBe(true);
  expect(wantsExperience(null)).toBe(true);
});

test("경험형이 없는 문항은 답이 있으면 쓰고, 고른 경험은 고르기 결과가 있을 때만 보낸다", () => {
  const base = { kinds: ["motive" as const], answerTopics: ["motive" as const], checked: ["e1"], hasSelection: true, approvedStale: false };
  expect(writePlan(base)).toEqual({ ids: ["e1"], enabled: true });
  expect(writePlan({ ...base, checked: [] })).toEqual({ ids: [], enabled: true });
  expect(writePlan({ ...base, hasSelection: false })).toEqual({ ids: [], enabled: true });
  expect(writePlan({ ...base, answerTopics: [] })).toEqual({ ids: ["e1"], enabled: false });
});

test("유형마다 그 유형의 답이 있어야 쓴다(동기포부형+자기소개형에 지원동기 답만 있으면 끔)", () => {
  const base = { kinds: ["motive" as const, "self" as const], answerTopics: ["motive" as const], checked: [], hasSelection: false, approvedStale: false };
  expect(writePlan(base).enabled).toBe(false);
  expect(writePlan({ ...base, answerTopics: ["motive", "growth"] }).enabled).toBe(true);
});

test("경험형 문항은 고른 경험이 있어야 쓰고, 동기포부형·자기소개형이 함께 있으면 답도 있어야 쓴다", () => {
  const base = { kinds: ["experience" as const, "motive" as const], answerTopics: ["motive" as const, "aspiration" as const], checked: ["e1"], hasSelection: true, approvedStale: false };
  expect(writePlan(base)).toEqual({ ids: ["e1"], enabled: true });
  expect(writePlan({ ...base, checked: [] }).enabled).toBe(false);
  expect(writePlan({ ...base, hasSelection: false }).enabled).toBe(false);
  expect(writePlan({ ...base, answerTopics: [] }).enabled).toBe(false);
  // 경험형만인(또는 유형을 모르는) 문항은 답이 없어도 쓴다
  expect(writePlan({ ...base, kinds: ["experience"], answerTopics: [] }).enabled).toBe(true);
  expect(writePlan({ ...base, kinds: null, answerTopics: [] }).enabled).toBe(true);
});

test("승인한 경험이 바뀌었으면 경험형이 없는 문항도 빈 경험으로 쓰지 않고 끈다", () => {
  const base = { kinds: ["motive" as const], answerTopics: ["motive" as const], checked: ["e1"], hasSelection: true, approvedStale: true };
  expect(writePlan(base)).toEqual({ ids: [], enabled: false });
  expect(writePlan({ ...base, kinds: ["experience"] })).toEqual({ ids: [], enabled: false });
});

test("붙인 답이 없는 주제", () => {
  expect(missingTopicsText(["motive", "aspiration"], [answer("a1", "motive", "x")].map((a) => a.topic))).toBe("입사 후 포부에 아직 답이 없습니다");
  expect(missingTopicsText(["motive", "aspiration"], [])).toBe("지원동기, 입사 후 포부에 아직 답이 없습니다");
  expect(missingTopicsText(["motive"], ["motive"])).toBeNull();
});

test("companyNames: 회사 정보 id → 'www.'를 뗀 호스트로 만든 이름", () => {
  const fact = (id: string, url: string) => ({ id, kind: "news" as const, text: "소식", url, title: "제목", date: null });
  expect(companyNames([fact("c1", "https://www.Example.com/news/1"), fact("c2", "https://ir.ganada.co.kr/a")])).toEqual({
    c1: "회사 정보: example.com",
    c2: "회사 정보: ir.ganada.co.kr",
  });
});
