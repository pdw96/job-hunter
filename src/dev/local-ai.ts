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
    return { message: request.messages[0].text.includes("보완하는 인터뷰") ? QUESTIONS[1] : "어떤 경험을 기록할까요? 한두 문장으로 알려 주세요.", enough: false };
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
  const blocks = text.replace("[가져올 글]\n", "").split(/\n\s*\n/).map((block) => block.trim()).filter(Boolean);
  return {
    records: blocks.slice(0, 12).map((block) => {
      const [title, ...rest] = block.split("\n");
      const period = block.match(/(\d{4})[.-](\d{1,2})\s*~\s*(\d{4})[.-](\d{1,2})/);
      const body = rest.join("\n").trim();
      return {
        name: title.replace(/\(.*\)/, "").trim().slice(0, 60),
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
      };
    }),
    more: blocks.length > 12,
  };
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
            : extract(text);
    const parsed = request.schema.safeParse(answer);
    const meta = { usage: FAKE_USAGE, model: FAKE_MODEL };
    return parsed.success ? { ok: true, value: parsed.data, ...meta } : { ok: false, reason: "invalid", ...meta };
  },
};
