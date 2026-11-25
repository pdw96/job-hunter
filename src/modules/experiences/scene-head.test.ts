import { beforeEach, expect, test } from "vitest";
import { createTestDb } from "@/db/test-db";
import type { Db } from "@/db/types";
import { user } from "@/modules/auth/schema";
import { createFact } from "./facts-repo";
import type { CourseInput, EducationInput } from "./record-input";
import { coursePeriod, educationPeriod, loadHead } from "./scene-head";

let db: Db;

const school: EducationInput = {
  schoolName: "가나대",
  location: "서울",
  degree: "bachelor",
  major: "컴퓨터공학",
  startMonth: "2022-03",
  endMonth: null,
  status: "enrolled",
  gpa: "4.0",
  gpaScale: "4.5",
};
const course: CourseInput = { name: "백엔드 부트캠프", institution: "다라캠프", startMonth: "2024-01", endMonth: null, hours: 100, learned: "서버" };

beforeEach(async () => {
  db = await createTestDb();
  await db.insert(user).values({ id: "u1", name: "A", email: "u1@example.com" });
});

test("학교 머리의 이름 칸과 기간", async () => {
  const f = await createFact(db, "u1", "education", school);
  if (!f.ok) throw new Error("education");
  const head = await loadHead(db, "u1", { kind: "education", id: f.id });
  expect(head?.labels).toEqual([["학교", "가나대"], ["전공", "컴퓨터공학"], ["학위", "학사"]]);
  expect(head?.period).toEqual({ startMonth: "2022-03", endMonth: null, isOngoing: true });
  expect(head?.isConfirmed).toBe(false);
});

test("교육 과정 머리는 끝 월이 없으면 진행 중", async () => {
  const f = await createFact(db, "u1", "course", course);
  if (!f.ok) throw new Error("course");
  const head = await loadHead(db, "u1", { kind: "course", id: f.id });
  expect(head?.labels).toEqual([["과정", "백엔드 부트캠프"], ["기관", "다라캠프"]]);
  expect(head?.period.isOngoing).toBe(true);
});

test("남의 학교·교육 과정이나 없는 id는 못 읽는다", async () => {
  await db.insert(user).values({ id: "u2", name: "B", email: "u2@example.com" });
  const f = await createFact(db, "u2", "education", school);
  if (!f.ok) throw new Error("education");
  expect(await loadHead(db, "u1", { kind: "education", id: f.id })).toBeFalsy();
  expect(await loadHead(db, "u1", { kind: "course", id: "없는-id" })).toBeFalsy();
});

test("기간 규칙: 학교는 재학·휴학(졸업 예정은 끝 월이 없을 때만) 진행 중, 교육 과정은 시작만 있고 끝이 없을 때", () => {
  for (const [status, on] of [["enrolled", true], ["leave", true], ["graduated", false], ["expected", true], ["completed", false], ["dropped", false]] as const) {
    expect(educationPeriod({ ...school, status }).isOngoing).toBe(on);
  }
  expect(coursePeriod({ ...course, endMonth: "2024-06" }).isOngoing).toBe(false);
  expect(coursePeriod({ ...course, startMonth: null }).isOngoing).toBe(false);
  expect(coursePeriod(course)).toEqual({ startMonth: "2024-01", endMonth: null, isOngoing: true });
});

test("졸업 예정이고 끝 월이 없는 학교는 진행 중", () => {
  expect(educationPeriod({ ...school, status: "expected", endMonth: null }).isOngoing).toBe(true);
});

test("졸업 예정이라도 끝 월이 있으면 진행 중이 아니다", () => {
  expect(educationPeriod({ ...school, status: "expected", endMonth: "2026-02" }).isOngoing).toBe(false);
});
