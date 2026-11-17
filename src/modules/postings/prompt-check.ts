import type { Db } from "@/db/types";
import type { AiClient } from "@/modules/ai/client";
import { type ExtractedPosting, extractPosting } from "./extract";

// 준비한 공고 예시를 실제 AI에 돌려, 값을 맞게 뽑고 없는 값은 비워 두는지 본다(관리자 전용, 호출 2번)

export type PostingCheckRow = { sample: string; check: string; expected: string; actual: string; pass: boolean };

const TODAY = "2026-11-17";

// 값이 다 적힌 공고. 연도 없는 마감일, 채용 대행사 이름, 경력 범위가 섞여 있다
export const FULL_POSTING = {
  name: "값이 다 적힌 공고",
  source: `[잡코리아 채용 공고]
(주)가나다테크 백엔드 개발자 모집

담당 업무
- 주문·결제 서비스 API 개발 및 운영

자격 요건
- 경력 3~5년
- Java 또는 Kotlin 개발 경험

우대 사항
- 대용량 트래픽 처리 경험

근무 조건
- 고용 형태: 정규직 (수습 3개월)
- 근무지: 경기도 성남시 분당구 판교역로 (본사는 서울 강남구)

접수 기간: 11월 3일 ~ 12월 5일 18시
문의: 채용 담당자 02-1234-5678`,
};

// 마감일, 근무지, 경력, 고용 형태가 적히지 않은 공고. 지어내지 않고 비워 두는지 본다
export const SPARSE_POSTING = {
  name: "값이 적히지 않은 공고",
  source: `다라마 스튜디오에서 함께할 콘텐츠 마케터를 찾습니다

이런 일을 합니다
- SNS 채널 기획과 운영
- 캠페인 성과 정리

이런 분을 찾습니다
- 글쓰기를 좋아하는 분
- 새로운 시도를 즐기는 분

지원 방법: 이력서와 포트폴리오를 메일로 보내 주세요. 채용 시 마감합니다.`,
};

type Row = (check: string, expected: string, actual: string, pass: boolean) => PostingCheckRow;
const show = (value: unknown) => (value === null || value === "" ? "비어 있음" : Array.isArray(value) ? value.join(", ") || "비어 있음" : String(value));

function fullRows(value: ExtractedPosting, row: Row): PostingCheckRow[] {
  return [
    row("회사명", "(주)가나다테크 (채용 사이트 이름이 아님)", show(value.company), value.company.includes("가나다테크") && !value.company.includes("잡코리아")),
    row("직무명", "백엔드 개발자", show(value.title), value.title.includes("백엔드 개발자")),
    row("마감일 (연도가 없어도 올해로)", "2026-12-05", show(value.deadline), value.deadline === "2026-12-05"),
    row("근무지의 시·도 (본사가 아니라 근무지)", "gyeonggi", show(value.regions), value.regions.length === 1 && value.regions[0] === "gyeonggi"),
    row("신입·경력 구분", "experienced", value.careerType, value.careerType === "experienced"),
    row("요구 경력 (3~5년이면 3)", "3", show(value.minYears), value.minYears === 3),
    row("고용 형태", "regular", value.employmentType, value.employmentType === "regular"),
    row("원문에 없는 이름을 쓰지 않는다", "없음", show(value.unverified), value.unverified.length === 0),
  ];
}

function sparseRows(value: ExtractedPosting, row: Row): PostingCheckRow[] {
  return [
    row("회사명", "다라마 스튜디오", show(value.company), value.company.includes("다라마 스튜디오")),
    row("직무명", "콘텐츠 마케터", show(value.title), value.title.includes("콘텐츠 마케터")),
    row("마감일을 지어내지 않는다", "비어 있음", show(value.deadline), value.deadline === null),
    row("채용 시 마감을 상시 채용으로 본다", "true", String(value.isRolling), value.isRolling),
    row("근무지를 지어내지 않는다", "비어 있음", show(value.regions), value.regions.length === 0 && value.locationText === null),
    row("경력 연수를 지어내지 않는다", "비어 있음", show(value.minYears), value.minYears === null),
    row("신입·경력 구분을 지어내지 않는다", "any", value.careerType, value.careerType === "any"),
    row("고용 형태를 지어내지 않는다", "unknown", value.employmentType, value.employmentType === "unknown"),
  ];
}

export async function runPostingCheck(db: Db, ai: AiClient, userId: string, now: Date = new Date()): Promise<PostingCheckRow[]> {
  const run = async (sample: { name: string; source: string }, rows: (value: ExtractedPosting, row: Row) => PostingCheckRow[]) => {
    const row: Row = (check, expected, actual, pass) => ({ sample: sample.name, check, expected, actual, pass });
    const result = await extractPosting(db, ai, userId, sample.source, TODAY, now);
    return result.ok ? rows(result.value, row) : [row("AI 호출", "성공", `실패: ${result.reason}`, false)];
  };
  return (await Promise.all([run(FULL_POSTING, fullRows), run(SPARSE_POSTING, sparseRows)])).flat();
}
