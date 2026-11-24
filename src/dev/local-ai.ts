// 로컬 미리보기 전용 가짜 AI. 실제 API를 부르지 않고, 받은 글을 보고 그럴듯한 정해진 답을 돌려준다.
import type { AiClient, AiRequest, AiResult, WebSource } from "@/modules/ai/client";
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

// 옮기기 전 정리 흉내: 구분과 이름이 같은 기록은 앞의 것의 duplicate, 나머지는 구분별 기본값(학력·교육·자격·공백은 fact, 그 밖은 head)
function classifyOld(text: string) {
  const firsts = new Map<string, string>();
  const records = [...text.matchAll(/^(R\d+) \| 이름: (.*?) \| 구분: (.*?) \|/gm)].map(([, record, name, kind]) => {
    const key = `${kind}:${name}`;
    const first = firsts.get(key);
    if (first) return { record, role: "duplicate", ref: first };
    firsts.set(key, record);
    return { record, role: ["학력", "교육", "자격", "공백"].includes(kind) ? "fact" : "head", ref: null };
  });
  return { records };
}

// 옮기기 흉내. 첫 줄로 네 요청을 고른다: 나누기는 옛 기록 한 건(describeExperience 모양)을 그 구분의 메뉴 하나로,
// 주장은 고를 구절 없음, 소속은 짝 없음, 정리는 classifyOld
function migrate(text: string) {
  const first = text.split("\n")[0];
  if (first === "[옮기기: 주장]") return { quotes: [] };
  if (first === "[옮기기: 소속]") return { links: [] };
  if (first === "[옮기기: 정리]") return classifyOld(text);
  const source = text.slice(text.indexOf("[가져올 글]\n") + "[가져올 글]\n".length);
  const field = (label: string) => section(source, label);
  const [startMonth = "", endMonth = ""] = field("기간").split(/\s*~\s*/).map((month) => (/^\d{4}-\d{2}$/.test(month) ? month : ""));
  const name = field("이름").slice(0, 100);
  const kind = field("구분");
  const empty = { education: [], courses: [], credentials: [], gaps: [], jobs: [], projects: [], activities: [], more: false };
  if (kind === "학력") {
    return { ...empty, education: [{ schoolName: name, location: "", degree: "bachelor", major: "", startMonth, endMonth, status: "graduated", gpa: "", gpaScale: "" }] };
  }
  if (kind === "교육") return { ...empty, courses: [{ name, institution: field("소속·기관"), startMonth, endMonth, hours: "", learned: "" }] };
  if (kind === "자격") return { ...empty, credentials: [{ type: "license", name, issuer: field("소속·기관"), month: startMonth, score: "" }] };
  if (kind !== "재직") return importNewRecords(text);
  const actions = field("본인이 한 일");
  const blankScene = { startMonth: "", endMonth: "", isOngoing: false, situation: field("상황"), judgment: "", result: field("결과"), lessons: "", metrics: [], notDone: "", evidenceNote: "", tags: [], roleClaims: [], bannedPhrases: [] };
  return {
    ...empty,
    jobs: [
      {
        company: field("소속·기관") || name,
        department: "",
        title: field("직무·역할").slice(0, 100),
        employment: "regular",
        startMonth,
        endMonth,
        isOngoing: field("기간").includes("진행 중"),
        duties: [],
        bannedPhrases: [],
        roleClaims: [],
        scenes: actions ? [{ ...blankScene, title: name, actions }] : [],
      },
    ],
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
    // 원문에 "지원 동기"가 있으면 서류와 문항을 하나씩 찾은 것으로 흉내 낸다(원문에 있는 글만 문항으로 남는다)
    documents: /지원 동기/.test(source)
      ? [
          { kind: "resume", label: "이력서" },
          { kind: "cover_letter", label: "자기소개서" },
          { kind: "portfolio", label: "포트폴리오" },
        ]
      : [],
    questions: /지원 동기/.test(source) ? [{ prompt: "지원 동기를 쓰시오", charLimit: 500, countSpaces: false }] : [],
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
const KIND_BY_LABEL = { 경험형: "experience", 동기포부형: "motive", 자기소개형: "self" } as const;
function localKinds(text: string) {
  const given = section(text, "문항 유형")
    .split(",")
    .flatMap((label) => KIND_BY_LABEL[label.trim() as keyof typeof KIND_BY_LABEL] ?? []);
  if (given.length > 0) return { kinds: given, topics: given.includes("motive") ? ["motive"] : [] };
  const prompt = section(text, "문항");
  const motive = /동기|포부/.test(prompt);
  return { kinds: motive ? ["experience", "motive"] : ["experience"], topics: motive ? ["motive"] : [] };
}

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
    // 정해진 유형이 있으면 그대로, 없으면 문항 글로 흉내 낸다
    ...localKinds(text),
  };
}

