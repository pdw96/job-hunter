import { eq } from "drizzle-orm";
import { beforeEach, expect, test } from "vitest";
import { createTestDb } from "@/db/test-db";
import type { Db } from "@/db/types";
import { createFakeAi } from "@/modules/ai/fake-client";
import { aiUsage } from "@/modules/ai/schema";
import { user } from "@/modules/auth/schema";
import type { ExperienceInput } from "@/modules/experiences/input";
import { confirmExperience, createExperience, setTrackScope } from "@/modules/experiences/repo";
import { experiences } from "@/modules/experiences/schema";
import type { AppliedScore, PostingAnalysis } from "@/modules/postings/analysis";
import { validatePosting } from "@/modules/postings/input";
import { applyToPosting, createPosting, getPosting, saveAnalysis } from "@/modules/postings/repo";
import { createTrack } from "@/modules/tracks/repo";
import type { SurveyInput } from "@/modules/tracks/survey";
import { RESUME_WRITE_SYSTEM } from "./prompts";
import { getCommonResume, getResume, saveResumeContent, saveTailoredContent } from "./resume-repo";
import { resumes } from "./schema";
import { rewriteEntries, startCommonResume, writeResumeLines } from "./resume-write";
import type { ResumeContent } from "./types";
import { listResumeSources } from "@/modules/experiences/writing";

let db: Db;
let trackId: string;
let otherTrack: string;
const now = new Date("2026-11-18T03:00:00Z");

const survey: SurveyInput = {
  name: "백엔드 개발",
  majorCode: "20",
  jobs: [{ ncsCode: "20010202", customName: null }],
  applicantType: "experienced",
  experienceMonths: 30,
  regions: ["seoul"],
  salaryMin: null,
  employmentTypes: ["regular"],
  importanceOrder: ["jobMatch", "location", "experience", "field", "preferred"],
  extraAnswers: {},
};
const rawText = `가나다 주식회사 백엔드 개발자 채용
자격 요건
- Java 실무 경력 3년 이상
문의 hr@ganada.example`;
const raw = {
  company: "가나다 주식회사",
  title: "백엔드 개발자",
  deadline: "2026-11-30",
  isRolling: false,
  locationText: "서울 강남구",
  regions: ["seoul"],
  careerType: "experienced",
  minYears: 3,
  employmentType: "regular",
  url: null,
  rawText,
  companyNote: "고객 문제를 끝까지 파고드는 사람",
};
const analysis: PostingAnalysis = {
  target: "개발",
  requirements: [{ kind: "required", text: "Java 실무 경력 3년 이상", quote: "Java 실무 경력 3년 이상", quoteFound: true, evidence: [] }],
  field: { level: "same_job", reason: "분야가 같다" },
  analyzedAt: "2026-11-18T00:00:00.000Z",
};
const score = { desire: 50, fit: 50, criteria: {}, analyzedAt: "2026-11-18T00:00:00.000Z", appliedAt: "2026-11-18T00:00:00.000Z" } as unknown as AppliedScore;

const job: ExperienceInput = {
  name: "결제 시스템 개편",
  kind: "project",
  organization: "라마바 주식회사",
  role: "백엔드 개발",
  startMonth: "2023-03",
  endMonth: "2023-11",
  isOngoing: false,
  situation: "결제 장애가 잦았다",
  actions: "Java로 결제 승인 API를 다시 설계했다",
  result: "장애가 줄었다",
  metrics: [{ text: "월 장애 57건에서 9건", basis: "사내 장애 보고서" }],
  notDone: "프론트엔드는 하지 않았다",
  bannedPhrases: ["혁신적인"],
  evidenceNote: "사내 보고서 링크 비밀메모",
  tags: [],
};

async function markConfirmed(id: string) {
  await db
    .update(experiences)
    .set({
      rubric: {
        period: { status: "met", note: null },
        role: { status: "met", note: null },
        level: { status: "met", note: null },
        metrics: { status: "met", note: null },
        evidence: { status: "unjudged", note: null },
      },
    })
    .where(eq(experiences.id, id));
  await confirmExperience(db, "u1", id);
}

