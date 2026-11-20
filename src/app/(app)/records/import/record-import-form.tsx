"use client";

import Link from "next/link";
import type { CreatedItem } from "@/modules/experiences/record-import";
import { importRecordsAction } from "@/modules/experiences/record-actions";
import { FACT_KIND_LABELS } from "@/modules/experiences/record-options";
import { type ImportKit, ImportScreen } from "../_shared/import-form";

const labelOf = (kind: CreatedItem["kind"]) => (kind === "scene" ? "사례" : FACT_KIND_LABELS[kind]);

// 새 기록 구조로 가져오기. 만든 순서(경력 다음에 그 사례)대로 메뉴 이름을 붙여 보인다
const RECORD_KIT: ImportKit<CreatedItem> = {
  run: importRecordsAction,
  Item: ({ item }) => (
    <>
      <span className={`flex min-w-0 flex-1 items-center gap-2 ${item.kind === "scene" ? "pl-5" : ""}`}>
        <span
          className={`shrink-0 rounded-full border px-2 py-0.5 text-xs ${
            item.kind === "scene" ? "border-foreground/15 text-foreground/60" : "border-foreground/30 text-foreground/80"
          }`}
        >
          {item.kind === "scene" ? "└ 사례" : labelOf(item.kind)}
        </span>
        <span className="min-w-0 truncate font-medium">{item.name}</span>
      </span>
      <Link href={item.kind === "scene" ? `/records/scenes/${item.id}` : `/records/facts/${item.kind}/${item.id}`} className="text-sm underline">
        열기
      </Link>
    </>
  ),
  headline: (items) => `기록 ${items.length}개를 만들었습니다`,
  summary: (items) => {
    const counts = new Map<string, number>();
    for (const item of items) counts.set(labelOf(item.kind), (counts.get(labelOf(item.kind)) ?? 0) + 1);
    return [...counts].map(([label, n]) => `${label} ${n}`).join(" · ");
  },
  note: "모두 “미확인” 상태입니다. 학력·경력 같은 정보는 열어서 맞음을 누르고, 사례는 주장을 하나씩 확인해야 지원서에 쓸 수 있습니다",
  intro: "이력서, 자기소개서, 메모를 붙여 넣거나 파일로 올리면, AI가 학력·경력·자격과 경험 사례로 나눠 기록 초안을 만듭니다",
  backHref: "/records",
  backLabel: "경험 기록으로",
};

export function RecordImportForm() {
  return <ImportScreen kit={RECORD_KIT} />;
}
