import { after } from "next/server";
import { db } from "@/db";
import { ai } from "@/modules/ai/provider";
import { runResearch } from "./research-run";

// 응답 뒤에 회사 조사를 돌린다(그 페이지의 maxDuration 안에서 돈다). runResearch가 조사를 잡으므로 두 번 불러도 한 번만 돈다.
// 실패는 runResearch가 줄에 남기고 다시 던지므로 여기서는 기록만 한다.
// "use server" 파일에서 내보내면 브라우저가 부를 수 있는 액션이 되므로 따로 둔다(userId를 인자로 받는다)
export function scheduleResearch(userId: string, postingId: string, opts: { onlyIfMissing: boolean }): void {
  after(() =>
    runResearch(db, ai, userId, postingId, opts).catch((e) => console.error("회사 조사 실패", e instanceof Error ? e.message : e)),
  );
}