async function addExperience(over: Partial<ExperienceInput> = {}, confirm = true) {
  const id = await createExperience(db, "u1", { ...job, ...over });
  if (confirm) await markConfirmed(id);
  return id;
}

async function addPosting(apply = true) {
  const checked = validatePosting(raw);
  if (!checked.ok) throw new Error("공고 입력 오류");
  const created = await createPosting(db, "u1", trackId, checked.value);
  if (!created.ok) throw new Error(created.reason);
  if (apply) {
    const saved = await saveAnalysis(db, "u1", created.id, analysis, { rawText, companyNote: raw.companyNote });
    if (!saved.ok) throw new Error(saved.reason);
    const posting = await getPosting(db, "u1", created.id);
    if (!posting) throw new Error("없음");
    const result = await applyToPosting(db, "u1", created.id, score, { ...posting, analysis });
    if (!result.ok) throw new Error(result.reason);
  }
  return created.id;
}

const reply = (...entries: [string, string[]][]) => ({ entries: entries.map(([exp, lines]) => ({ exp, lines })) });

beforeEach(async () => {
  delete process.env.AI_MONTHLY_LIMIT_USD;
  db = await createTestDb();
  await db.insert(user).values([
    { id: "u1", name: "홍길동", email: "u1@example.com" },
    { id: "u2", name: "김철수", email: "u2@example.com" },
  ]);
  const mine = await createTrack(db, "u1", survey);
  const theirs = await createTrack(db, "u2", survey);
  if (!mine.ok || !theirs.ok) throw new Error("트랙을 만들지 못함");
  trackId = mine.id;
  otherTrack = theirs.id;
});

// 시작 월이 늦은 것이 E1이다. 공통본을 만들어 둔다
async function commonWithTwo() {
  const a = await addExperience({ name: "경험A", startMonth: "2023-03" });
  const b = await addExperience({ name: "경험B", startMonth: "2022-03" });
  const ai = createFakeAi([reply(["E1", ["A 줄1", "A 줄2"]], ["E2", ["B 줄1"]])]);
  const made = await startCommonResume(db, ai, "u1", trackId, now);
  if (!made.ok) throw new Error(made.reason);
  const resume = await getResume(db, "u1", made.id);
  if (!resume?.content) throw new Error("내용 없음");
  return { a, b, id: made.id, resume };
}

test("AI에 보내는 글에 확인된 사용·요약만 경험의 별명과 분량이 있고, 제외·부분 확인 경험, 충족 아닌 수치, 증빙 메모, 이메일, 실제 id가 없다", async () => {
  const use = await addExperience({ name: "사용 경험", startMonth: "2023-03" });
  const summary = await addExperience({ name: "요약 경험", startMonth: "2022-03" });
  await setTrackScope(db, "u1", summary, trackId, "summary");
  const excluded = await addExperience({ name: "제외 경험", startMonth: "2021-03" });
  await setTrackScope(db, "u1", excluded, trackId, "exclude");
  const partial = await addExperience({ name: "부분 확인 경험", startMonth: "2020-03" }, false);
  const noMetric = await addExperience({ name: "수치 미달 경험", startMonth: "2019-03", metrics: [{ text: "미달수치 77건", basis: "기준" }] });
  await db
    .update(experiences)
    .set({ rubric: { period: { status: "met", note: null }, role: { status: "met", note: null }, level: { status: "met", note: null }, metrics: { status: "unmet", note: "x" }, evidence: { status: "unjudged", note: null } } })
    .where(eq(experiences.id, noMetric));
  await confirmExperience(db, "u1", noMetric);
  const ai = createFakeAi([reply(["E1", ["줄"]])]);

  const result = await startCommonResume(db, ai, "u1", trackId, now);

  expect(result.ok).toBe(true);
  const request = ai.requests[0];
  expect(request).toMatchObject({ purpose: "resume_write", effort: "medium", maxTokens: 16000 });
  expect(request.system).toBe(RESUME_WRITE_SYSTEM);
  const sent = request.messages[0].text;
  expect(sent).not.toContain("[공고]");
  expect(sent).toContain("[경험 기록]\nE1\n- 이름: 사용 경험");
  expect(sent).toContain("- 분량: 자세히(2~4줄)");
  expect(sent).toContain("- 이름: 요약 경험");
  expect(sent).toContain("- 분량: 요약(1~2줄)");
  expect(sent).not.toContain("공고에 맞춰 강조");
  expect(sent).toContain("수치: 월 장애 57건에서 9건 (기준: 사내 장애 보고서)");
  for (const hidden of ["제외 경험", "부분 확인 경험", "미달수치", "비밀메모", "u1@example.com", "홍길동", "E4"]) {
    expect(sent).not.toContain(hidden);
  }
  for (const secret of [use, summary, excluded, partial, noMetric, trackId, "u1"]) expect(sent).not.toContain(secret);
  expect((await db.select().from(aiUsage)).map((r) => r.purpose)).toEqual(["resume_write"]);
});

