import { afterEach, beforeEach } from "vitest";
import { beginTestDbScope, endTestDbScope } from "@/db/test-db";

// 테스트마다 만든 테스트 DB를 테스트가 끝나면 닫는다. beforeAll에서 만든 DB는 파일 끝까지 쓴다
beforeEach(() => beginTestDbScope());
afterEach(() => endTestDbScope());
