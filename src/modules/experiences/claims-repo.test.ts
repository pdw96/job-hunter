import { eq } from "drizzle-orm";
import { beforeEach, expect, test } from "vitest";
import { createTestDb } from "@/db/test-db";
import type { Db } from "@/db/types";
import { user } from "@/modules/auth/schema";
import { findClaims } from "./claims";
import { answerClaim, countOpenClaims, insertClaims, listClaims } from "./claims-repo";
import type { ExperienceInput } from "./input";
import { confirmExperience, createExperience, deleteExperience, getExperience, updateExperience } from "./repo";
import { claims } from "./schema";

let db: Db;

const imported: ExperienceInput = {
  name: "결제 시스템 개편",
  kind: "school", // 기간만 필수라 AI 판정 없이 확인됨까지 갈 수 있다
  organization: "가나다 주식회사",
  role: null,
  startMonth: "2023-03",
  endMonth: "2023-11",
  isOngoing: false,
  situation: "기존 결제 모듈의 장애가 잦았다.",
  actions: "결제 승인 API 개선 프로젝트를 주도했다.",
  result: "장애가 80% 감소했다.",
  metrics: [{ text: "월 장애 5건에서 1건", basis: null }],
  notDone: null,
  bannedPhrases: [],
  evidenceNote: null,
  tags: [],
};

// 가져온 기록 하나와 그 주장들을 만든다
async function importOne(userId = "u1", input = imported) {
  const id = await createExperience(db, userId, input, "import");
  await insertClaims(db, id, findClaims(input));
  return id;
}

const byQuote = async (id: string, part: string, userId = "u1") => {
  const found = (await listClaims(db, userId, id)).find((claim) => claim.quote.includes(part));
  if (!found) throw new Error(`주장 없음: ${part}`);
  return found;
};

beforeEach(async () => {
  db = await createTestDb();
  await db.insert(user).values([
    { id: "u1", name: "A", email: "u1@example.com" },
    { id: "u2", name: "B", email: "u2@example.com" },
  ]);
});

test("가져온 기록에는 기간·수치·역할 주장이 대기 상태로 생긴다", async () => {
  const id = await importOne();
  const list = await listClaims(db, "u1", id);
  expect(list.map((claim) => [claim.kind, claim.status])).toEqual([
    ["period", "pending"],
    ["metric", "pending"],
    ["metric", "pending"],
    ["role", "pending"],
  ]);
  expect(await countOpenClaims(db, "u1")).toEqual({ [id]: 4 });
});

test("열린 주장이 있으면 확인이 거부되고, 모두 닫으면 확인된다", async () => {
  const id = await importOne();
  expect(await confirmExperience(db, "u1", id)).toEqual({ ok: false, reason: "claims_pending" });
  expect((await getExperience(db, "u1", id))?.state).toBe("unconfirmed");

  for (const claim of await listClaims(db, "u1", id)) {
    expect(await answerClaim(db, "u1", claim.id, "confirm")).toEqual({ ok: true, status: "confirmed" });
  }
  expect(await confirmExperience(db, "u1", id)).toEqual({ ok: true });
  expect((await getExperience(db, "u1", id))?.state).toBe("confirmed");
  expect(await countOpenClaims(db, "u1")).toEqual({});
});

test("수치 칸의 줄에서 숫자 모름을 누르면 그 줄이 지워지고 닫힌다", async () => {
  const id = await importOne();
  const claim = await byQuote(id, "5건에서 1건");
  expect(await answerClaim(db, "u1", claim.id, "unknown")).toEqual({ ok: true, status: "removed" });
  expect((await getExperience(db, "u1", id))?.metrics).toEqual([]);
});

test("본문 속 숫자에서 숫자 모름을 누르면 고쳐야 할 것으로 남는다", async () => {
  const id = await importOne();
  const claim = await byQuote(id, "80%");
  expect(await answerClaim(db, "u1", claim.id, "unknown")).toEqual({ ok: true, status: "needs_fix" });
  expect((await getExperience(db, "u1", id))?.result).toBe("장애가 80% 감소했다.");
  expect(await confirmExperience(db, "u1", id)).toEqual({ ok: false, reason: "claims_pending" });
});

test("과장임을 누르면 그 낱말이 금지 표현에 들어가고 고쳐야 할 것으로 남는다", async () => {
  const id = await importOne();
  const claim = await byQuote(id, "주도했다");
  expect(await answerClaim(db, "u1", claim.id, "exaggerated")).toEqual({ ok: true, status: "needs_fix" });
  expect((await getExperience(db, "u1", id))?.bannedPhrases).toEqual(["주도"]);
});

