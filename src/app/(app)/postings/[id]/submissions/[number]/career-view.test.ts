import { expect, test } from "vitest";
import type { CareerContent, SubmissionContent } from "@/modules/applications/types";
import { submittedCareerView } from "./career-view";

const posting = { company: "가나다", title: "백엔드", url: null, deadline: null, isRolling: false, rawText: "원문", companyNote: null };
const content: CareerContent = {
  companies: [
    {
      experienceId: "j1",
      contentVersion: 1,
      heading: { company: "라마바", department: null, title: "사원", period: "2022.03 ~ 2024.08", duties: [] },
      items: [
        {
          experienceId: "s1",
          contentVersion: 1,
          kind: "scene",
          heading: { name: "결제 장애 대응", role: "사원", period: "2023.03 ~ 2023.11", tools: [] },
          detail: "full",
          emphasized: true,
          done: [{ text: "승인 API를 다시 설계했다", edited: false }],
          results: [],
          writtenAt: "2026-11-24T00:00:00.000Z",
        },
      ],
    },
  ],
  commonVersion: 1,
};

test("옛 제출본은 career 없이 그린다", () => {
  // 5-7 전에 얼린 제출본에는 career 키가 없다
  const old = { posting, resume: null, answers: [] } as SubmissionContent;
  expect(submittedCareerView(old)).toBeNull();
  expect(submittedCareerView({ ...old, career: null })).toBeNull();
});

test("경력기술서가 있으면 이름표와 복사 글을 만든다", () => {
  const view = submittedCareerView({ posting, resume: null, answers: [], career: { from: "tailored", content } });
  expect(view?.label).toBe("맞춤본");
  expect(view?.companies).toBe(content.companies);
  expect(view?.copyText).toBe("라마바 | 사원 | 2022.03 ~ 2024.08\n■ 결제 장애 대응 | 사원 | 2023.03 ~ 2023.11\n한 일\n- 승인 API를 다시 설계했다");
  expect(submittedCareerView({ posting, resume: null, answers: [], career: { from: "common", content } })?.label).toBe("트랙 공통본");
});
