import { describe, expect, test } from "vitest";
import { shouldSkipBuild } from "./vercel-ignore.mjs";

describe("shouldSkipBuild", () => {
  test("문서, .claude, .github, 테스트만 바뀌면 건너뛴다", () => {
    expect(
      shouldSkipBuild([
        "docs/status.md",
        "docs/superpowers/plans/2026-11-18-05a-cover-letter.md",
        "CLAUDE.md",
        "README.md",
        ".claude/skills/ship/SKILL.md",
        ".github/workflows/check.yml",
        "src/modules/applications/write.test.ts",
        "scripts/vercel-ignore.test.mjs",
      ]),
    ).toBe(true);
  });

  test("앱 코드, 마이그레이션, 설정이 하나라도 바뀌면 빌드한다", () => {
    expect(shouldSkipBuild(["docs/status.md", "src/modules/applications/write.ts"])).toBe(false);
    expect(shouldSkipBuild(["drizzle/0014_x.sql"])).toBe(false);
    expect(shouldSkipBuild(["package.json"])).toBe(false);
    expect(shouldSkipBuild(["vercel.json"])).toBe(false);
    expect(shouldSkipBuild(["scripts/vercel-ignore.mjs"])).toBe(false);
    // 테스트 도우미 자료(__fixtures__)나 테스트가 아닌 .ts는 앱 코드로 본다
    expect(shouldSkipBuild(["src/modules/experiences/__fixtures__/sample.pdf"])).toBe(false);
  });

  test("바뀐 파일을 모르면(빈 목록) 빌드한다", () => {
    expect(shouldSkipBuild([])).toBe(false);
  });
});