test("확인된 경험이 없으면 AI를 부르지 않고 no_sources", async () => {
  await addExperience({}, false);
  const ai = createFakeAi([reply(["E1", ["줄"]])]);
  expect(await startCommonResume(db, ai, "u1", trackId, now)).toEqual({ ok: false, reason: "no_sources" });
  expect(ai.requests.length).toBe(0);
  expect(await getCommonResume(db, "u1", trackId)).toBeNull();
});

test("줄은 자세히 4줄·요약 2줄로 자르고, 없는 별명은 버리고, 빠뜨린 경험은 빈 줄로 항목이 생긴다", async () => {
  const full = await addExperience({ name: "자세히", startMonth: "2023-03" });
  const summary = await addExperience({ name: "요약", startMonth: "2022-03" });
  await setTrackScope(db, "u1", summary, trackId, "summary");
  const skipped = await addExperience({ name: "빠뜨림", startMonth: "2021-03" });
  const ai = createFakeAi([
    reply(
      ["E1", ["- 1", "2", "3", "4", "5", "x".repeat(200)]],
      ["E2", ["a", "b", "c"]],
      ["E9", ["없는 별명"]],
      ["E1", ["같은 별명은 처음 것만"]],
    ),
  ]);

  const result = await startCommonResume(db, ai, "u1", trackId, now);

  if (!result.ok) throw new Error(result.reason);
  const content = (await getResume(db, "u1", result.id))?.content;
  const byId = new Map(content?.entries.map((e) => [e.experienceId, e]));
  expect(byId.get(full)?.lines.map((l) => l.text)).toEqual(["1", "2", "3", "4"]);
  expect(byId.get(full)?.detail).toBe("full");
  expect(byId.get(summary)?.lines.map((l) => l.text)).toEqual(["a", "b"]);
  expect(byId.get(summary)?.detail).toBe("summary");
  expect(byId.get(skipped)?.lines).toEqual([]);
  expect(content?.entries).toHaveLength(3);
  expect(content?.commonVersion).toBeNull();
  expect(byId.get(full)?.heading.name).toBe("자세히");
});

test("맞는 별명이 하나도 없으면 invalid이고 공통본이 생기지 않는다", async () => {
  await addExperience();
  const ai = createFakeAi([reply(["E9", ["줄"]])]);
  expect(await startCommonResume(db, ai, "u1", trackId, now)).toEqual({ ok: false, reason: "invalid" });
  expect(await getCommonResume(db, "u1", trackId)).toBeNull();
});

test("요청이 없으면 writeResumeLines는 AI를 부르지 않고 빈 값", async () => {
  const ai = createFakeAi([]);
  expect(await writeResumeLines(db, ai, "u1", { requests: [], posting: null }, now)).toEqual({ ok: true, value: {} });
  expect(ai.requests.length).toBe(0);
});

test("공통본이 이미 있으면 exists이고 AI를 부르지 않는다, 남의 트랙은 not_found", async () => {
  await commonWithTwo();
  const ai = createFakeAi([reply(["E1", ["줄"]])]);
  expect(await startCommonResume(db, ai, "u1", trackId, now)).toEqual({ ok: false, reason: "exists" });
  expect(await startCommonResume(db, ai, "u1", otherTrack, now)).toEqual({ ok: false, reason: "not_found" });
  expect(await startCommonResume(db, ai, "u2", trackId, now)).toEqual({ ok: false, reason: "not_found" });
  expect(ai.requests.length).toBe(0);
});

