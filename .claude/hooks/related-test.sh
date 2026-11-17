#!/bin/bash
# 파일을 고치면 옆에 있는 테스트(x.ts → x.test.ts)만 바로 돌린다. 전체 테스트는 2분쯤 걸려서 매번 돌리지 않는다.
# 실패하면 결과를 Claude에게 돌려준다(종료 코드 2).
file=$(node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).tool_input.file_path||"")}catch{console.log("")}})')
case "$file" in
  *.test.ts) target="$file" ;;
  *.ts) target="${file%.ts}.test.ts" ;;
  *.tsx) target="${file%.tsx}.test.ts" ;;
  *) exit 0 ;;
esac
[ -f "$target" ] || exit 0
cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0
case "$target" in "$PWD"/src/*) ;; *) exit 0 ;; esac
if ! output=$(npx vitest run "$target" 2>&1); then
  echo "$output" | tail -40 >&2
  exit 2
fi
exit 0
