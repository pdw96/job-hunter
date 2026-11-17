// 공고 그림을 AI가 읽기 좋은 크기로 줄이고, 세로로 긴 그림은 위에서 아래로 조각낸다(브라우저에서 한다).
// 긴 그림을 통째로 보내면 작게 줄어들어 글자를 읽을 수 없기 때문이다.

export type Tile = { mediaType: "image/jpeg"; data: string };

const MAX_WIDTH = 1100;
const TILE_HEIGHT = 1500;
const OVERLAP = 80; // 잘린 경계의 글자를 놓치지 않게 조금 겹친다
export const MAX_TILES = 10;
const MAX_TOTAL_BASE64 = 3_800_000;

async function load(source: Blob): Promise<ImageBitmap> {
  return createImageBitmap(source);
}

function tilesOf(bitmap: ImageBitmap, quality: number): Tile[] {
  const scale = Math.min(1, MAX_WIDTH / bitmap.width);
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);
  const tiles: Tile[] = [];
  for (let top = 0; top < height; top += TILE_HEIGHT - OVERLAP) {
    const tileHeight = Math.min(TILE_HEIGHT, height - top);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = tileHeight;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("canvas");
    // 투명한 배경은 흰색으로 채운다
    context.fillStyle = "#fff";
    context.fillRect(0, 0, width, tileHeight);
    context.drawImage(bitmap, 0, top / scale, bitmap.width, tileHeight / scale, 0, 0, width, tileHeight);
    tiles.push({ mediaType: "image/jpeg", data: canvas.toDataURL("image/jpeg", quality).split(",")[1] });
    if (top + tileHeight >= height) break;
  }
  return tiles;
}

export type SliceResult = { ok: true; tiles: Tile[] } | { ok: false; message: string };

// 그림 여러 장을 순서대로 조각낸다. 전체가 너무 크면 화질을 낮춰 다시 해 본다
export async function sliceImages(sources: Blob[]): Promise<SliceResult> {
  let bitmaps: ImageBitmap[];
  try {
    bitmaps = await Promise.all(sources.map(load));
  } catch {
    return { ok: false, message: "그림을 열 수 없습니다. JPG, PNG, WEBP 그림을 올려 주세요" };
  }
  try {
    for (const quality of [0.85, 0.7, 0.55]) {
      const tiles = bitmaps.flatMap((bitmap) => tilesOf(bitmap, quality));
      if (tiles.length > MAX_TILES) return { ok: false, message: "그림이 너무 깁니다. 공고를 둘로 나눠 올려 주세요" };
      if (tiles.reduce((sum, tile) => sum + tile.data.length, 0) <= MAX_TOTAL_BASE64) return { ok: true, tiles };
    }
    return { ok: false, message: "그림이 너무 큽니다. 공고를 둘로 나눠 올려 주세요" };
  } catch {
    return { ok: false, message: "그림을 처리하지 못했습니다. 다른 그림으로 해 보세요" };
  } finally {
    for (const bitmap of bitmaps) bitmap.close();
  }
}

export function base64ToBlob(data: string, mediaType: string): Blob {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: mediaType });
}
