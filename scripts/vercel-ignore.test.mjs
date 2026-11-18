import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { changedFiles, shouldSkipBuild } from "./vercel-ignore.mjs";

describe("changedFiles", () => {
  test("앱 파일을 docs/로 옮기면 옮기기 전 경로도 바뀐 파일로 센다", () => {
    const dir = mkdtempSync(join(tmpdir(), "vercel-ignore-"));
    const git = (...args) =>
      execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: dir, encoding: "utf8" }).trim();
    try {
      git("init", "-q");
      mkdirSync(join(dir, "src"));
      mkdirSync(join(dir, "docs"));
      writeFileSync(join(dir, "src/page.tsx"), "export default function Page() { return null; }\n");
      git("add", "-A");
      git("commit", "-q", "-m", "first");
      const previous = git("rev-parse", "HEAD");
      renameSync(join(dir, "src/page.tsx"), join(dir, "docs/retired-page.tsx"));
      git("add", "-A");
      git("commit", "-q", "-m", "move");

      const files = changedFiles(previous, dir);
      expect(files).toContain("src/page.tsx");
      expect(shouldSkipBuild(files)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

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