test("rewriteEntries는 고른 항목만 바꾸고 다른 항목의 줄(직접 고친 줄 포함)은 그대로", async () => {
  const { a, b, id, resume } = await commonWithTwo();
  // B의 줄은 직접 고친 것으로 만든다
  const edited: ResumeContent = {
    ...resume.content!,
    entries: resume.content!.entries.map((e) => (e.experienceId === b ? { ...e, lines: [{ text: "내가 고친 줄", edited: true }] } : e)),
  };
  const saved = await saveResumeContent(db, "u1", id, edited, resume.version);
  if (!saved.ok) throw new Error(saved.reason);
  const ai = createFakeAi([reply(["E1", ["새 A 줄"]])]);

  const result = await rewriteEntries(db, ai, "u1", id, [a], saved.version, now);

  if (!result.ok) throw new Error(result.reason);
  const byId = new Map(result.value.entries.map((e) => [e.experienceId, e]));
  expect(byId.get(a)?.lines).toEqual([{ text: "새 A 줄", edited: false }]);
  expect(byId.get(b)?.lines).toEqual([{ text: "내가 고친 줄", edited: true }]);
  expect(result.value.entries.map((e) => e.experienceId)).toEqual([a, b]);
  const stored = await getResume(db, "u1", id);
  expect(stored?.content).toEqual(result.value);
  expect(stored?.version).toBe(saved.version + 1);
  expect(ai.requests[0].messages[0].text).not.toContain("경험B");
});

test("새 경험은 그 섹션 끝에 들어간다", async () => {
  const { id, resume } = await commonWithTwo();
  const fresh = await addExperience({ name: "새 경험", startMonth: "2024-01" });
  const ai = createFakeAi([reply(["E1", ["새 줄"]])]);

  const result = await rewriteEntries(db, ai, "u1", id, [fresh], resume.version, now);

  if (!result.ok) throw new Error(result.reason);
  expect(result.value.entries.at(-1)?.experienceId).toBe(fresh);
  expect(result.value.entries.at(-1)?.detail).toBe("full");
  expect(result.value.entries).toHaveLength(3);
});

test("확인이 풀린 경험·남의 경험·없는 id만 보내면 none_selected이고 AI를 부르지 않는다", async () => {
  const { a, id, resume } = await commonWithTwo();
  await db.update(experiences).set({ confirmedAt: null }).where(eq(experiences.id, a));
  const theirs = await createExperience(db, "u2", job);
  const ai = createFakeAi([reply(["E1", ["줄"]])]);

  const result = await rewriteEntries(db, ai, "u1", id, [a, theirs, "없는-id"], resume.version, now);

  expect(result).toEqual({ ok: false, reason: "none_selected" });
  expect(ai.requests.length).toBe(0);
});

test("공통본에서 사용이 요약만으로 바뀐 항목을 다시 쓰면 요약 분량으로 보낸다", async () => {
  const { a, id, resume } = await commonWithTwo();
  await setTrackScope(db, "u1", a, trackId, "summary");
  const ai = createFakeAi([reply(["E1", ["1", "2", "3"]])]);

  const result = await rewriteEntries(db, ai, "u1", id, [a], resume.version, now);

  if (!result.ok) throw new Error(result.reason);
  expect(ai.requests[0].messages[0].text).toContain("- 분량: 요약(1~2줄)");
  const entry = result.value.entries.find((e) => e.experienceId === a);
  expect(entry?.detail).toBe("summary");
  expect(entry?.lines).toHaveLength(2);
});

