"use client";

import { useEffect, useRef, useState } from "react";
import type { SectionId } from "./record-tree";
import { activeSection } from "./section-nav-active";

// 묶음 제목이 이 선(화면 위에서 px) 위로 올라가면 그 묶음을 보고 있다고 본다. 좁은 화면의 목차 줄 아래쯤
const LINE = 120;

// 이력·경험 사례 탭의 목차. 넓은 화면(xl)에서는 본문 오른쪽 바깥에 세로로 따라오고, 좁은 화면에서는 탭 아래 가로줄로 붙는다.
// 부모는 position: relative인 상자여야 한다(넓은 화면에서 그 상자 높이만큼 따라온다)
export function SectionNav({ sections }: { sections: { id: SectionId; label: string }[] }) {
  const [active, setActive] = useState<string | null>(sections[0]?.id ?? null);
  const listRef = useRef<HTMLUListElement>(null);
  // 누르거나 주소(#sec-…)로 온 묶음. 끝까지 내려도 그 묶음이 기준선에 못 닿을 때(아래쪽 짧은 묶음) 그 묶음을 굵게 둔다
  const pinned = useRef<string | null>(null);
  const ids = sections.map((s) => s.id).join(",");

  useEffect(() => {
    let frame = 0;
    const fromHash = location.hash.startsWith("#sec-") ? location.hash.slice("#sec-".length) : null;
    if (fromHash && ids.split(",").includes(fromHash)) pinned.current = fromHash;
    const update = () => {
      frame = 0;
      const tops = ids.split(",").flatMap((id) => {
        const element = document.getElementById(`sec-${id}`);
        return element ? [{ id, top: element.getBoundingClientRect().top }] : [];
      });
      // 끝까지 내렸는데 마지막 묶음이 기준선에 못 닿으면 마지막 묶음을 보인다
      const atBottom = window.scrollY > 0 && window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
      let next = atBottom && tops.length > 0 ? tops[tops.length - 1].id : activeSection(tops, LINE);
      // 끝에 닿았을 때 고른 묶음이 화면에 보이면 그 묶음을 굵게 둔다. 끝에서 벗어나 그 묶음이 기준선 밖으로 나가면 놓는다
      const pin = tops.find((t) => t.id === pinned.current);
      if (pin && atBottom && pin.top >= 0 && pin.top < window.innerHeight) next = pin.id;
      else if (pin && !atBottom && (pin.top < 0 || pin.top > LINE)) pinned.current = null;
      setActive(next);
    };
    const schedule = () => {
      if (frame === 0) frame = requestAnimationFrame(update);
    };
    schedule();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      if (frame !== 0) cancelAnimationFrame(frame);
    };
  }, [ids]);

  // 가로줄에서 지금 묶음이 가려지지 않게 그쪽으로 민다
  useEffect(() => {
    const list = listRef.current;
    if (!list || list.scrollWidth <= list.clientWidth) return;
    const link = list.querySelector<HTMLElement>('[aria-current="location"]');
    if (link) list.scrollTo({ left: link.offsetLeft - (list.clientWidth - link.offsetWidth) / 2 });
  }, [active]);

  return (
    <nav
      aria-label="목차"
      className="sticky top-0 z-10 -mx-4 border-b border-foreground/10 bg-background px-4 xl:absolute xl:top-0 xl:left-[calc(100%+2.5rem)] xl:mx-0 xl:h-full xl:w-44 xl:border-0 xl:bg-transparent xl:px-0"
    >
      <ul ref={listRef} className="relative flex gap-1 overflow-x-auto text-sm xl:sticky xl:top-8 xl:flex-col xl:gap-0 xl:overflow-visible">
        {sections.map(({ id, label }) => {
          const on = id === active;
          return (
            <li key={id} className="shrink-0">
              <a
                href={`#sec-${id}`}
                onClick={() => {
                  pinned.current = id;
                  setActive(id);
                }}
                aria-current={on ? "location" : undefined}
                className={`block px-2 py-2 xl:border-l-2 xl:px-3 xl:py-1.5 ${
                  on ? "font-semibold text-foreground xl:border-foreground" : "text-foreground/60 xl:border-foreground/10"
                }`}
              >
                {label}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
