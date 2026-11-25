import Link from "next/link";

const TABS = [
  { id: "basic", label: "기본정보", href: "/records?tab=basic" },
  { id: "history", label: "이력", href: "/records" },
  { id: "scenes", label: "경험 사례", href: "/records/scenes" },
] as const;

// 경험 기록의 세 탭 줄. 이력 탭과 경험 사례 탭이 함께 쓴다
export function RecordTabs({ current }: { current: (typeof TABS)[number]["id"] }) {
  return (
    <nav aria-label="기록 메뉴" className="-mx-4 flex gap-1 overflow-x-auto border-b border-foreground/10 px-4 text-sm">
      {TABS.map((tab) => (
        <Link
          key={tab.id}
          href={tab.href}
          aria-current={tab.id === current ? "page" : undefined}
          className={`shrink-0 border-b-2 px-3 py-2 ${
            tab.id === current ? "border-foreground font-semibold" : "border-transparent text-foreground/60"
          }`}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
