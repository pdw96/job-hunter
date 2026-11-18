// Vercel의 ignoreCommand(vercel.json). 지난 배포 뒤 바뀐 파일이 앱과 상관없는 것뿐이면 빌드를 건너뛴다.
// 종료 코드 0 = 건너뛰기, 1 = 빌드. 무엇이 바뀌었는지 모르면 늘 빌드한다(배포를 놓치는 것보다 한 번 더 하는 편이 낫다).
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

// 앱이 읽지 않는 파일: 문서, Claude 설정, GitHub 설정, 테스트
const IGNORABLE = [
  /^docs\//,
  /\.md$/,
  /^\.claude\//,
  /^\.github\//,
  /\.test\.(ts|tsx|mjs)$/,
];

export function shouldSkipBuild(files) {
  return files.length > 0 && files.every((file) => IGNORABLE.some((pattern) => pattern.test(file)));
}

// 지난 배포 커밋과 지금 사이에 바뀐 파일. 이름 바꾸기로 보면 옮기기 전 경로가 빠지므로(앱 파일을 docs/로 옮기면
// 옮긴 경로만 보여 건너뛰게 된다) 이름 바꾸기를 지우기 + 더하기로 본다
export function changedFiles(previous, cwd = process.cwd()) {
  const out = execFileSync("git", ["diff", "--name-only", "--no-renames", previous, "HEAD"], { cwd, encoding: "utf8" });
  return out.split("\n").filter((line) => line.trim() !== "");
}

function main() {
  // 이 브랜치의 지난 성공 배포 커밋. 처음 배포하는 브랜치면 비어 있다
  const previous = process.env.VERCEL_GIT_PREVIOUS_SHA;
  if (!previous) {
    console.log("지난 배포가 없어 빌드합니다");
    process.exit(1);
  }
  let files;
  try {
    files = changedFiles(previous);
  } catch {
    // 얕은 복제라 지난 커밋이 없을 수 있다
    console.log("바뀐 파일을 알 수 없어 빌드합니다");
    process.exit(1);
  }
  if (shouldSkipBuild(files)) {
    console.log(`앱과 상관없는 파일만 바뀌어 빌드를 건너뜁니다: ${files.join(", ")}`);
    process.exit(0);
  }
  console.log("앱 파일이 바뀌어 빌드합니다");
  process.exit(1);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
