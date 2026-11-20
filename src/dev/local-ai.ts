// 로컬 미리보기 전용 가짜 AI. 실제 API를 부르지 않고, 받은 글을 보고 그럴듯한 정해진 답을 돌려준다.
import type { AiClient, AiRequest, AiResult } from "@/modules/ai/client";
import { FAKE_MODEL, FAKE_USAGE } from "@/modules/ai/fake-client";

if (process.env.VERCEL) throw new Error("로컬 미리보기는 배포 환경에서 쓸 수 없습니다");

// "[이름]\n값" 형태로 적힌 기록에서 칸을 읽는다
function section(text: string, label: string): string {
  const match = text.match(new RegExp(`\\[${label}\\]\\n([\\s\\S]*?)(?=\\n\\n\\[|$)`));
  const value = match?.[1].trim() ?? "";
  return value === "없음" ? "" : value;
}

function judge(text: string) {
  const met = { status: "met", note: "" };
  const actions = section(text, "본인이 한 일");
  const notDone = section(text, "하지 않은 것");
  return {
    role: actions.length >= 15 ? met : { status: "unmet", note: "팀이 한 일과 구분해서, 본인이 직접 한 일을 알려 주세요." },
    level: notDone ? met : { status: "unmet", note: "어디까지 직접 했는지, 하지 않은 것은 무엇인지 알려 주세요." },
    metrics: met,
    evidence: section(text, "증빙·확인 메모") ? met : { status: "unmet", note: "이 경험을 뒷받침할 서류나 자료가 무엇인지 적어 주세요." },
    phraseCandidates: notDone ? ["단독으로 구축", "설계부터 운영까지"] : [],
  };
}

const QUESTIONS = [
  "그 일에서 본인이 직접 한 일은 무엇이었나요? 팀이 한 일과 나눠서 알려 주세요.",
  "언제부터 언제까지였나요? 그리고 하지 않은 일이 있다면 무엇인가요?",
  "결과는 어땠나요? 수치가 있다면 무엇을 기준으로 계산했는지도 알려 주세요.",
];

function interview(request: AiRequest<unknown>) {
  const answers = request.messages.slice(1).filter((message) => message.role === "user").length;
  if (answers === 0) {
    const context = request.messages[0].text;
    if (context.includes("보완하는 인터뷰")) return { message: QUESTIONS[1], enough: false };
    // 장면 인터뷰는 머리가 정해져 있으므로 그 안의 일 하나를 묻는다
    if (context.includes("[장면이 속한 곳]")) return { message: "이곳에서 겪은 일 중 하나를 골라 한두 문장으로 알려 주세요.", enough: false };
    return { message: "어떤 경험을 기록할까요? 한두 문장으로 알려 주세요.", enough: false };
  }
  return answers > QUESTIONS.length - 1
    ? { message: "충분히 들었습니다. 이제 기록으로 정리해도 좋겠습니다.", enough: true }
    : { message: QUESTIONS[answers], enough: false };
}

function extract(text: string) {
  const answers = [...text.matchAll(/^지원자: (.*)$/gm)].map((match) => match[1]);
  const existing = text.includes("[기존 기록]");
  return {
    name: existing ? section(text, "이름") : (answers[0] ?? "인터뷰 기록").slice(0, 30),
    kind: "project",
    organization: section(text, "소속·기관"),
    role: section(text, "직무·역할"),
    startMonth: "2023-03",
    endMonth: "2023-11",
    isOngoing: false,
    situation: section(text, "상황") || (answers[0] ?? ""),
    actions: [section(text, "본인이 한 일"), existing ? "" : (answers[1] ?? "")].filter(Boolean).join(" "),
    // 숫자 경고를 볼 수 있도록 대화에 없던 숫자를 일부러 넣는다
    result: `${section(text, "결과") || (answers[3] ?? "")} 처리 시간을 30% 단축했다`.trim(),
    metrics: [],
    notDone: section(text, "하지 않은 것") || (answers.at(-1) ?? ""),
    evidenceNote: section(text, "증빙·확인 메모"),
    tags: [],
  };
}

