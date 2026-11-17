import { beforeEach, expect, test } from "vitest";
import { createTestDb } from "@/db/test-db";
import type { Db } from "@/db/types";
import { createFakeAi } from "@/modules/ai/fake-client";
import { aiUsage } from "@/modules/ai/schema";
import { user } from "@/modules/auth/schema";
import { transcribePosting, validateTiles } from "./read-image";

let db: Db;
const tile = { mediaType: "image/jpeg" as const, data: "QUJD" };

beforeEach(async () => {
  delete process.env.AI_MONTHLY_LIMIT_USD;
  db = await createTestDb();
  await db.insert(user).values({ id: "u1", name: "A", email: "u1@example.com" });
});

test("그림 조각의 형식과 크기를 검사한다", () => {
  expect(validateTiles([tile, { mediaType: "image/png", data: "QUJDRA==" }])).toMatchObject({ ok: true });
  expect(validateTiles([])).toEqual({ ok: false, reason: "invalid" });
  expect(validateTiles("x")).toEqual({ ok: false, reason: "invalid" });
  expect(validateTiles([{ mediaType: "image/svg+xml", data: "QUJD" }])).toEqual({ ok: false, reason: "invalid" });
  expect(validateTiles([{ mediaType: "image/png", data: "<script>" }])).toEqual({ ok: false, reason: "invalid" });
  expect(validateTiles(Array.from({ length: 11 }, () => tile))).toEqual({ ok: false, reason: "too_many" });
  expect(validateTiles([{ mediaType: "image/jpeg", data: "A".repeat(1_400_001) }])).toEqual({ ok: false, reason: "too_large" });
  expect(validateTiles(Array.from({ length: 4 }, () => ({ mediaType: "image/jpeg", data: "A".repeat(1_100_000) })))).toEqual({ ok: false, reason: "too_large" });
});

test("그림을 함께 보내 글로 옮기고, 사용량을 posting_image로 기록한다", async () => {
  const ai = createFakeAi([{ text: "가나다테크 백엔드 개발자 채용\n근무지: 서울\n접수 마감: 2026-11-30" }]);
  const result = await transcribePosting(db, ai, "u1", [tile, tile]);
  expect(result).toEqual({ ok: true, text: "가나다테크 백엔드 개발자 채용\n근무지: 서울\n접수 마감: 2026-11-30" });
  expect(ai.requests[0].messages[0].images).toHaveLength(2);
  expect((await db.select().from(aiUsage)).map((row) => row.purpose)).toEqual(["posting_image"]);
});

test("글자가 거의 없으면 공고가 아닌 그림으로 본다", async () => {
  expect(await transcribePosting(db, createFakeAi([{ text: "" }]), "u1", [tile])).toEqual({ ok: false, reason: "no_text" });
});

test("AI가 거절하면 실패를 돌려준다", async () => {
  expect(await transcribePosting(db, createFakeAi([{ fail: "refused" }]), "u1", [tile])).toEqual({ ok: false, reason: "refused" });
});
