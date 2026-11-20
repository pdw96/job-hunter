import { expect, test } from "vitest";
import { newRecordsOn } from "./switch";

test("스위치는 환경 변수 없이 켜져 있다(5-4에서 바꿈)", () => {
  expect(newRecordsOn()).toBe(true);
});