// 답 쓰기 흉내. E1의 "본인이 한 일"과 "결과"로 두 문단을 쓰고, [내 답]이 있으면 A1의 답 글을 첫 문단으로 쓴다
function applicationWrite(text: string) {
  const experiences = section(text, "경험 기록");
  const first = experiences.split(/\n\n(?=E\d+\n)/)[0] ?? "";
  const field = (label: string) => {
    const value = first.match(new RegExp(`^- ${label}: (.*)$`, "m"))?.[1] ?? "";
    return value === "없음" ? "" : value;
  };
  const paragraphs = [field("본인이 한 일"), field("결과")].filter(Boolean).map((line) => ({ text: line, sources: ["E1"] }));
  // [내 답]이 있으면 첫 답의 글을 A1이 근거인 문단으로 앞에 둔다
  const answer = section(text, "내 답").split(/\n\n(?=A\d+\n)/)[0]?.match(/^- 답: (.*)$/m)?.[1] ?? "";
  if (answer) paragraphs.unshift({ text: answer, sources: ["A1"] });
  // [회사 정보]가 있으면 첫 문단에 C1을 단다
  if (section(text, "회사 정보") && paragraphs[0]) paragraphs[0].sources.push("C1");
  return { paragraphs, shortage: "" };
}

// 문단 고치기 흉내. 고칠 문단 끝에 "(고침)"을 붙인다. 근거는 경험이 있으면 E1, 답이 있으면 A1, 회사 정보가 있으면 C1(쓰기 흉내와 같게)
function applicationRevise(text: string) {
  const sources = [section(text, "경험 기록") ? "E1" : "", section(text, "내 답") ? "A1" : "", section(text, "회사 정보") ? "C1" : ""].filter(Boolean);
  return { text: `${section(text, "고칠 문단")} (고침)`, sources };
}

// 묻기 흉내. 질문 2개에 선택지 3개씩. [내 기록]이 있으면 첫 기록을 연결고리로 적는다
function applicationAsk(text: string) {
  const topics = [...section(text, "물을 주제").matchAll(/^([a-z]+) \(/gm)].map((match) => match[1]);
  const first = topics[0] ?? "motive";
  const hook = section(text, "내 기록").split("\n")[0]?.replace(/^- /, "").split(" — ")[0] ?? "";
  return {
    items: [
      {
        topic: first,
        link: hook ? `공고의 담당 업무 ↔ ${hook}` : "",
        question: hook ? "이 기록이 이 직무를 고른 이유와 이어지나요?" : "이 공고에서 가장 끌린 점은 무엇인가요?",
        options: ["배운 것을 실무에서 더 키우고 싶다", "많은 사람이 쓰는 서비스를 만들고 싶다", "이어지지 않는다"],
      },
      {
        topic: topics[1] ?? first,
        link: "",
        question: "입사하면 어떤 일을 먼저 해 보고 싶나요?",
        options: ["맡은 서비스를 안정적으로 운영하고 싶다", "새 기능을 빨리 만들어 보고 싶다", "아직 잘 모르겠다"],
      },
    ],
  };
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

// 회사 조사 흉내. 검색 결과(출처) 두 개와 그 주소를 쓴 인재상·소식 하나. 소식 날짜는 [오늘]로 둔다
// 인재상은 홈페이지 도메인 밖이면 버려지므로, [홈페이지]가 있으면 그 도메인의 주소를 출처로 쓴다
function researchSources(text: string): WebSource[] {
  const domain = section(text, "홈페이지");
  const company = section(text, "회사") || "예시 회사";
  return [
    { url: `https://www.${domain || "example.com"}/careers`, title: `인재상 | ${company}`, pageAge: null },
    { url: "https://news.example.com/a1", title: `${company}, 새 서비스 출시`, pageAge: null },
  ];
}
function companyResearch(text: string, sources: WebSource[]) {
  return {
    talent: { text: "고객을 먼저 생각하고 끝까지 해내는 사람", url: sources[0].url },
    news: [{ summary: "예시 회사가 새 서비스를 내놓았다고 밝혔다.", date: section(text, "오늘") || null, url: sources[1].url }],
  };
}
// 공고 화면에서 "조사 중"을 볼 수 있게 조사는 더 오래 걸리는 척한다(테스트에서는 기다리지 않는다)
const RESEARCH_WAIT_MS = process.env.NODE_ENV === "test" ? 0 : 8000;

export const ai: AiClient = {
  async complete<T>(request: AiRequest<T>): Promise<AiResult<T>> {
    await new Promise((resolve) => setTimeout(resolve, 400)); // 기다리는 화면을 볼 수 있게
    const text = request.messages.map((message) => message.text).join("\n");
    if (request.purpose === "company_research") {
      await new Promise((resolve) => setTimeout(resolve, RESEARCH_WAIT_MS));
      const sources = researchSources(text);
      const parsed = request.schema.safeParse(companyResearch(text, sources));
      const meta = { usage: { ...FAKE_USAGE, webSearchRequests: 2 }, model: FAKE_MODEL, sources };
      return parsed.success ? { ok: true, value: parsed.data, ...meta } : { ok: false, reason: "invalid", ...meta };
    }
    const answer =
      request.purpose === "judge"
        ? judge(text)
        : request.purpose === "interview"
          ? interview(request as AiRequest<unknown>)
          : request.purpose === "import"
            ? importRecords(text)
            : request.purpose === "import_records"
              ? importNewRecords(text)
              : request.purpose === "migrate"
                ? migrate(text)
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
                        : request.purpose === "application_ask"
                          ? applicationAsk(text)
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
