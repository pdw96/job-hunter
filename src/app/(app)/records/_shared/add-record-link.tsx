import Link from "next/link";

// 기록이 모자란 곳(자소서 문항, 점수의 부족한 점, 이력서)에서 새 기록을 더하러 가는 길.
// 예전에는 그 자리에서 AI 인터뷰를 시작했지만, 사례 인터뷰는 붙일 회사·프로젝트·활동을 먼저 골라야 해서 화면으로 보낸다
export function AddRecordLink({ href, label }: { href: "/records" | "/records/scenes/new"; label: string }) {
  return (
    <Link href={href} className="inline-block rounded-lg border border-foreground/20 px-4 py-2 text-sm font-medium">
      {label}
    </Link>
  );
}
