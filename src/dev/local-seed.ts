// 로컬 미리보기 전용. LOCAL_SEED=career일 때 트랙 하나와 확인된 경력·그 아래 사례·딸린 프로젝트를 넣는다
// (경력기술서 화면을 설문과 기록 입력 없이 바로 볼 수 있게). 실제 배포에는 들어가지 않는다.
import { eq } from "drizzle-orm";
import type { Db } from "@/db/types";
import { createFact } from "@/modules/experiences/facts-repo";
import { confirmScene, createScene } from "@/modules/experiences/scenes-repo";
import { scenes } from "@/modules/experiences/schema";
import { createTrack } from "@/modules/tracks/repo";

const must = (result: { ok: true; id: string } | { ok: false; reason: string }): string => {
  if (!result.ok) throw new Error(`미리보기 씨앗을 넣지 못했습니다: ${result.reason}`);
  return result.id;
};

export async function seedCareer(db: Db, userId: string): Promise<void> {
  must(
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
}
