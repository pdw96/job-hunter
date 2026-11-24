import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "scripts/**/*.test.mjs"],
    setupFiles: ["./src/test-setup.ts"],
    // 테스트 파일마다 처음 createTestDb()를 부르는 테스트가 빈 PGlite에 마이그레이션을 모두 적용한다(src/db/test-db.ts).
    // 마이그레이션이 늘어 CI에서 그 한 번이 기본 5초를 넘기므로(2026-11-24, 마이그레이션 25개) 넉넉히 둔다
    testTimeout: 20_000,
  },
});
