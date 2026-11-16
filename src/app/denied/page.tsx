import Link from "next/link";

export default function DeniedPage() {
  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-6 text-center">
        <p className="text-lg">초대받은 사람만 쓸 수 있습니다</p>
        <Link href="/sign-in" className="underline">
          다른 계정으로 로그인
        </Link>
      </div>
    </main>
  );
}
