import type { Db } from "@/db/types";
import { listEvidenceCandidates } from "@/modules/experiences/evidence";
import { getTrack } from "@/modules/tracks/repo";
import { applyToPosting, getPosting } from "./repo";
import { scorePosting, usableOf } from "./score";

// 지원으로 정하면서 그때의 점수를 남긴다. 점수는 브라우저에서 받지 않고,
// 지금의 트랙 배점과 지금 쓸 수 있는 경험으로 서버가 다시 계산한다.
export async function applyWithCurrentScore(
  db: Db,
  userId: string,
  id: string,
  now: Date = new Date(),
): Promise<{ ok: true } | { ok: false; reason: "not_found" | "no_analysis" | "changed" }> {
  const posting = await getPosting(db, userId, id);
  if (!posting) return { ok: false, reason: "not_found" };
  // 이미 지원했으면 그때 남긴 점수를 덮어쓰지 않는다(예전 화면이 남은 다른 탭에서 다시 눌러도 그대로)
  if (posting.status === "apply") return { ok: true };
  // 지원은 점수를 본 뒤에만 고른다
  if (!posting.analysis) return { ok: false, reason: "no_analysis" };
  const track = await getTrack(db, userId, posting.trackId);
  if (!track) return { ok: false, reason: "not_found" };

  const candidates = await listEvidenceCandidates(db, userId, posting.trackId);
  const score = scorePosting({
    posting,
    track,
    analysis: posting.analysis,
    usable: usableOf(candidates),
  });
  const { rawText, companyNote, regions, careerType, minYears, analysis } = posting;
  // 점수를 계산한 공고 값이 그대로일 때만 남긴다(그사이 다른 탭에서 고쳤으면 changed)
  return applyToPosting(
    db,
    userId,
    id,
    { ...score, analyzedAt: analysis.analyzedAt, appliedAt: now.toISOString() },
    { rawText, companyNote, regions, careerType, minYears, analysis },
  );
}
