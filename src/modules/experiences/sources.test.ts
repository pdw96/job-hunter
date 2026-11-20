import { beforeEach, expect, test } from "vitest";
import { createTestDb } from "@/db/test-db";
import type { Db } from "@/db/types";
import { user } from "@/modules/auth/schema";
import { createTrack } from "@/modules/tracks/repo";
import type { SurveyInput } from "@/modules/tracks/survey";
import { createFact } from "./facts-repo";
import type { ExperienceInput } from "./input";
import { confirmExperience, createExperience } from "./repo";
import { listEvidenceCandidates, listResumeSources, listWritingSources, oldRecordIds, sourceNames } from "./sources";

let db: Db;
let t1: string;
let oldId: string;
let newId: string;

const school: ExperienceInput = {
  name: "옛 한국대학교",
  kind: "school",
  organization: null,
  role: null,
  startMonth: "2015-03",
  endMonth: "2019-02",
  isOngoing: false,
  situation: null,
  actions: null,
  result: null,
  metrics: [],
  notDone: null,
  bannedPhrases: [],
  evidenceNote: null,
  tags: [],
};
const survey: SurveyInput = {
  name: "개발",
  majorCode: "20",
  jobs: [{ ncsCode: "20010202", customName: null }],
  applicantType: "new",
  experienceMonths: null,
  regions: ["seoul"],
  salaryMin: null,
  employmentTypes: ["regular"],
  importanceOrder: ["jobMatch", "location", "experience", "field", "preferred"],
  extraAnswers: {},
};

beforeEach(async () => {
  db = await createTestDb();
  await db.insert(user).values([
    { id: "u1", name: "A", email: "u1@example.com" },
    { id: "u2", name: "B", email: "u2@example.com" },
  ]);
  const track = await createTrack(db, "u1", survey);
  if (!track.ok) throw new Error(track.reason);
  t1 = track.id;
  // 옛 표의 확인된 학력 하나, 새 표의 확인된 학력 하나
  oldId = await createExperience(db, "u1", school);
  await confirmExperience(db, "u1", oldId);
  const created = await createFact(
    db,
    "u1",
    "education",
    { schoolName: "새 한국대학교", location: null, degree: "bachelor", major: null, startMonth: "2016-03", endMonth: "2020-02", status: "graduated", gpa: null, gpaScale: null },
    { confirmed: true },
  );
  if (!created.ok) throw new Error(created.reason);
  newId = created.id;
});

test("새 원천을 읽는다(스위치는 늘 켜져 있다)", async () => {
  expect((await listResumeSources(db, "u1", t1)).map((s) => s.id)).toEqual([newId]);
  expect((await listEvidenceCandidates(db, "u1", t1)).map((s) => s.id)).toEqual([newId]);
  expect(await listWritingSources(db, "u1", t1)).toEqual([]); // 새 자소서 원천은 장면만
  const names = await sourceNames(db, "u1");
  expect(names.get(newId)).toBe("새 한국대학교");
  // 옛 기록을 가리키는 답이 "지운 경험"으로 얼려지지 않도록 옛 이름도 담는다
  expect(names.get(oldId)).toBe("옛 한국대학교");
});

test("sourceNames: 남의 옛 기록 이름은 담지 않는다", async () => {
  const theirs = await createExperience(db, "u2", { ...school, name: "남의 옛 기록" });
  expect((await sourceNames(db, "u1")).has(theirs)).toBe(false);
});

test("oldRecordIds: 그 사용자의 옛 표 id(확인 여부 상관없이)", async () => {
  const draft = await createExperience(db, "u1", { ...school, name: "미확인 옛 기록" });
  const theirs = await createExperience(db, "u2", { ...school, name: "남의 옛 기록" });
  const ids = await oldRecordIds(db, "u1");
  expect([...ids].sort()).toEqual([oldId, draft].sort());
  expect(ids.has(theirs)).toBe(false);
  expect(ids.has(newId)).toBe(false);
});
