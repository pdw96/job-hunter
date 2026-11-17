import type { Db } from "@/db/types";
import type { AiClient } from "@/modules/ai/client";
import type { EvidenceCandidate } from "@/modules/experiences/evidence";
import { analyzeText, type TextAnalysis } from "./analyze";
import { type ExtractedPosting, extractPosting } from "./extract";

// 준비한 공고 예시를 실제 AI에 돌려, 값을 맞게 뽑고 없는 값은 비워 두는지, 요구 사항에 맞는 경험만 근거로 짚는지 본다(관리자 전용, 호출 4번)

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

// 주소로 읽었을 때 공고 내용은 빠지고 사이트의 틀만 읽힌 글. 공고 내용이 없다고 가려내는지 본다
export const CHROME_ONLY = {
  name: "사이트 안내만 읽힌 글",
  source: `[가나다(주)] 조립 신입 채용(D-2) - 채용사이트

본문 바로가기
검색어입력
로그인
회원가입
- 홈
- 채용정보
- 신입·인턴
- 기업·연봉
- 커뮤니티

구직자의 개인정보 보호
채용 과정에서 이름, 생년월일, 계좌정보 등 불필요한 개인정보를 요청하지 않습니다.

로그인이 필요한 서비스입니다.
아이디
비밀번호
아이디 찾기
비밀번호 찾기`,
};

// 요구 사항 맞대기 예시. FULL_POSTING의 요구 사항에 ①은 맞고 ②는 어느 것과도 맞지 않는다
const SAMPLE_EXPERIENCE_BASE = { organization: null, role: null, endMonth: null, isOngoing: false, notDone: null, contentVersion: 0, state: "confirmed" } as const;
export const MATCH_CANDIDATES: EvidenceCandidate[] = [
  {
    ...SAMPLE_EXPERIENCE_BASE,
    id: "sample-kotlin",
    name: "주문 API 개발",
    kind: "job",
    organization: "나다상사",
    role: "백엔드 개발자",
    startMonth: "2023-03",
    endMonth: "2025-08",
    situation: "주문 처리 서버를 새로 만들 일이 있었다",
    actions: "Kotlin과 Spring으로 주문 접수·조회 API를 설계하고 구현했다",
    result: "기존 주문 화면이 새 API로 옮겨 갔다",
  },
  {
    ...SAMPLE_EXPERIENCE_BASE,
    id: "sample-excel",
    name: "사내 엑셀 매크로 제작",
    kind: "project",
    startMonth: "2022-05",
    endMonth: "2022-07",
    situation: "총무팀이 매달 경비 정산표를 손으로 합치고 있었다",
    actions: "엑셀 매크로로 정산표를 자동으로 합치게 만들었다",
    result: "정산표 정리 시간이 줄었다",
  },
];
export const MATCH_SAMPLE = { name: "요구 사항 맞대기", source: FULL_POSTING.source, jobNames: ["백엔드 개발자"], majorName: "정보통신" };

function matchRows(value: TextAnalysis, row: Row): PostingCheckRow[] {
  const [kotlin, excel] = MATCH_CANDIDATES;
  const all = value.requirements;
  const javaKotlin = all.filter((r) => r.kind === "required" && /Java|Kotlin/.test(`${r.text} ${r.quote}`));
  const highTraffic = all.filter((r) => r.kind === "preferred" && `${r.text} ${r.quote}`.includes("대용량"));
  const usedBy = (id: string) => all.filter((r) => r.evidence.some((e) => e.experienceId === id)).map((r) => r.text);
  // 경력 연수는 코드가 설문의 총 경력으로 따로 점수를 매긴다. 띄어쓰기가 달라도 "3~5년"이 들어 있으면 그 요건으로 본다
  const yearsOnly = all.filter((r) => `${r.text} ${r.quote}`.replace(/\s+/g, "").includes("3~5년"));
  return [
    row("Java·Kotlin 요구 사항의 근거로 ①을 짚는다", "①이 근거", show(javaKotlin.map((r) => (r.evidence.some((e) => e.experienceId === kotlin.id) ? "①" : "근거 없음"))), javaKotlin.some((r) => r.evidence.some((e) => e.experienceId === kotlin.id))),
    row("②를 어느 요구 사항의 근거로도 짚지 않는다", "없음", show(usedBy(excel.id)), usedBy(excel.id).length === 0),
    row("대용량 트래픽 우대는 부족한 점으로 남긴다", "근거 없음", highTraffic.length === 0 ? "요구 사항을 못 찾음" : show(highTraffic.map((r) => `근거 ${r.evidence.length}건`)), highTraffic.length > 0 && highTraffic.every((r) => r.evidence.length === 0)),
    row("경력 연수만 적힌 요건(경력 3~5년)은 요구 사항으로 뽑지 않는다", "없음", show(yearsOnly.map((r) => r.text)), yearsOnly.length === 0),
    row("인용한 구절이 모두 원문에 있다", "모두 true", `${all.filter((r) => r.quoteFound).length}/${all.length}`, all.length > 0 && all.every((r) => r.quoteFound)),
    row("분야를 same_job으로 본다", "same_job", value.field.level, value.field.level === "same_job"),
  ];
}

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
    row("공고 내용이 있다고 본다", "true", String(value.hasDetails), value.hasDetails),
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
    row("적힌 값이 적어도 공고 내용은 있다고 본다", "true", String(value.hasDetails), value.hasDetails),
  ];
}

function chromeRows(value: ExtractedPosting, row: Row): PostingCheckRow[] {
  return [row("공고 내용이 없는 글을 가려낸다", "false", String(value.hasDetails), !value.hasDetails)];
}

export async function runPostingCheck(db: Db, ai: AiClient, userId: string, now: Date = new Date()): Promise<PostingCheckRow[]> {
  const run = async (sample: { name: string; source: string }, rows: (value: ExtractedPosting, row: Row) => PostingCheckRow[]) => {
    const row: Row = (check, expected, actual, pass) => ({ sample: sample.name, check, expected, actual, pass });
    const result = await extractPosting(db, ai, userId, sample.source, TODAY, now);
    return result.ok ? rows(result.value, row) : [row("AI 호출", "성공", `실패: ${result.reason}`, false)];
  };
  const match = async () => {
    const row: Row = (check, expected, actual, pass) => ({ sample: MATCH_SAMPLE.name, check, expected, actual, pass });
    const result = await analyzeText(
      db,
      ai,
      userId,
      { rawText: MATCH_SAMPLE.source, companyNote: null, jobNames: MATCH_SAMPLE.jobNames, majorName: MATCH_SAMPLE.majorName, candidates: MATCH_CANDIDATES },
      now,
    );
    return result.ok ? matchRows(result.value, row) : [row("AI 호출", "성공", `실패: ${result.reason}`, false)];
  };
  return (await Promise.all([run(FULL_POSTING, fullRows), run(SPARSE_POSTING, sparseRows), run(CHROME_ONLY, chromeRows), match()])).flat();
}
