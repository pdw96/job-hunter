"use server";

import { db } from "@/db";
import { requireUser } from "@/lib/session";
import { listChildren, listJobsUnder, type NcsJob, type NcsNode, searchJobs } from "./repo";

// 설문 화면이 부르는 조회. 기준 데이터지만 로그인한 사람만 쓸 수 있다.

const isCode = (value: unknown, length: number): value is string =>
  typeof value === "string" && new RegExp(`^\\d{${length}}$`).test(value);

export async function listMiddlesAction(majorCode: string): Promise<NcsNode[]> {
  await requireUser();
  return isCode(majorCode, 2) ? listChildren(db, majorCode) : [];
}

export async function listJobsUnderAction(middleCode: string): Promise<{ group: NcsNode; jobs: NcsNode[] }[]> {
  await requireUser();
  return isCode(middleCode, 4) ? listJobsUnder(db, middleCode) : [];
}

export async function searchJobsAction(query: string): Promise<NcsJob[]> {
  await requireUser();
  return typeof query === "string" && query.length <= 50 ? searchJobs(db, query, 20) : [];
}
