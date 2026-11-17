import type { NextConfig } from "next";

// 로컬 미리보기(npm run preview:local): 외부 DB와 구글 로그인 없이 화면을 확인하기 위해
// DB, 로그인 확인, AI를 src/dev의 가짜로 바꿔 끼운다. 배포 환경에서는 켤 수 없다.
const localPreview = process.env.LOCAL_PREVIEW === "1";
if (localPreview && process.env.VERCEL) {
  throw new Error("LOCAL_PREVIEW는 배포 환경에서 쓸 수 없습니다");
}

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // 가져오기에서 파일(4MB까지)을 서버 액션으로 받는다
  experimental: { serverActions: { bodySizeLimit: "5mb" } },
  ...(localPreview ? { distDir: ".next-local", serverExternalPackages: ["@electric-sql/pglite"] } : {}),
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
    ...(localPreview
      ? {
          resolveAlias: {
            "@/db": "./src/dev/local-db.ts",
            "@/lib/session": "./src/dev/local-session.ts",
            "@/modules/ai/provider": "./src/dev/local-ai.ts",
          },
        }
      : {}),
  },
};

export default nextConfig;