// 빈 줄로 나뉜 덩어리를 기록 하나로 본다
function importRecords(text: string) {
  const source = text.replace("[가져올 글]\n", "");
  // "# 제목"으로 시작하는 글(노션 묶음)은 통째로 기록 하나로 본다
  const blocks = /^# /.test(source) ? [source] : source.split(/\n\s*\n/).map((block) => block.trim()).filter(Boolean);
  return {
    records: blocks.slice(0, 12).map((block) => {
      const [title, ...rest] = block.split("\n");
      const period = block.match(/(\d{4})[.-](\d{1,2})\s*~\s*(\d{4})[.-](\d{1,2})/);
      const body = rest.join("\n").replace(/^## \[하위 페이지\].*$/gm, "").replace(/\n{2,}/g, "\n").trim().slice(0, 600);
      return {
        name: title.replace(/^# /, "").replace(/\(.*\)/, "").trim().slice(0, 60),
        kind: /대학교|고등학교/.test(title) ? "school" : "project",
        organization: "",
        role: "",
        startMonth: period ? `${period[1]}-${period[2].padStart(2, "0")}` : "",
        endMonth: period ? `${period[3]}-${period[4].padStart(2, "0")}` : "",
        isOngoing: false,
        situation: "",
        actions: body,
        result: "",
        metrics: [],
        notDone: "",
        evidenceNote: "",
        tags: [],
        roleClaims: body.includes("핵심 역할") ? ["핵심 역할을 수행했다"] : [],
        // "🚫 "표현"" 줄을 금지 표현으로 본다
        bannedPhrases: [...block.matchAll(/🚫\s*"([^"]+)"/g)].map((match) => match[1]),
      };
    }),
    more: blocks.length > 12,
  };
}

// 장면 정리 흉내. 대화의 첫 답을 상황과 한 일로 옮긴다. 보완이면 기존 장면의 칸을 이어 받는다
function extractScene(text: string) {
  const answers = [...text.matchAll(/^지원자: (.*)$/gm)].map((match) => match[1]);
  const existing = text.includes("[기존 장면]");
  const first = answers[0] ?? "";
  return {
    title: existing ? section(text, "장면 제목") : first.slice(0, 30) || "인터뷰 사례",
    startMonth: "",
    endMonth: "",
    isOngoing: false,
    situation: section(text, "상황") || first,
    judgment: section(text, "판단"),
    actions: [section(text, "본인이 한 일"), answers[1] ?? first].filter(Boolean).join(" "),
    // 숫자 경고를 볼 수 있도록 대화에 없던 숫자를 일부러 넣는다
    result: `${section(text, "결과")} 처리 시간을 30% 단축했다`.trim(),
    lessons: section(text, "배운 점"),
    metrics: [],
    notDone: section(text, "하지 않은 것") || (answers.length > 2 ? (answers.at(-1) ?? "") : ""),
    evidenceNote: section(text, "증빙·확인 메모"),
    tags: [],
  };
}

// 새 구조 가져오기 흉내. 학교 이름이 든 줄로 학력 하나를, 다른 첫 줄로 경력 하나와 그 아래 장면 하나를 만든다
function importNewRecords(text: string) {
  const source = text.slice(text.indexOf("[가져올 글]\n") + "[가져올 글]\n".length);
  const lines = source.split("\n").map((line) => line.trim()).filter((line) => line !== "" && !/^\[.*\]$/.test(line) && !/^#+\s*$/.test(line));
  const monthsOf = (line: string) => {
    const found = line.match(/(\d{4})[.-](\d{1,2})\s*~\s*(\d{4})[.-](\d{1,2})/);
    return found
      ? { startMonth: `${found[1]}-${found[2].padStart(2, "0")}`, endMonth: `${found[3]}-${found[4].padStart(2, "0")}` }
      : { startMonth: "", endMonth: "" };
  };
  const schoolLine = lines.find((line) => /대학교|고등학교|대학/.test(line));
  const jobIndex = lines.findIndex((line) => line !== schoolLine);
  const jobLine = jobIndex >= 0 ? lines[jobIndex] : "";
  const body = lines.slice(jobIndex + 1).filter((line) => line !== schoolLine).map((line) => line.replace(/^[-•·*]\s*/, ""));
  const school = schoolLine?.match(/\S*(대학교|고등학교|대학)/)?.[0] ?? "";
  const company = jobLine.replace(/^#\s*/, "").split(/\s*[|(]\s*|\s+\d{4}/)[0].trim().slice(0, 60);
  const blankScene = { startMonth: "", endMonth: "", isOngoing: false, situation: "", judgment: "", result: "", lessons: "", metrics: [], notDone: "", evidenceNote: "", tags: [], roleClaims: [] };
  return {
    education: school
      ? [{ schoolName: school, location: "", degree: /고등학교/.test(school) ? "high" : "bachelor", major: "", ...monthsOf(schoolLine ?? ""), status: "graduated", gpa: "", gpaScale: "" }]
      : [],
    courses: [],
    credentials: [],
    gaps: [],
    jobs: company
      ? [
          {
            company,
            department: "",
            title: "",
            employment: "regular",
            ...monthsOf(jobLine),
            isOngoing: false,
            duties: body.slice(0, 2).map((line) => line.slice(0, 100)),
            bannedPhrases: [...source.matchAll(/🚫\s*"([^"]+)"/g)].map((match) => match[1]),
            roleClaims: [],
            scenes: body.length > 0 ? [{ ...blankScene, title: body[0].slice(0, 40), actions: body.join("\n").slice(0, 600), bannedPhrases: [] }] : [],
          },
        ]
      : [],
    projects: [],
    activities: [],
    more: false,
  };
}

// 공고 원문에서 값을 뽑는 흉내. 첫 줄을 "회사명 직무명"으로 보고, 눈에 띄는 낱말로 나머지를 채운다
function posting(text: string) {
  const source = text.replace(/^오늘 날짜: .*\n\n\[공고 원문\]\n/, "");
  const [first = ""] = source.split("\n");
  const [company = "", ...rest] = first.trim().split(/\s+/);
  const deadline = source.match(/마감[^\d]{0,6}(\d{4})[.-](\d{1,2})[.-](\d{1,2})/);
  const years = source.match(/경력\s*(\d+)\s*년/);
  const where = source.match(/근무지\s*[:：]\s*(.+)/);
  const regions = [
    ["seoul", "서울"],
    ["gyeonggi", "경기"],
    ["busan", "부산"],
    ["daejeon", "대전"],
  ].flatMap(([id, label]) => (where?.[1].includes(label) ? [id] : []));
  return {
    company,
    title: rest.join(" ").replace(/\s*(채용|모집).*$/, ""),
    deadline: deadline ? `${deadline[1]}-${deadline[2].padStart(2, "0")}-${deadline[3].padStart(2, "0")}` : "",
    isRolling: /상시 채용|채용 시 마감/.test(source),
    locationText: where?.[1].trim() ?? "",
    regions,
    careerType: years ? "experienced" : /신입/.test(source) ? "new" : "any",
    minYears: years ? Number(years[1]) : -1,
    employmentType: /정규직/.test(source) ? "regular" : /계약직/.test(source) ? "contract" : /인턴/.test(source) ? "intern" : "unknown",
    hasDetails: /담당 업무|자격 요건|근무지|경력|정규직|채용 시 마감|영업/.test(source),
  };
}

// [label] 칸을 다음 칸 [next] 앞까지 읽는다. 공고 원문 안의 "[자격요건]" 같은 제목에서 끊기지 않게 다음 칸 이름을 정해 둔다
function sectionUntil(text: string, label: string, next: string): string {
  const start = text.indexOf(`[${label}]\n`);
  if (start < 0) return "";
  const from = start + label.length + 3;
  const end = text.indexOf(`\n\n[${next}]\n`, from);
  const value = text.slice(from, end < 0 ? undefined : end).trim();
  return value === "없음" ? "" : value;
}

// 공고의 요구 사항 뽑기 흉내. "자격 요건"·"[우대사항]" 같은 줄(또는 그 아래 줄)을 요구 사항으로 보고,
// 첫 경험(E1)이 있으면 첫 요구 사항의 근거로 짚는다
function postingMatch(text: string) {
  const source = [sectionUntil(text, "공고 원문", "인재상·회사 소개"), sectionUntil(text, "인재상·회사 소개", "경험 기록")].join("\n");
  const requirements: { kind: "required" | "preferred"; text: string; quote: string; evidence: unknown[] }[] = [];
  let kind: "required" | "preferred" | null = null;
  for (const line of source.split("\n").map((l) => l.trim()).filter(Boolean)) {
    const bullet = /^[-•·*]\s*/.test(line);
    const labeled = line.match(/^([^:：]{1,15})[:：]\s*(.*)$/);
    // "자격 요건", "[자격요건]", "우대 사항: …"처럼 짧은 줄이나 "이름: 값" 줄을 제목으로 본다
    if (!bullet && (labeled || line.length <= 15)) {
      const label = labeled?.[1] ?? line;
      kind = /자격\s*요건|필수/.test(label) ? "required" : /우대/.test(label) ? "preferred" : null;
      const rest = labeled?.[2].trim() ?? "";
      if (kind && rest) requirements.push({ kind, text: rest, quote: rest, evidence: [] });
    } else if (kind) {
      const item = line.replace(/^[-•·*]\s*/, "");
      requirements.push({ kind, text: item, quote: item, evidence: [] });
    }
  }
  if (requirements[0] && /^E1$/m.test(section(text, "경험 기록"))) {
    requirements[0].evidence = [{ exp: "E1", level: "full", why: "공고의 요구 사항과 경험에서 본인이 한 일이 겹칩니다." }];
  }
  return { field: { level: "same_job", reason: "공고의 직무가 지원 직무와 같습니다." }, requirements };
}

// 문항에 쓸 경험 고르기 흉내. E1을 고르고, E2가 있으면 밀린 것으로 둔다
function applicationSelect(text: string) {
  const experiences = section(text, "경험 기록");
  const first = experiences.split(/\n\n(?=E\d+\n)/)[0] ?? "";
  const actions = first.match(/^- 본인이 한 일: (.*)$/m)?.[1] ?? "";
  const hasSecond = /^E2$/m.test(experiences);
  return {
    picks: /^E1$/m.test(experiences)
      ? [{ exp: "E1", overlap: "문항의 경험 요구와 겹칩니다", role: actions.split("\n")[0] === "없음" ? "" : actions.split("\n")[0] }]
      : [],
    passed: hasSecond ? [{ exp: "E2", whyNot: "문항과 겹치는 정도가 더 낮습니다" }] : [],
  };
}

// 답 쓰기 흉내. E1의 "본인이 한 일"과 "결과"로 두 문단을 쓴다
function applicationWrite(text: string) {
  const experiences = section(text, "경험 기록");
  const first = experiences.split(/\n\n(?=E\d+\n)/)[0] ?? "";
  const field = (label: string) => {
    const value = first.match(new RegExp(`^- ${label}: (.*)$`, "m"))?.[1] ?? "";
    return value === "없음" ? "" : value;
  };
  const paragraphs = [field("본인이 한 일"), field("결과")].filter(Boolean).map((line) => ({ text: line, sources: ["E1"] }));
  return { paragraphs, shortage: "" };
}

// 문단 고치기 흉내. 고칠 문단 끝에 "(고침)"을 붙인다
function applicationRevise(text: string) {
  return { text: `${section(text, "고칠 문단")} (고침)`, sources: ["E1"] };
}

// 이력서 줄 쓰기 흉내. 경험마다 "본인이 한 일" 첫 줄과(자세히면) "결과"를 줄로 쓴다
function resumeWrite(text: string) {
  const blocks = section(text, "경험 기록").split(/\n\n(?=E\d+\n)/).filter(Boolean);
  return {
    entries: blocks.map((block) => {
      const alias = block.split("\n")[0].trim();
      const field = (label: string) => {
        const value = block.match(new RegExp(`^- ${label}: (.*)$`, "m"))?.[1] ?? "";
        return value === "없음" ? "" : value;
      };
      const full = block.includes("- 분량: 자세히");
      return { exp: alias, lines: [field("본인이 한 일"), full ? field("결과") : ""].filter(Boolean) };
    }),
  };
}

// 이력서 강조 고르기 흉내. 후보가 있으면 E1을 고른다
function resumeEmphasis(text: string) {
  return { picks: /^E1$/m.test(section(text, "경험 기록")) ? [{ exp: "E1", why: "공고의 담당 업무와 겹칩니다" }] : [] };
}

export const ai: AiClient = {
  async complete<T>(request: AiRequest<T>): Promise<AiResult<T>> {
    await new Promise((resolve) => setTimeout(resolve, 400)); // 기다리는 화면을 볼 수 있게
    const text = request.messages.map((message) => message.text).join("\n");
    const answer =
      request.purpose === "judge"
        ? judge(text)
        : request.purpose === "interview"
          ? interview(request as AiRequest<unknown>)
          : request.purpose === "import"
            ? importRecords(text)
            : request.purpose === "import_records" || request.purpose === "migrate" // 옮기기는 Task 8에서 따로 채운다
              ? importNewRecords(text)
              : request.purpose === "extract_scene"
                ? extractScene(text)
            : request.purpose === "posting_image"
              ? { text: "그림상사 품질관리 담당자 채용\n경력 2년 이상, 정규직\n근무지: 대전 유성구\n접수 마감: 2026-12-10" }
              : request.purpose === "posting"
                ? posting(text)
                : request.purpose === "posting_match"
                  ? postingMatch(text)
                  : request.purpose === "application_select"
                    ? applicationSelect(text)
                    : request.purpose === "application_write"
                      ? applicationWrite(text)
                      : request.purpose === "application_revise"
                        ? applicationRevise(text)
                        : request.purpose === "resume_write"
                          ? resumeWrite(text)
                          : request.purpose === "resume_emphasis"
                            ? resumeEmphasis(text)
                            : extract(text);
    const parsed = request.schema.safeParse(answer);
    const meta = { usage: FAKE_USAGE, model: FAKE_MODEL };
    return parsed.success ? { ok: true, value: parsed.data, ...meta } : { ok: false, reason: "invalid", ...meta };
  },
};
