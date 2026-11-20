import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { needsMove } from "@/modules/experiences/move-repo";
import { requireUser } from "@/lib/session";
import { SignOutButton } from "./sign-out-button";

// 로그인한 사람마다 내용이 달라 미리 만들어 둘 수 없다. 요청 때마다 서버에서 그린다.
export const instant = false;

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  // 개편 뒤 처음 들어오면 옛 기록을 새 구조로 옮기는 화면으로 보낸다. 요청마다 도는 검사라 쿼리 한 번으로 보고,
  // 할 일 목록 만들기(planMoves)는 /moving 화면이 한다. 다 옮긴 사용자는 이 검사 하나로 끝난다
  if (await needsMove(db, user.id)) redirect("/moving");

  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b border-foreground/10">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <Link href="/" className="text-lg font-bold">
            Job Hunter
          </Link>
          <nav className="flex gap-4 text-sm">
            <Link href="/">트랙</Link>
            <Link href="/records">경험 기록</Link>
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
