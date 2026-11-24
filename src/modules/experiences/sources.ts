import { eq } from "drizzle-orm";
import type { Db } from "@/db/types";
import { type EvidenceCandidate, listEvidenceCandidates as listOldEvidence } from "./evidence";
import {
  type CareerItemSource,
  type CareerSource,
  listRecordCareerSources,
  listRecordEvidence,
  listRecordResumeSources,
  listSceneWritingSources,
  recordNames,
} from "./record-sources";
import { listExperiences } from "./repo";
import { experiences } from "./schema";
import { newRecordsOn } from "./switch";
import { listResumeSources as listOldResumeSources, listWritingSources as listOldWritingSources, type ResumeSource, type WritingSource } from "./writing";

// 자소서·이력서·채점·제출이 경험 원천을 읽는 한 곳. 스위치(newRecordsOn)가 켜져 있으면 새 표, 꺼져 있으면 옛 표를 읽는다

export type { CareerItemSource, CareerSource, EvidenceCandidate, ResumeSource, WritingSource };

export async function listWritingSources(db: Db, userId: string, trackId: string): Promise<WritingSource[]> {
  return newRecordsOn() ? listSceneWritingSources(db, userId, trackId) : listOldWritingSources(db, userId, trackId);
}

export async function listResumeSources(db: Db, userId: string, trackId: string): Promise<ResumeSource[]> {
  return newRecordsOn() ? listRecordResumeSources(db, userId, trackId) : listOldResumeSources(db, userId, trackId);
}

// 경력기술서는 새 표에만 있다(옛 표에는 경력 아래 항목이 없다)
export async function listCareerSources(db: Db, userId: string, trackId: string): Promise<CareerSource[]> {
  return listRecordCareerSources(db, userId, trackId);
}

export async function listEvidenceCandidates(db: Db, userId: string, trackId: string): Promise<EvidenceCandidate[]> {
  return newRecordsOn() ? listRecordEvidence(db, userId, trackId) : listOldEvidence(db, userId, trackId);
}

// 원천 id → 이름(제출본을 얼릴 때 쓴다). 스위치가 켜져 있어도 옛 기록 이름을 함께 담아,
// 아직 옛 기록을 가리키는 답이 "지운 경험"으로 얼려지지 않게 한다(겹치면 새 이름)
export async function sourceNames(db: Db, userId: string): Promise<Map<string, string>> {
  const legacy = await listExperiences(db, userId);
  const names = new Map(legacy.map((record) => [record.id, record.name]));
  if (!newRecordsOn()) return names;
  for (const [id, name] of await recordNames(db, userId)) names.set(id, name);
  return names;
}

// 옛 표(experiences_experiences)의 그 사용자 기록 id. 바꾼 뒤 답·이력서가 옛 기록을 가리키는지 볼 때 쓴다.
// 스위치가 꺼져 있으면 옛 기록이 지금의 원천이므로 빈 집합(DB를 읽지 않는다)
export async function oldRecordIds(db: Db, userId: string): Promise<Set<string>> {
  if (!newRecordsOn()) return new Set();
  const rows = await db.select({ id: experiences.id }).from(experiences).where(eq(experiences.userId, userId));
  return new Set(rows.map((row) => row.id));
}
