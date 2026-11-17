import { describe, expect, test } from "vitest";
import type { Criterion } from "@/modules/tracks/options";
import type { PostingAnalysis, Requirement } from "./analysis";
import { requirementLevel, type ScoreInput, scorePosting } from "./score";

const weights: Record<Criterion, number> = { jobMatch: 30, location: 25, experience: 20, field: 15, preferred: 10 };

function requirement(over: Partial<Requirement> = {}): Requirement {
  return { kind: "required", text: "요구", quote: "원문", quoteFound: true, evidence: [], ...over };
}
function analysis(over: Partial<PostingAnalysis> = {}): PostingAnalysis {
  return {
    requirements: [],
    field: { level: "same_job", reason: "" },
    analyzedAt: "2026-11-17T00:00:00.000Z",
    ...over,
  };
}
function input(over: Partial<ScoreInput> = {}): ScoreInput {
  return {
    posting: { regions: ["seoul"], careerType: "both", minYears: null },
    track: { regions: ["seoul", "gyeonggi"], applicantType: "experienced", experienceMonths: 36, weights },
    analysis: analysis(),
    usable: new Set<string>(),
    ...over,
  };
}
const withTrack = (track: Partial<ScoreInput["track"]>) => ({ ...input().track, ...track });

test("근무지 1순위·같은 분야 다른 직무면 원하는 정도 81", () => {
  const result = scorePosting(input({ analysis: analysis({ field: { level: "same_field", reason: "" } }) }));
  expect(result.desire).toBe(81);
});

describe("근무지", () => {
  const location = (posting: string[], track: string[]) =>
    scorePosting(
      input({
        posting: { regions: posting, careerType: "both", minYears: null },
        track: withTrack({ regions: track }),
      }),
    ).criteria.location.score;

  test("2순위면 0.85, 겹치지 않으면 0, 전국이면 1", () => {
    expect(location(["gyeonggi"], ["seoul", "gyeonggi"])).toBe(0.85);
    expect(location(["busan"], ["seoul", "gyeonggi"])).toBe(0);
    expect(location(["busan"], ["anywhere"])).toBe(1);
  });

  test("여러 곳이 겹치면 가장 앞 순위를 쓴다", () => {
    expect(location(["gyeonggi", "seoul"], ["seoul", "gyeonggi"])).toBe(1);
  });

  test("공고 근무지가 없으면 null이고 분야만으로 매긴다", () => {
    const result = scorePosting(
      input({ posting: { regions: [], careerType: "both", minYears: null }, analysis: analysis() }),
    );
    expect(result.criteria.location.score).toBeNull();
    expect(result.desire).toBe(100);
  });
});

test("경력 요건 경계: 경력 트랙 36개월", () => {
  const exp = (minYears: number) =>
    scorePosting(input({ posting: { regions: ["seoul"], careerType: "experienced", minYears } })).criteria.experience
      .score;
  expect(exp(3)).toBe(1);
  expect(exp(4)).toBe(0.7);
  expect(exp(5)).toBe(0.4);
  expect(exp(6)).toBe(0);
});

test("경력 요건: 신입 트랙은 경력 공고면 0, 신입·경력 공고면 1", () => {
  const exp = (careerType: "new" | "experienced" | "both" | "any") =>
    scorePosting(
      input({
        posting: { regions: ["seoul"], careerType, minYears: null },
        track: withTrack({ applicantType: "new", experienceMonths: null }),
      }),
    ).criteria.experience.score;
  expect(exp("experienced")).toBe(0);
  expect(exp("both")).toBe(1);
  expect(exp("new")).toBe(1);
});

test("경력 요건: 경력 트랙에 신입 공고면 0.5, 요구 연차를 모르면 1", () => {
  const exp = (careerType: "new" | "both", minYears: number | null) =>
    scorePosting(input({ posting: { regions: ["seoul"], careerType, minYears } })).criteria.experience.score;
  expect(exp("new", null)).toBe(0.5);
  expect(exp("both", null)).toBe(1);
});

test("경력 요건: 경력 개월을 모르면 0개월로 본다", () => {
  const result = scorePosting(
    input({
      posting: { regions: ["seoul"], careerType: "experienced", minYears: 1 },
      track: withTrack({ experienceMonths: null }),
    }),
  );
  expect(result.criteria.experience.score).toBe(0.7);
});

describe("requirementLevel", () => {
  const evidence = [
    { experienceId: "a", level: "partial" as const, why: "" },
    { experienceId: "b", level: "full" as const, why: "" },
  ];
  test("근거 경험이 usable에 없으면 none으로 본다", () => {
    expect(requirementLevel(requirement({ evidence }), new Set())).toBe("none");
    expect(requirementLevel(requirement({ evidence }), new Set(["zzz"]))).toBe("none");
  });
  test("usable인 것 중 가장 높은 level을 쓴다", () => {
    expect(requirementLevel(requirement({ evidence }), new Set(["a", "b"]))).toBe("full");
    expect(requirementLevel(requirement({ evidence }), new Set(["a"]))).toBe("partial");
  });
});

test("직무 일치는 필수 요구 사항을 덮은 비율이고, 원문에서 찾지 못한 것은 뺀다", () => {
  const full = [{ experienceId: "a", level: "full" as const, why: "" }];
  const result = scorePosting(
    input({
      analysis: analysis({
        requirements: [
          requirement({ evidence: full }),
          requirement(),
          requirement({ evidence: full, quoteFound: false }),
        ],
      }),
      usable: new Set(["a"]),
    }),
  );
  expect(result.criteria.jobMatch.score).toBe(0.5);
});

test("확인된 경험이 없으면 직무 일치·우대가 0으로 들어간다", () => {
  const full = [{ experienceId: "a", level: "full" as const, why: "" }];
  const result = scorePosting(
    input({
      posting: { regions: ["seoul"], careerType: "experienced", minYears: null },
      analysis: analysis({
        requirements: [requirement({ evidence: full }), requirement({ kind: "preferred", evidence: full })],
      }),
      usable: new Set(),
    }),
  );
  expect(result.criteria.jobMatch.score).toBe(0);
  expect(result.criteria.preferred.score).toBe(0);
  expect(result.fit).toBe(33);
});

test("analysis가 없으면 분야·직무 일치·우대가 null이고 fit은 경력 요건만으로 매긴다", () => {
  const result = scorePosting(input({ analysis: null }));
  expect(result.criteria.field.score).toBeNull();
  expect(result.criteria.jobMatch.score).toBeNull();
  expect(result.criteria.preferred.score).toBeNull();
  expect(result.fit).toBe(100);
  expect(result.desire).toBe(100);
});

test("필수도 우대도 없으면 jobMatch·preferred null", () => {
  const result = scorePosting(input());
  expect(result.criteria.jobMatch.score).toBeNull();
  expect(result.criteria.preferred.score).toBeNull();
  expect(result.fit).toBe(100);
});

test("묶음의 항목이 모두 null이면 그 묶음은 null이고 criteria에 배점을 담는다", () => {
  const result = scorePosting(
    input({ posting: { regions: [], careerType: "both", minYears: null }, analysis: null }),
  );
  expect(result.desire).toBeNull();
  expect(result.criteria.location).toEqual({ score: null, weight: 25 });
  expect(result.criteria.jobMatch.weight).toBe(30);
});
