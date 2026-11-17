// 노션에서 내보낸 파일 목록을 경험별 묶음으로 나눈다. 화면과 DB를 모르는 순수 함수만 둔다.
// 노션은 페이지 하나를 "이름 <ID>.md"로, 그 하위 페이지를 "이름/" 폴더 안에 내보낸다.

export type ExportFile = { path: string; text: string };
export type PageGroup = {
  title: string;
  text: string;
  chars: number;
  pages: number; // 본문과 하위 페이지를 합친 수
  tooLong: boolean;
};

// 한 번에 가져올 수 있는 글 길이(import-text의 MAX_SOURCE_CHARS와 같다)
export const MAX_GROUP_CHARS = 40_000;

const isPage = (path: string) => /\.md$/i.test(path) && !path.split("/").some((part) => part === "__MACOSX" || part.startsWith("._"));
const depth = (path: string) => path.split("/").length;
// "이름 4154…(32자리).md" → "이름". 이 이름의 폴더에 하위 페이지가 들어 있다
const folderOf = (path: string) => path.replace(/\.md$/i, "").replace(/\s+[0-9a-f]{32}$/i, "");
const fileName = (path: string) => folderOf(path).split("/").pop() ?? "";

// 첫 줄의 "# 제목"을 떼어 제목과 나머지로 나눈다. 파일 이름은 노션이 잘라 버려서 제목으로 쓰지 않는다
function splitTitle(file: ExportFile): { title: string; body: string } {
  const text = file.text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const match = text.match(/^\s*#\s+(.+)\n?/);
  return match ? { title: match[1].trim(), body: text.slice(match[0].length) } : { title: fileName(file.path), body: text };
}

// 다른 페이지나 표로 가는 링크만 있는 줄은 글이 아니므로 지운다
const clean = (body: string) =>
  body
    .split("\n")
    .filter((line) => !/^\s*(?:[-*]\s+)?\[[^\]]*\]\([^)]*\.(?:md|csv)\)\s*$/i.test(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

export function groupPages(files: ExportFile[], maxChars = MAX_GROUP_CHARS): PageGroup[] {
  const pages = files
    .map((file) => ({ ...file, path: file.path.replace(/\\/g, "/").replace(/^\/+/, "") }))
    .filter((file) => isPage(file.path))
    .sort((a, b) => depth(a.path) - depth(b.path) || a.path.localeCompare(b.path));

  const used = new Set<string>();
  const groups: PageGroup[] = [];
  for (const top of pages) {
    if (used.has(top.path)) continue;
    used.add(top.path);
    const folder = `${folderOf(top.path)}/`;
    const subs = pages.filter((page) => !used.has(page.path) && page.path.startsWith(folder));
    for (const sub of subs) used.add(sub.path);

    const main = splitTitle(top);
    const parts = [`# ${main.title}`, clean(main.body)];
    for (const sub of subs) {
      const { title, body } = splitTitle(sub);
      const text = clean(body);
      if (text !== "") parts.push(`## [하위 페이지] ${title}`, text);
    }
    const text = parts.filter((part) => part !== "").join("\n\n");
    groups.push({ title: main.title, text, chars: text.length, pages: 1 + subs.length, tooLong: text.length > maxChars });
  }
  return groups;
}
