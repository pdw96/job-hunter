import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { needsMove, planMoves } from "@/modules/experiences/move-repo";
import { newRecordsOn } from "@/modules/experiences/switch";
import { requireUser } from "@/lib/session";
import { SignOutButton } from "./sign-out-button";

// 로그인한 사람마다 내용이 달라 미리 만들어 둘 수 없다. 요청 때마다 서버에서 그린다.
export const instant = false;

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  // 개편 뒤 처음 들어오면 옛 기록을 새 구조로 옮기는 화면으로 보낸다(스위치가 꺼져 있으면 아무것도 하지 않는다)
  if (newRecordsOn()) {
    await planMoves(db, user.id);
    if (await needsMove(db, user.id)) redirect("/moving");
  }

  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b border-foreground/10">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <Link href="/" className="text-lg font-bold">
            Job Hunter
          </Link>
          <nav className="flex gap-4 text-sm">
            <Link href="/">트랙</Link>
            <Link href="/experiences">경험 기록</Link>
            <Link href="/postings">공고</Link>
            <Link href="/settings/contact">내 정보</Link>
            {user.isAdmin && <Link href="/admin">관리</Link>}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm">
            <span>{user.name}</span>
            <SignOutButton />
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">{children}</main>
    </div>
  );
}