test("AI가 쓰는 사이 다른 탭에서 줄을 고치면 changed이고 고친 줄이 남는다", async () => {
  const { a, id, resume } = await commonWithTwo();
  const other: ResumeContent = {
    ...resume.content!,
    entries: resume.content!.entries.map((e) => (e.experienceId === a ? { ...e, lines: [{ text: "다른 탭에서 고침", edited: true }] } : e)),
  };
  const ai = createFakeAi([
    async () => {
      const saved = await saveResumeContent(db, "u1", id, other, resume.version);
      expect(saved.ok).toBe(true);
      return reply(["E1", ["AI가 쓴 줄"]]);
    },
  ]);

  const result = await rewriteEntries(db, ai, "u1", id, [a], resume.version, now);

  expect(result).toEqual({ ok: false, reason: "changed" });
  const stored = await getResume(db, "u1", id);
  expect(stored?.content?.entries.find((e) => e.experienceId === a)?.lines).toEqual([{ text: "다른 탭에서 고침", edited: true }]);
});

test("expectedVersion이 다르면 AI를 부르지 않고 changed, 없는 이력서·남의 이력서는 not_found", async () => {
  const { a, id, resume } = await commonWithTwo();
  const ai = createFakeAi([reply(["E1", ["줄"]])]);
  expect(await rewriteEntries(db, ai, "u1", id, [a], resume.version + 1, now)).toEqual({ ok: false, reason: "changed" });
  expect(await rewriteEntries(db, ai, "u1", "없는-id", [a], 1, now)).toEqual({ ok: false, reason: "not_found" });
  expect(await rewriteEntries(db, ai, "u2", id, [a], resume.version, now)).toEqual({ ok: false, reason: "not_found" });
  expect(ai.requests.length).toBe(0);
});

test("맞춤본은 그 항목의 분량과 강조를 지키고, 강조한 항목이 있을 때만 공고를 보낸다", async () => {
  const { a, b, resume } = await commonWithTwo();
  const postingId = await addPosting();
  const content: ResumeContent = {
    commonVersion: resume.version,
    entries: resume.content!.entries.map((e) =>
      e.experienceId === a ? { ...e, emphasized: true, detail: "full" as const } : { ...e, detail: "summary" as const },
    ),
  };
  const saved = await saveTailoredContent(db, "u1", postingId, trackId, content, null);
  if (!saved.ok) throw new Error(saved.reason);
  const [row] = await db.select().from(resumes).where(eq(resumes.postingId, postingId));
  const tailored = await getResume(db, "u1", row.id);
  if (!tailored) throw new Error("없음");

  const ai = createFakeAi([reply(["E1", ["공고 맞춘 줄"]]), reply(["E1", ["요약 줄"]])]);
  const first = await rewriteEntries(db, ai, "u1", tailored.id, [a], tailored.version, now);
  if (!first.ok) throw new Error(first.reason);
  const sent = ai.requests[0].messages[0].text;
  expect(sent).toContain("[공고]\n가나다 주식회사 백엔드 개발자 채용");
  expect(sent).toContain("고객 문제를 끝까지 파고드는 사람");
  expect(sent).toContain("[공고 요구 사항]\nJava 실무 경력 3년 이상");
  expect(sent).toContain("- 공고에 맞춰 강조: 예");
  expect(first.value.entries.find((e) => e.experienceId === a)?.emphasized).toBe(true);

  const second = await rewriteEntries(db, ai, "u1", tailored.id, [b], tailored.version + 1, now);
  if (!second.ok) throw new Error(second.reason);
  const sent2 = ai.requests[1].messages[0].text;
  expect(sent2).not.toContain("[공고]");
  expect(sent2).toContain("- 분량: 요약(1~2줄)");
  expect(sent2).not.toContain("공고에 맞춰 강조");
});

test("맞춤본은 지원이 아닌 공고면 not_apply이고 AI를 부르지 않는다", async () => {
  const { a, resume } = await commonWithTwo();
  const postingId = await addPosting(false);
  const content: ResumeContent = { commonVersion: resume.version, entries: resume.content!.entries };
  await saveTailoredContent(db, "u1", postingId, trackId, content, null);
  const [row] = await db.select().from(resumes).where(eq(resumes.postingId, postingId));
  const ai = createFakeAi([reply(["E1", ["줄"]])]);
  expect(await rewriteEntries(db, ai, "u1", row.id, [a], row.version, now)).toEqual({ ok: false, reason: "not_apply" });
  expect(ai.requests.length).toBe(0);
});