test("종류에 맞지 않는 답과 이미 닫힌 주장에 대한 답은 거부한다", async () => {
  const id = await importOne();
  const period = await byQuote(id, "2023-03");
  const role = await byQuote(id, "주도했다");
  const notAllowed = { ok: false, reason: "not_allowed" };
  expect(await answerClaim(db, "u1", period.id, "unknown")).toEqual(notAllowed);
  expect(await answerClaim(db, "u1", period.id, "exaggerated")).toEqual(notAllowed);
  expect(await answerClaim(db, "u1", role.id, "unknown")).toEqual(notAllowed);
  await answerClaim(db, "u1", role.id, "confirm");
  expect(await answerClaim(db, "u1", role.id, "wrong")).toEqual(notAllowed);
});

test("고쳐야 하는 구절을 본문에서 지워 저장하면 닫히고 확인할 수 있게 된다", async () => {
  const id = await importOne();
  for (const claim of await listClaims(db, "u1", id)) {
    await answerClaim(db, "u1", claim.id, claim.kind === "role" ? "exaggerated" : "confirm");
  }
  expect(await confirmExperience(db, "u1", id)).toEqual({ ok: false, reason: "claims_pending" });

  const fixed = { ...imported, actions: "결제 승인 API를 구현했다.", bannedPhrases: ["주도"] };
  await updateExperience(db, "u1", id, fixed);
  expect((await byQuote(id, "주도했다")).status).toBe("fixed");
  expect(await confirmExperience(db, "u1", id)).toEqual({ ok: true });
});

test("기간이 틀렸다고 한 뒤 기간을 고치면 닫히고, 새 기간은 새로 묻는다", async () => {
  const id = await importOne();
  const period = await byQuote(id, "2023-03");
  await answerClaim(db, "u1", period.id, "wrong");
  await updateExperience(db, "u1", id, { ...imported, endMonth: "2023-12" });
  const list = (await listClaims(db, "u1", id)).filter((claim) => claim.kind === "period");
  expect(list.map((claim) => [claim.quote, claim.status])).toEqual([
    ["2023-03 ~ 2023-11", "fixed"],
    ["2023-03 ~ 2023-12", "pending"],
  ]);
});

test("본문에 새 숫자를 써 넣으면 새 대기 주장이 생기고, 확인한 주장은 유지된다", async () => {
  const id = await importOne();
  for (const claim of await listClaims(db, "u1", id)) await answerClaim(db, "u1", claim.id, "confirm");
  await updateExperience(db, "u1", id, { ...imported, result: "장애가 80% 감소했다. 응답 속도를 3배 높였다." });
  const list = await listClaims(db, "u1", id);
  expect(list.filter((claim) => claim.status === "confirmed")).toHaveLength(4);
  expect(list.filter((claim) => claim.status === "pending").map((claim) => claim.quote)).toEqual(["응답 속도를 3배 높였다."]);
});

test("직접 입력한 기록에는 주장이 생기지 않고, 고쳐도 생기지 않으며, 바로 확인할 수 있다", async () => {
  const id = await createExperience(db, "u1", imported);
  await updateExperience(db, "u1", id, { ...imported, result: "응답 속도를 3배 높였다." });
  expect(await listClaims(db, "u1", id)).toEqual([]);
  expect(await confirmExperience(db, "u1", id)).toEqual({ ok: true });
});

test("다른 사용자의 주장은 읽히지 않고 답할 수 없다", async () => {
  const id = await importOne();
  const claim = await byQuote(id, "80%");
  expect(await listClaims(db, "u2", id)).toEqual([]);
  expect(await answerClaim(db, "u2", claim.id, "confirm")).toEqual({ ok: false, reason: "not_found" });
  expect(await countOpenClaims(db, "u2")).toEqual({});
  expect((await byQuote(id, "80%")).status).toBe("pending");
});

test("기록을 지우면 주장도 지워진다", async () => {
  const id = await importOne();
  await deleteExperience(db, "u1", id);
  expect(await db.select().from(claims).where(eq(claims.experienceId, id))).toEqual([]);
});

test("수치 칸과 본문에 같은 구절이 있으면, 숫자 모름을 눌러도 본문에 남아 있는 동안은 닫히지 않는다", async () => {
  const id = await importOne("u1", { ...imported, metrics: [{ text: "장애가 80% 감소했다.", basis: null }] });
  const claim = await byQuote(id, "80%");
  expect(await answerClaim(db, "u1", claim.id, "unknown")).toEqual({ ok: true, status: "needs_fix" });
  expect((await getExperience(db, "u1", id))?.metrics).toEqual([]);
  expect(await confirmExperience(db, "u1", id)).toEqual({ ok: false, reason: "claims_pending" });
});
