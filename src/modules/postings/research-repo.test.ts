import { beforeEach, expect, test } from "vitest";
import { createTestDb } from "@/db/test-db";
import type { Db } from "@/db/types";
import { user } from "@/modules/auth/schema";
import type { NewsItem, Talent } from "./research";
import {
  claimResearch,
  failResearch,
  finishResearch,
  getResearch,
  setNewsChecked,
  setTalentVerdict,
} from "./research-repo";

let db: Db;
const key = "gana";
const t0 = new Date("2026-11-24T00:00:00Z");
const min = (n: number) => new Date(t0.getTime() + n * 60_000);

const talent: Talent = { id: "t1", text: "도전", url: "https://g.com/t", title: "T", verdict: null };
const news: NewsItem[] = [{ id: "n1", summary: "소식", date: null, url: "https://x.com/a", title: "A", checked: false }];
const result = { talent, talentSkipped: false, news };

async function claim(at = t0, onlyIfMissing = false, userId = "u1") {
  return claimResearch(db, userId, key, "가나다", at, { onlyIfMissing });
}

beforeEach(async () => {
  db = await createTestDb();
  await db.insert(user).values([
    { id: "u1", name: "A", email: "u1@example.com" },
    { id: "u2", name: "B", email: "u2@example.com" },
  ]);
});

test("처음 잡으면 running 줄이 생기고 잡은 시각을 돌려준다", async () => {
  expect(await claim()).toEqual(t0);
  expect(await getResearch(db, "u1", key)).toMatchObject({
    company: "가나다",
    status: "running",
    researchedAt: null,
    talent: null,
    news: [],
    talentSkipped: false,
  });
});

test("onlyIfMissing은 줄이 있으면 잡지 않는다", async () => {
  expect(await claim(t0, true)).toEqual(t0);
  expect(await claim(min(10), true)).toBeNull();
  const [row] = [await getResearch(db, "u1", key)];
  expect(row?.startedAt).toEqual(t0);
});

test("running이면 다시 잡지 않는다", async () => {
  await claim();
  expect(await claim(min(4))).toBeNull();
});

test("5분 지난 running은 다시 잡는다", async () => {
  await claim();
  expect(await claim(min(6))).toEqual(min(6));
});

test("끝난 줄은 다시 잡을 수 있고, 지난 결과는 그대로 둔다", async () => {
  const s = await claim();
  await finishResearch(db, "u1", key, s!, result, min(1));
  expect(await claim(min(2))).toEqual(min(2));
  expect(await getResearch(db, "u1", key)).toMatchObject({ status: "running", talent, news });
});

test("동시에 두 번 잡아도 하나만 잡힌다", async () => {
  const [a, b] = await Promise.all([claim(t0), claim(t0)]);
  expect([a, b].filter((x) => x !== null)).toHaveLength(1);
  await finishResearch(db, "u1", key, t0, result, min(1));
  const [c, d] = await Promise.all([claim(min(2)), claim(min(2))]);
  expect([c, d].filter((x) => x !== null)).toHaveLength(1);
});

test("끝내면 결과가 저장되고 done이 된다", async () => {
  const s = await claim();
  expect(await finishResearch(db, "u1", key, s!, result, min(1))).toBe(true);
  expect(await getResearch(db, "u1", key)).toMatchObject({
    status: "done",
    failure: null,
    researchedAt: min(1),
    talent,
    news,
  });
});

test("잡은 started_at이 바뀌었으면 저장하지 않는다", async () => {
  const first = await claim();
  const second = await claim(min(6));
  expect(await finishResearch(db, "u1", key, first!, result, min(7))).toBe(false);
  expect(await failResearch(db, "u1", key, first!, "unavailable", min(7))).toBe(false);
  expect(await getResearch(db, "u1", key)).toMatchObject({ status: "running", startedAt: second, talent: null });
  expect(await finishResearch(db, "u1", key, second!, result, min(8))).toBe(true);
});

test("실패는 지난 결과를 지우지 않는다", async () => {
  const s = await claim();
  await finishResearch(db, "u1", key, s!, result, min(1));
  const s2 = await claim(min(2));
  expect(await failResearch(db, "u1", key, s2!, "over_limit", min(3))).toBe(true);
  expect(await getResearch(db, "u1", key)).toMatchObject({
    status: "failed",
    failure: "over_limit",
    researchedAt: min(1),
    talent,
    news,
  });
});

test("조사 중에는 맞음·체크가 running", async () => {
  const s = await claim();
  await finishResearch(db, "u1", key, s!, result, min(1));
  await claim(min(2));
  expect(await setTalentVerdict(db, "u1", key, "t1", "yes")).toEqual({ ok: false, reason: "running" });
  expect(await setNewsChecked(db, "u1", key, "n1", true)).toEqual({ ok: false, reason: "running" });
});

test("맞음·체크를 저장하고 되돌린다", async () => {
  const s = await claim();
  await finishResearch(db, "u1", key, s!, result, min(1));
  expect(await setTalentVerdict(db, "u1", key, "t1", "yes")).toEqual({ ok: true });
  expect(await setNewsChecked(db, "u1", key, "n1", true)).toEqual({ ok: true });
  expect(await getResearch(db, "u1", key)).toMatchObject({
    talent: { verdict: "yes" },
    news: [{ checked: true }],
  });
  await setTalentVerdict(db, "u1", key, "t1", null);
  expect((await getResearch(db, "u1", key))?.talent?.verdict).toBeNull();
});

test("없는 id는 not_found", async () => {
  const s = await claim();
  await finishResearch(db, "u1", key, s!, result, min(1));
  expect(await setTalentVerdict(db, "u1", key, "zzz", "yes")).toEqual({ ok: false, reason: "not_found" });
  expect(await setNewsChecked(db, "u1", key, "zzz", true)).toEqual({ ok: false, reason: "not_found" });
  expect(await setNewsChecked(db, "u1", "other-key", "n1", true)).toEqual({ ok: false, reason: "not_found" });
});

test("다른 사용자의 조사는 읽히지도 바뀌지도 않는다", async () => {
  const s = await claim();
  await finishResearch(db, "u1", key, s!, result, min(1));
  expect(await getResearch(db, "u2", key)).toBeNull();
  expect(await setTalentVerdict(db, "u2", key, "t1", "yes")).toEqual({ ok: false, reason: "not_found" });
  expect(await setNewsChecked(db, "u2", key, "n1", true)).toEqual({ ok: false, reason: "not_found" });
  expect(await finishResearch(db, "u2", key, s!, result, min(2))).toBe(false);
  expect(await failResearch(db, "u2", key, s!, "unavailable", min(2))).toBe(false);
  expect(await claim(min(2), false, "u2")).toEqual(min(2));
  expect(await getResearch(db, "u1", key)).toMatchObject({ status: "done", talent: { verdict: null } });
});
