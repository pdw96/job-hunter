import { readFileSync } from "node:fs";
import { beforeAll, expect, test } from "vitest";
import { createTestDb } from "@/db/test-db";
import type { Db } from "@/db/types";
import { getJobs, listChildren, listJobsUnder, listMajors, searchJobs } from "./repo";

let db: Db;

// 기준 데이터는 읽기만 하므로 DB 하나를 같이 쓴다
beforeAll(async () => {
  db = await createTestDb();
});

test("대분류는 24개이고 첫 번째는 사업관리다", async () => {
  const majors = await listMajors(db);
  expect(majors).toHaveLength(24);
  expect(majors[0]).toEqual({ code: "01", level: 1, name: "사업관리" });
});

test("대분류 아래의 중분류를 코드 순으로 준다", async () => {
  const middles = await listChildren(db, "02");
  expect(middles.map((m) => m.code)).toEqual(["0201", "0202", "0203", "0204"]);
});

test("중분류 아래의 직무를 소분류별로 묶어 준다", async () => {
  const groups = await listJobsUnder(db, "0201");
  const first = groups[0];
  expect(first.group).toEqual({ code: "020101", level: 3, name: "경영기획" });
  expect(first.jobs.map((j) => j.name)).toContain("경영기획");
  expect(groups.every((g) => g.jobs.every((j) => j.code.startsWith(g.group.code)))).toBe(true);
});

test("이름으로 검색하면 상위 분류 경로가 함께 온다", async () => {
  const [first] = await searchJobs(db, "경영기획");
  expect(first.code).toBe("02010101");
  expect(first.path.map((p) => p.code)).toEqual(["02", "0201", "020101"]);
});

test("별칭으로도 검색된다", async () => {
  const codes = (await searchJobs(db, "백엔드")).map((j) => j.code);
  expect(codes).toContain("20010202");
});

test("영문 대소문자를 구분하지 않는다", async () => {
  const names = (await searchJobs(db, "sw")).map((j) => j.name);
  expect(names).toContain("SW제품기획");
  expect((await searchJobs(db, "devops")).map((j) => j.code)).toContain("20010203");
});

test("별칭이 정확히 일치하는 직무가 맨 앞에 온다", async () => {
  const [first] = await searchJobs(db, "인프라");
  expect(first.code).toBe("20010203");
});

test("2글자 미만이거나 기호뿐인 검색어는 결과가 없다", async () => {
  expect(await searchJobs(db, "기")).toEqual([]);
  expect(await searchJobs(db, "  ")).toEqual([]);
  expect(await searchJobs(db, "%")).toEqual([]);
  expect(await searchJobs(db, "%%")).toEqual([]);
  expect(await searchJobs(db, "__")).toEqual([]);
});

test("이름이 같은 직무는 경로가 다른 결과로 따로 나온다", async () => {
  const hits = (await searchJobs(db, "직업상담")).filter((j) => j.name === "직업상담");
  expect(hits).toHaveLength(2);
  expect(hits[0].path[2].code).not.toBe(hits[1].path[2].code);
});

test("결과 수를 제한한다", async () => {
  expect(await searchJobs(db, "관리", 5)).toHaveLength(5);
});

test("getJobs는 세분류로 존재하는 코드만 돌려준다", async () => {
  const jobs = await getJobs(db, ["02010101", "0201", "99999999"]);
  expect(jobs.map((j) => j.code)).toEqual(["02010101"]);
});

test("별칭 파일의 모든 코드는 세분류로 존재한다", async () => {
  const lines = readFileSync("data/ncs/aliases.csv", "utf8").trim().split("\n").slice(1);
  const codes = [...new Set(lines.map((line) => line.split(",")[1]))];
  expect((await getJobs(db, codes)).length).toBe(codes.length);
});
