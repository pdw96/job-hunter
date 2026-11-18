// 테이블은 모듈이 소유한다. 여기서는 각 모듈의 schema.ts를 모아 내보내기만 한다.
// 새 모듈을 만들면 한 줄 추가한다. (drizzle-kit이 읽으므로 상대 경로를 쓴다)
export * from "../modules/access/schema";
export * from "../modules/auth/schema";
export * from "../modules/profile/schema";
export * from "../modules/ncs/schema";
export * from "../modules/tracks/schema";
export * from "../modules/experiences/schema";
export * from "../modules/ai/schema";
export * from "../modules/postings/schema";
export * from "../modules/applications/schema";
