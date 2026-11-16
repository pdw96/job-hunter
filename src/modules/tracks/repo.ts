import { randomUUID } from "node:crypto";
import { and, asc, count, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db/types";
import { getJobs, isMajor } from "@/modules/ncs/repo";
import type { Criterion } from "./options";
import { trackJobs, tracks } from "./schema";
import { type SurveyInput, type SurveyJob, weightsFromOrder } from "./survey";

export type Track = SurveyInput & {
  id: string;
  weights: Record<Criterion, number>;
  createdAt: Date;
  updatedAt: Date;
};

type InvalidReason = "invalid_job" | "invalid_major";

// 분야와 NCS 직무 코드가 실제로 있는지 ncs 모듈에 물어본다
async function checkReferences(db: Db, input: SurveyInput): Promise<InvalidReason | null> {
  if (!(await isMajor(db, input.majorCode))) return "invalid_major";
  const codes = input.jobs.flatMap((job) => job.ncsCode ?? []);
  if ((await getJobs(db, codes)).length !== new Set(codes).size) return "invalid_job";
  return null;
}

function trackValues(input: SurveyInput) {
  return {
    name: input.name,
    majorCode: input.majorCode,
    applicantType: input.applicantType,
    experienceMonths: input.experienceMonths,
    regions: input.regions,
    salaryMin: input.salaryMin,
    employmentTypes: input.employmentTypes,
    importanceOrder: input.importanceOrder,
    weights: weightsFromOrder(input.importanceOrder),
    extraAnswers: input.extraAnswers,
  };
}

function jobRows(trackId: string, jobs: SurveyJob[]) {
  return jobs.map((job, position) => ({ id: randomUUID(), trackId, position, ...job }));
}

export async function createTrack(
  db: Db,
  userId: string,
  input: SurveyInput,
): Promise<{ ok: true; id: string } | { ok: false; reason: InvalidReason }> {
  const invalid = await checkReferences(db, input);
  if (invalid) return { ok: false, reason: invalid };

  const id = randomUUID();
  await db.transaction(async (tx) => {
    await tx.insert(tracks).values({ id, userId, ...trackValues(input) });
    await tx.insert(trackJobs).values(jobRows(id, input.jobs));
  });
  return { ok: true, id };
}

export async function updateTrack(
  db: Db,
  userId: string,
  trackId: string,
  input: SurveyInput,
): Promise<{ ok: true } | { ok: false; reason: "not_found" | InvalidReason }> {
  const invalid = await checkReferences(db, input);
  if (invalid) return { ok: false, reason: invalid };

  const found = await db.transaction(async (tx) => {
    const updated = await tx
      .update(tracks)
      .set({ ...trackValues(input), updatedAt: new Date() })
      .where(and(eq(tracks.id, trackId), eq(tracks.userId, userId)))
      .returning({ id: tracks.id });
    if (updated.length === 0) return false;
    // 직무 목록은 통째로 바꾼다
    await tx.delete(trackJobs).where(eq(trackJobs.trackId, trackId));
    await tx.insert(trackJobs).values(jobRows(trackId, input.jobs));
    return true;
  });
  return found ? { ok: true } : { ok: false, reason: "not_found" };
}

export async function getTrack(db: Db, userId: string, trackId: string): Promise<Track | null> {
  const [row] = await db
    .select()
    .from(tracks)
    .where(and(eq(tracks.id, trackId), eq(tracks.userId, userId)))
    .limit(1);
  if (!row) return null;

  const jobs = await db
    .select({ ncsCode: trackJobs.ncsCode, customName: trackJobs.customName })
    .from(trackJobs)
    .where(eq(trackJobs.trackId, row.id))
    .orderBy(asc(trackJobs.position));

  return {
    id: row.id,
    name: row.name,
    majorCode: row.majorCode,
    jobs,
    applicantType: row.applicantType,
    experienceMonths: row.experienceMonths,
    regions: row.regions,
    salaryMin: row.salaryMin,
    employmentTypes: row.employmentTypes,
    importanceOrder: row.importanceOrder,
    weights: row.weights,
    extraAnswers: row.extraAnswers,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function listTracks(
  db: Db,
  userId: string,
): Promise<{ id: string; name: string; jobNames: string[]; createdAt: Date }[]> {
  const rows = await db
    .select({ id: tracks.id, name: tracks.name, createdAt: tracks.createdAt })
    .from(tracks)
    .where(eq(tracks.userId, userId))
    .orderBy(asc(tracks.createdAt), asc(tracks.id));
  if (rows.length === 0) return [];

  const jobs = await db
    .select({ trackId: trackJobs.trackId, ncsCode: trackJobs.ncsCode, customName: trackJobs.customName })
    .from(trackJobs)
    .where(
      inArray(
        trackJobs.trackId,
        rows.map((r) => r.id),
      ),
    )
    .orderBy(asc(trackJobs.position));
  const ncsNames = new Map(
    (await getJobs(db, jobs.flatMap((j) => j.ncsCode ?? []))).map((job) => [job.code, job.name]),
  );

  return rows.map((row) => ({
    ...row,
    jobNames: jobs
      .filter((j) => j.trackId === row.id)
      .map((j) => j.customName ?? ncsNames.get(j.ncsCode ?? "") ?? ""),
  }));
}

export async function countTracks(db: Db, userId: string): Promise<number> {
  const [row] = await db.select({ value: count() }).from(tracks).where(eq(tracks.userId, userId));
  return row.value;
}

export async function listTrackIds(db: Db, userId: string): Promise<string[]> {
  const rows = await db
    .select({ id: tracks.id })
    .from(tracks)
    .where(eq(tracks.userId, userId))
    .orderBy(asc(tracks.createdAt), asc(tracks.id));
  return rows.map((row) => row.id);
}

// 그 트랙이 이 사용자의 것인지
export async function ownsTrack(db: Db, userId: string, trackId: string): Promise<boolean> {
  const rows = await db
    .select({ id: tracks.id })
    .from(tracks)
    .where(and(eq(tracks.id, trackId), eq(tracks.userId, userId)))
    .limit(1);
  return rows.length > 0;
}
