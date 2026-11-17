import type { FetchedPosting } from "../modules/postings/fetch-page";

// 로컬 미리보기용. 실제로 주소를 열지 않고, 주소에 든 낱말에 따라 정해진 결과를 돌려준다.

// 1x1 흰색 PNG
const PIXEL = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==";

export async function fetchPosting(raw: string): Promise<FetchedPosting> {
  await new Promise((resolve) => setTimeout(resolve, 400));
  if (!/^https?:\/\//.test(raw.trim())) return { ok: false, reason: "bad_url" };
  if (raw.includes("blocked")) return { ok: false, reason: "blocked" };
  if (raw.includes("empty")) return { ok: false, reason: "empty" };
  if (raw.includes("image")) return { ok: true, text: "그림상사 채용", images: [{ mediaType: "image/png", data: PIXEL }] };
  return {
    ok: true,
    text: "주소상사 데이터 분석가 채용\n\n담당 업무: 매출 데이터 분석과 보고\n자격 요건: 신입 지원 가능\n고용 형태: 정규직\n근무지: 서울 중구 세종대로\n접수 마감: 2026-12-01",
    images: [],
  };
}
