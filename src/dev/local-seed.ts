// 로컬 미리보기 전용. LOCAL_SEED=career일 때 트랙 하나와 확인된 경력·그 아래 사례·딸린 프로젝트, 지원으로 고른 공고 하나를 넣는다
// (경력기술서 공통본·맞춤본 화면을 설문과 기록 입력 없이 바로 볼 수 있게). 실제 배포에는 들어가지 않는다.
import { eq } from "drizzle-orm";
import type { Db } from "@/db/types";
import { createFact } from "@/modules/experiences/facts-repo";
import { applyWithCurrentScore } from "@/modules/postings/apply";
import { validatePosting } from "@/modules/postings/input";
import { createPosting, saveAnalysis } from "@/modules/postings/repo";
import { confirmScene, createScene } from "@/modules/experiences/scenes-repo";
import { scenes } from "@/modules/experiences/schema";
import { createTrack } from "@/modules/tracks/repo";

const must = (result: { ok: true; id: string } | { ok: false; reason: string }): string => {
  if (!result.ok) throw new Error(`미리보기 씨앗을 넣지 못했습니다: ${result.reason}`);
  return result.id;
};

export async function seedCareer(db: Db, userId: string): Promise<void> {
  const trackId = must(
    await createTrack(db, userId, {
      name: "백엔드 개발",
      majorCode: "20",
      jobs: [{ ncsCode: "20010202", customName: null }],
      applicantType: "experienced",
      experienceMonths: 30,
      regions: ["seoul"],
      salaryMin: null,
      employmentTypes: ["regular"],
      importanceOrder: ["jobMatch", "location", "experience", "field", "preferred"],
      extraAnswers: {},
    }),
  );
  const jobId = must(
    await createFact(
      db,
      userId,
      "job",
      {
        company: "가나다 주식회사",
        department: "결제개발팀",
        title: "사원",
        employment: "regular",
        startMonth: "2022-03",
        endMonth: "2024-08",
        isOngoing: false,
        duties: ["결제 서버 운영", "장애 대응"],
        bannedPhrases: [],
      },
      { confirmed: true },
    ),
  );
  must(
    await createFact(
      db,
      userId,
      "project",
      {
        name: "사내 정산 도구",
        parent: { kind: "job", id: jobId },
        startMonth: "2023-01",
        endMonth: "2023-06",
        isOngoing: false,
        role: "백엔드",
        tools: ["Kotlin", "PostgreSQL"],
        summary: "매일 손으로 하던 가맹점 정산을 자동으로 돌리는 도구",
        bannedPhrases: [],
      },
      { confirmed: true },
    ),
  );
  const sceneId = must(
    await createScene(db, userId, {
      head: { kind: "job", id: jobId },
      title: "결제 장애 대응",
      startMonth: "2023-03",
      endMonth: "2023-11",
      isOngoing: false,
      situation: "결제 승인 장애가 잦았다",
      judgment: null,
      actions: "승인 API의 재시도 방식을 다시 설계했다",
      result: "장애가 줄었다",
      lessons: null,
      metrics: [{ text: "월 장애 5건에서 1건", basis: "장애 보고서" }],
      notDone: null,
      bannedPhrases: [],
      evidenceNote: null,
      tags: [],
    }),
  );
  // AI 판정을 흉내 낸다(필수 항목 충족). 확인은 사용자가 누른 것처럼 저장소 함수로
  await db
    .update(scenes)
    .set({
      rubric: {
        period: { status: "met", note: null },
        role: { status: "met", note: null },
        level: { status: "met", note: null },
        metrics: { status: "met", note: null },
        evidence: { status: "unjudged", note: null },
      },
    })
    .where(eq(scenes.id, sceneId));
  const confirmed = await confirmScene(db, userId, sceneId);
  if (!confirmed.ok) throw new Error(`미리보기 씨앗을 넣지 못했습니다: ${confirmed.reason}`);
  await seedApplyPosting(db, userId, trackId);
}

// 점수를 본 뒤 지원으로 고른 공고(맞춤본·제출 화면용)
async function seedApplyPosting(db: Db, userId: string, trackId: string): Promise<void> {
  const rawText = "라마바 페이 백엔드 개발자 채용\n자격 요건\n- 결제 서버 운영 경력 2년 이상\n- 장애 대응 경험\n제출 서류: 이력서, 경력기술서";
  const checked = validatePosting({
    company: "라마바 페이",
    title: "백엔드 개발자",
    deadline: "2026-12-31",
    isRolling: false,
    locationText: "서울 강남구",
    regions: ["seoul"],
    careerType: "experienced",
    minYears: 2,
    employmentType: "regular",
    url: null,
    rawText,
    companyNote: null,
  });
  if (!checked.ok) throw new Error("미리보기 씨앗을 넣지 못했습니다: 공고 입력");
  const postingId = must(await createPosting(db, userId, trackId, checked.value));
  const analyzed = await saveAnalysis(
    db,
    userId,
    postingId,
    {
      target: "개발",
      requirements: [
        { kind: "required", text: "결제 서버 운영 경력 2년 이상", quote: "결제 서버 운영 경력 2년 이상", quoteFound: true, evidence: [] },
        { kind: "preferred", text: "장애 대응 경험", quote: "장애 대응 경험", quoteFound: true, evidence: [] },
      ],
      field: { level: "same_job", reason: "분야가 같다" },
      analyzedAt: new Date().toISOString(),
    },
    { rawText, companyNote: null },
  );
  if (!analyzed.ok) throw new Error(`미리보기 씨앗을 넣지 못했습니다: ${analyzed.reason}`);
  const applied = await applyWithCurrentScore(db, userId, postingId);
  if (!applied.ok) throw new Error(`미리보기 씨앗을 넣지 못했습니다: ${applied.reason}`);
}
