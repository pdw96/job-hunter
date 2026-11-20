import { notFound } from "next/navigation";
import { db } from "@/db";
import { requireUser } from "@/lib/session";
import { moveProgress, moveSummary, planMoves } from "@/modules/experiences/move-repo";
import { newRecordsOn } from "@/modules/experiences/switch";
import { SignOutButton } from "../(app)/sign-out-button";
import { Mover } from "./mover";

// 이 화면은 (app) 밖에 있어 앱 레이아웃의 이동 검사를 받지 않는다(되돌아오는 길이 없다)
export const instant = false;

export default async function MovingPage() {
  if (!newRecordsOn()) notFound();
  const user = await requireUser();
  await planMoves(db, user.id);
  const [progress, summary] = await Promise.all([moveProgress(db, user.id), moveSummary(db, user.id)]);

  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b border-foreground/10">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
          <span className="text-lg font-bold">Job Hunter</span>
          <SignOutButton />
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
        <Mover progress={progress} summary={summary} />
      </main>
    </div>
  );
}
