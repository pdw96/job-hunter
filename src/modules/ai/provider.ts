import { anthropicAi } from "./anthropic-client";
import type { AiClient } from "./client";

// 앱이 쓰는 AI. 로컬 미리보기에서는 next.config.ts가 이 파일을 src/dev/local-ai.ts로 바꿔 끼운다.
export const ai: AiClient = anthropicAi;
