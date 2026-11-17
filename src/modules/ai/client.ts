import type { ZodType } from "zod";
import type { Db } from "@/db/types";
import type { TokenUsage } from "./pricing";
import { redactContacts } from "./redact";
import { checkBudget, recordUsage } from "./usage";

// Claude API를 부르는 곳은 AiClient 구현 하나뿐이다. 다른 모듈은 이 인터페이스를 인자로 받는다.
// 테스트와 로컬 미리보기는 정해진 답을 돌려주는 가짜 구현을 쓴다.

export type AiPurpose = "judge" | "interview" | "extract" | "import" | "posting" | "posting_image";
export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export type AiImage = { mediaType: (typeof IMAGE_TYPES)[number]; data: string }; // data는 base64
// images는 글과 함께 보여 줄 그림(사용자 메시지에만 쓴다)
export type AiMessage = { role: "user" | "assistant"; text: string; images?: AiImage[] };

export type AiRequest<T> = {
  purpose: AiPurpose;
  system: string; // 고정 글만 담는다(캐시를 위해 날짜·이름 등을 넣지 않는다)
  messages: AiMessage[];
  schema: ZodType<T>;
  effort: "low" | "medium";
  maxTokens: number;
};

// refused 모델이 요청을 거절 / truncated 답이 잘림 / invalid 답이 스키마에 안 맞음 / unavailable 서비스 오류
export type AiFailure = "refused" | "truncated" | "invalid" | "unavailable";

export type AiResult<T> = ({ ok: true; value: T } | { ok: false; reason: AiFailure }) & {
  usage?: TokenUsage; // 실패해도 토큰을 썼으면 온다
  model?: string;
};

export interface AiClient {
  complete<T>(request: AiRequest<T>): Promise<AiResult<T>>;
}

// 한도 검사 → 연락처 가리기 → 호출 → 사용량 기록. AI를 쓰는 모든 기능은 이 함수를 거친다
export async function runAi<T>(
  db: Db,
  ai: AiClient,
  userId: string,
  request: AiRequest<T>,
  now: Date = new Date(),
): Promise<AiResult<T> | { ok: false; reason: "over_limit" }> {
  const budget = await checkBudget(db, userId, now);
  if (!budget.ok) return budget;

  const result = await ai.complete({
    ...request,
    messages: request.messages.map((message) =>
      message.role === "user" ? { ...message, text: redactContacts(message.text) } : message,
    ),
  });
  if (result.usage && result.model) {
    await recordUsage(db, userId, { purpose: request.purpose, model: result.model, usage: result.usage, at: now });
  }
  return result;
}
