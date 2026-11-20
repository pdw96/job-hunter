import { beforeEach, expect, test } from "vitest";
import { createTestDb } from "@/db/test-db";
import type { Db } from "@/db/types";
import { user } from "@/modules/auth/schema";
import { createFact } from "./facts-repo";
import { recordHrefs } from "./record-href";
import { createExperience } from "./repo";
import type { JobInput } from "./record-input";
import { createScene } from "./scenes-repo";

let db: Db;
let schoolId: string;
let jobId: string;
let sceneId: string;
let theirJobId: string;

const job: JobInput = {
  company: "가나다상사",
  department: null,
  title: null,
  employment: "regular",
  startMonth: "2022-01",
  endMonth: null,
  isOngoing: true,
  duties: [],
  bannedPhrases: [],
};

beforeEach(async () => {
  db = await createTestDb();
  await db.insert(user).values([
    { id: "u1", name: "A", email: "u1@example.com" },
    { id: "u2", name: "B", email: "u2@example.com" },
  ]);
  const ok = (r: { ok: true; id: string } | { ok: false; reason: string }) => {
    if (!r.ok) throw new Error(r.reason);
    return r.id;
  };
  schoolId = ok(
    await createFact(db, "u1", "education", {
      schoolName: "한국대학교",
      location: null,
      degree: "bachelor",
      major: null,
      startMonth: "2016-03",
      endMonth: "2020-02",
      status: "graduated",
      gpa: null,
      gpaScale: null,
    }),
  );
  jobId = ok(await createFact(db, "u1", "job", job));
  theirJobId = ok(await createFact(db, "u2", "job", job));
  sceneId = ok(
    await createScene(db, "u1", {
      head: { kind: "job", id: jobId },
      title: "주문 조회 개선",
      startMonth: null,
      endMonth: null,
      isOngoing: false,
      situation: null,
      judgment: null,
      actions: "쿼리를 고쳤다",
      result: null,
      lessons: null,
      metrics: [],
      notDone: null,
      bannedPhrases: [],
      evidenceNote: null,
      tags: [],
    }),
  );
});

test("recordHrefs: 사례는 사례 화면, 이력 사실·머리는 그 메뉴의 화면으로 잇는다", async () => {
  const hrefs = await recordHrefs(db, "u1", [schoolId, jobId, sceneId]);
  expect(hrefs.get(sceneId)).toBe(`/records/scenes/${sceneId}`);
  expect(hrefs.get(schoolId)).toBe(`/records/facts/education/${schoolId}`);
  expect(hrefs.get(jobId)).toBe(`/records/facts/job/${jobId}`);
});

test("recordHrefs: 모르는 id(옛 기록)와 다른 사용자의 것은 잇지 않는다", async () => {
  const legacy = await createExperience(db, "u1", {
    name: "옛 기록",
    kind: "project",
    organization: null,
    role: null,
    startMonth: null,
    endMonth: null,
    isOngoing: false,
    situation: null,
    actions: null,
    result: null,
    metrics: [],
    notDone: null,
    bannedPhrases: [],
    evidenceNote: null,
    tags: [],
  });
  const hrefs = await recordHrefs(db, "u1", [legacy, theirJobId, "없는 id"]);
  expect(hrefs.size).toBe(0);
  expect((await recordHrefs(db, "u1", [])).size).toBe(0);
});