test("refused·over_limit을 그대로 돌려주고 공통본은 생기지 않는다", async () => {
  await addExperience();
  expect(await startCommonResume(db, createFakeAi([{ fail: "refused" }]), "u1", trackId, now)).toEqual({ ok: false, reason: "refused" });
  process.env.AI_MONTHLY_LIMIT_USD = "0";
  const ai = createFakeAi([reply(["E1", ["줄"]])]);
  expect(await startCommonResume(db, ai, "u1", trackId, now)).toEqual({ ok: false, reason: "over_limit" });
  expect(ai.requests.length).toBe(0);
  expect(await getCommonResume(db, "u1", trackId)).toBeNull();
});

test("writeResumeLines는 요청의 별명을 경험 id로 바꿔 돌려준다", async () => {
  const id = await addExperience();
  const [source] = await listResumeSources(db, "u1", trackId);
  const ai = createFakeAi([reply(["E1", ["줄"]])]);
  const result = await writeResumeLines(db, ai, "u1", { requests: [{ source, detail: "full", emphasize: false }], posting: null }, now);
  expect(result).toEqual({ ok: true, value: { [id]: ["줄"] } });
});

test("새 항목은 40개까지만 받고(목록 순서대로) 있는 항목은 모두 다시 쓸 수 있다", async () => {
  const { a, id, resume } = await commonWithTwo();
  const fresh: string[] = [];
  for (let i = 0; i < 40; i++) fresh.push(await addExperience({ name: `새${i}`, startMonth: `2024-${String((i % 12) + 1).padStart(2, "0")}` }));
  const ai = createFakeAi([
    (req: { messages: { text: string }[] }) => {
      const sent = req.messages[0].text;
      const count = (sent.match(/^E\d+$/gm) ?? []).length;
      return { entries: Array.from({ length: count }, (_, i) => ({ exp: `E${i + 1}`, lines: ["줄"] })) };
    },
  ]);

  const result = await rewriteEntries(db, ai, "u1", id, [...fresh.reverse(), a], resume.version, now);

  if (!result.ok) throw new Error(result.reason);
  expect(result.value.entries).toHaveLength(40);
  const sent = ai.requests[0].messages[0].text;
  expect((sent.match(/^E\d+$/gm) ?? []).length).toBe(39); // 있는 A 하나 + 새 38개
  const listed = (await listResumeSources(db, "u1", trackId)).filter((s) => fresh.includes(s.id)).slice(0, 38).map((s) => s.id);
  const stored = new Set(result.value.entries.map((e) => e.experienceId));
  for (const f of listed) expect(stored.has(f)).toBe(true);

  // 자리가 없으면 새 경험만 보낼 때 full이고 AI를 부르지 않는다
  const left = fresh.find((f) => !stored.has(f));
  const again = createFakeAi([]);
  expect(await rewriteEntries(db, again, "u1", id, [left!], (await getResume(db, "u1", id))!.version, now)).toEqual({ ok: false, reason: "full" });
  expect(again.requests.length).toBe(0);
});

test("AI가 다시 쓰는 기존 항목의 별명을 빠뜨리면 그 항목은 그대로 둔다", async () => {
  const { a, b, id, resume } = await commonWithTwo();
  const edited: ResumeContent = {
    ...resume.content!,
    entries: resume.content!.entries.map((e) => (e.experienceId === a ? { ...e, lines: [{ text: "내가 고친 줄", edited: true }] } : e)),
  };
  const saved = await saveResumeContent(db, "u1", id, edited, resume.version);
  if (!saved.ok) throw new Error(saved.reason);
  const ai = createFakeAi([reply(["E2", ["B 새 줄"]])]); // E1(A)을 빠뜨림

  const result = await rewriteEntries(db, ai, "u1", id, [a, b], saved.version, now);

  if (!result.ok) throw new Error(result.reason);
  const byId = new Map(result.value.entries.map((e) => [e.experienceId, e]));
  expect(byId.get(a)?.lines).toEqual([{ text: "내가 고친 줄", edited: true }]);
  expect(byId.get(b)?.lines).toEqual([{ text: "B 새 줄", edited: false }]);
});
