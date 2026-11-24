"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { requireUser } from "@/lib/session";
import { companyKey } from "./company";
import { getPosting } from "./repo";
import { researchState } from "./research";
import { getResearch, setNewsChecked, setTalentVerdict } from "./research-repo";
import { scheduleResearch } from "./research-schedule";

// 회사 조사 액션. 모든 액션은 requireUser()로 얻은 userId만 쓰고, 회사 키는 브라우저에서 받지 않고 공고에서 만든다.
// 조사는 시간이 걸리므로 응답 뒤에 돌린다(scheduleResearch)

type Result = { ok: true } | { ok: false; message: string };

const MESSAGES = {
  not_found: "공고를 찾을 수 없습니다",
  not_apply_run: "지원으로 고른 공고에서만 조사할 수 있습니다",
  not_apply_pick: "지원으로 고른 공고에서만 고를 수 있습니다",
  no_company: "회사 이름이 없어 조사할 수 없습니다",
  running: "이미 조사 중입니다",
  running_pick: "조사 중에는 고를 수 없습니다",
  gone: "조사 결과를 찾을 수 없습니다. 화면을 새로 고쳐 주세요",
} as const;

const fail = (key: keyof typeof MESSAGES): Result => ({ ok: false, message: MESSAGES[key] });

function refresh(id: string) {
  revalidatePath(`/postings/${id}`);
  revalidatePath(`/postings/${id}/application`);
}

// 지원 공고의 회사를 공고에서 찾는다. 회사 이름 정리 값이 비면 조사할 수 없다
async function applyPosting(userId: string, postingId: unknown, notApply: keyof typeof MESSAGES) {
  if (typeof postingId !== "string") return { ok: false as const, result: fail("not_found") };
  const posting = await getPosting(db, userId, postingId);
  if (!posting) return { ok: false as const, result: fail("not_found") };
  if (posting.status !== "apply") return { ok: false as const, result: fail(notApply) };
  const key = companyKey(posting.company);
  if (!key) return { ok: false as const, result: fail("no_company") };
  return { ok: true as const, posting, key };
}

// 다시 조사(또는 처음 조사). AI는 응답 뒤에 돈다
export async function rerunResearchAction(postingId: string): Promise<Result> {
  const user = await requireUser();
  const found = await applyPosting(user.id, postingId, "not_apply_run");
  if (!found.ok) return found.result;
  // 진짜로 막는 것은 runResearch 안의 잡기다. 여기서는 단추가 알맞은 문구를 보이게 먼저 본다
  const research = await getResearch(db, user.id, found.key);
  if (researchState(research, new Date()) === "running") return fail("running");
  scheduleResearch(user.id, found.posting.id, { onlyIfMissing: false });
  refresh(found.posting.id);
  return { ok: true };
}

const pickResult = (result: { ok: true } | { ok: false; reason: "running" | "not_found" }): Result =>
  result.ok ? result : fail(result.reason === "running" ? "running_pick" : "gone");

// 인재상 맞음·아님. null은 미정(누른 단추를 다시 누름)
export async function setTalentVerdictAction(postingId: string, talentId: string, verdict: "yes" | "no" | null): Promise<Result> {
  const user = await requireUser();
  const found = await applyPosting(user.id, postingId, "not_apply_pick");
  if (!found.ok) return found.result;
  if (typeof talentId !== "string" || !(verdict === "yes" || verdict === "no" || verdict === null)) return fail("gone");
  const result = pickResult(await setTalentVerdict(db, user.id, found.key, talentId, verdict));
  if (result.ok) refresh(found.posting.id);
  return result;
}

// 소식 체크. 체크한 소식만 지원서에 쓴다
export async function setNewsCheckedAction(postingId: string, newsId: string, checked: boolean): Promise<Result> {
  const user = await requireUser();
  const found = await applyPosting(user.id, postingId, "not_apply_pick");
  if (!found.ok) return found.result;
  if (typeof newsId !== "string" || typeof checked !== "boolean") return fail("gone");
  const result = pickResult(await setNewsChecked(db, user.id, found.key, newsId, checked));
  if (result.ok) refresh(found.posting.id);
  return result;
}
