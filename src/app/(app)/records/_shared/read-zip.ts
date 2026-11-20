import type { ExportFile } from "@/modules/experiences/notion-export";

// 노션에서 내보낸 zip을 브라우저에서 푼다. zip은 서버로 보내지 않는다.

export const MAX_ZIP_BYTES = 20 * 1024 * 1024;
const MAX_PAGES = 500;
const MAX_TOTAL_CHARS = 5_000_000; // 풀었을 때 터무니없이 커지는 파일을 막는다

const MAX_PAGE_BYTES = 2 * 1024 * 1024; // 페이지 하나
const MAX_INNER_ZIP_BYTES = 50 * 1024 * 1024; // 안쪽 zip을 풀었을 때

// 풀기 전에 zip에 적힌 "풀었을 때 크기"를 본다. 작은 파일이 터무니없이 크게 풀리는 것을 풀기 전에 막는다
const sizeOf = (entry: unknown) => (entry as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 0;
const TOO_BIG = "내용이 너무 깁니다. 나눠서 내보내 주세요";

export type ZipResult = { ok: true; files: ExportFile[] } | { ok: false; message: string };

export async function readZip(file: File): Promise<ZipResult> {
  if (file.size > MAX_ZIP_BYTES) return { ok: false, message: "파일이 너무 큽니다. 20MB까지 올릴 수 있습니다" };
  try {
    const { default: JSZip } = await import("jszip");
    const files: ExportFile[] = [];
    let total = 0;
    let declared = 0;

    // 노션은 큰 내보내기를 zip 안의 zip으로 준다. 한 단계까지만 푼다
    const read = async (data: ArrayBuffer | Uint8Array, nested: boolean): Promise<string | null> => {
      const zip = await JSZip.loadAsync(data);
      for (const [path, entry] of Object.entries(zip.files)) {
        if (entry.dir) continue;
        if (/\.zip$/i.test(path) && !nested) {
          if (sizeOf(entry) > MAX_INNER_ZIP_BYTES) return TOO_BIG;
          const problem = await read(await entry.async("uint8array"), true);
          if (problem) return problem;
        } else if (/\.md$/i.test(path)) {
          if (files.length >= MAX_PAGES) return `페이지가 너무 많습니다. ${MAX_PAGES}개까지 올릴 수 있습니다`;
          declared += sizeOf(entry);
          if (sizeOf(entry) > MAX_PAGE_BYTES || declared > MAX_TOTAL_CHARS * 4) return TOO_BIG;
          const text = await entry.async("string");
          total += text.length;
          if (total > MAX_TOTAL_CHARS) return TOO_BIG;
          files.push({ path, text });
        }
      }
      return null;
    };

    const problem = await read(await file.arrayBuffer(), false);
    if (problem) return { ok: false, message: problem };
    if (files.length === 0) {
      return { ok: false, message: "페이지(.md)를 찾지 못했습니다. 노션에서 “내보내기 → Markdown & CSV”로 받은 zip을 올려 주세요" };
    }
    return { ok: true, files };
  } catch {
    return { ok: false, message: "zip 파일을 열 수 없습니다. 파일이 깨졌거나 zip이 아닙니다" };
  }
}
