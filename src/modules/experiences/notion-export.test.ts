import { expect, test } from "vitest";
import { groupPages } from "./notion-export";

const ID1 = "4154287299b981b38014f1aa7685cdd9";
const ID2 = "4154287299b98126a22ac841cf10fa3c";
const ID3 = "4154287299b9815296f7fb77ebdd930e";
const ID4 = "4154287299b981149eceeb54591c4eb3";

const files = [
  { path: `이력 8c9dda2ce19f4cec858b867dcf173f29.csv`, text: "기간명,구분\n생산관리,재직" },
  {
    path: `이력/생산관리 전담 (2023 04~2024 10, 약 ${ID1}.md`,
    text: `# 생산관리 전담 (2023.04~2024.10, 약 1년 6개월)\n\n구분: 재직\n\n- 6~15개 품목 담당\n\n[사용 금지 표현](%EC%83%9D/abc%20${ID2}.md)\n\n[표](x.csv)\n`,
  },
  { path: `이력/생산관리 전담 (2023 04~2024 10, 약/사용 금지 표현 ${ID2}.md`, text: `# 사용 금지 표현\n\n- 🚫 "전 품목"\n` },
  { path: `이력/생산관리 전담 (2023 04~2024 10, 약/사례/APHA ${ID3}.md`, text: `# 성과 사례 · APHA\n\n불량이 3회 이하 발생\n` },
  { path: `이력/생산관리 전담 (2023 04~2024 10, 약/그림.png`, text: "" },
  { path: `이력/인프라건설 TF ${ID4}.md`, text: `인프라건설 TF 본문 (제목 줄 없음)` },
  { path: `__MACOSX/이력/._숨김 ${ID4}.md`, text: "쓰레기" },
];

test("본문 페이지 하나가 묶음 하나이고, 같은 이름 폴더의 페이지가 하위 페이지로 붙는다", () => {
  const groups = groupPages(files);
  expect(groups.map((group) => [group.title, group.pages])).toEqual([
    ["생산관리 전담 (2023.04~2024.10, 약 1년 6개월)", 3],
    ["인프라건설 TF", 1],
  ]);
});

test("묶음의 글은 본문 다음에 하위 페이지가 제목과 함께 이어지고, 링크만 있는 줄은 빠진다", () => {
  const [group] = groupPages(files);
  expect(group.text).toBe(
    [
      "# 생산관리 전담 (2023.04~2024.10, 약 1년 6개월)",
      "구분: 재직\n\n- 6~15개 품목 담당",
      "## [하위 페이지] 사용 금지 표현",
      '- 🚫 "전 품목"',
      "## [하위 페이지] 성과 사례 · APHA",
      "불량이 3회 이하 발생",
    ].join("\n\n"),
  );
  expect(group.chars).toBe(group.text.length);
  expect(group.tooLong).toBe(false);
});

test("제목 줄이 없으면 파일 이름에서 ID를 뗀 것을 제목으로 쓴다", () => {
  expect(groupPages(files)[1]).toMatchObject({ title: "인프라건설 TF", text: "# 인프라건설 TF\n\n인프라건설 TF 본문 (제목 줄 없음)" });
});

test("글이 한도를 넘는 묶음은 표시한다", () => {
  expect(groupPages(files, 50).map((group) => group.tooLong)).toEqual([true, false]);
});

test("페이지가 없으면 빈 목록이다", () => {
  expect(groupPages([{ path: "a.csv", text: "x" }])).toEqual([]);
});

test("윈도우 경로 구분자와 내용이 빈 하위 페이지도 다룬다", () => {
  const groups = groupPages([
    { path: `db\\가 ${ID1}.md`, text: "# 가\n\n본문" },
    { path: `db\\가\\빈 페이지 ${ID2}.md`, text: "# 빈 페이지\n" },
  ]);
  expect(groups).toHaveLength(1);
  expect(groups[0].text).toBe("# 가\n\n본문");
});
