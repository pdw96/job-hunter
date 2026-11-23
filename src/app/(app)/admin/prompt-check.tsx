"use client";

import { useState, useTransition } from "react";
import { runPromptCheckAction } from "@/modules/experiences/actions";
import type { CheckRow } from "@/modules/experiences/prompt-check";

// 관리자 전용. 준비한 예시를 실제 AI에 돌려 기대한 결과와 비교한다
export function PromptCheck() {
  const [rows, setRows] = useState<CheckRow[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run() {
    setMessage(null);
    startTransition(async () => {
      const result = await runPromptCheckAction();
      if (result.ok) setRows(result.rows);
      else setMessage(result.message);
    });
  }

  const passed = rows?.filter((row) => row.pass).length ?? 0;

  return (
    <section className="space-y-3 border-t border-foreground/10 pt-6">
      <h2 className="text-lg font-semibold">AI 프롬프트 점검</h2>
      <p className="text-sm text-foreground/70">
        예시 사례 6개를 판정시키고, 사례 대화 2개를 정리시키고 섞인 이력서 1편을 가져오게 하고, 예전 기록 옮기기 예시 2개(재직 기록 나누기, 프로젝트 소속 잇기)를 돌리고, 공고 읽기 예시 3개와 경험 맞대기 1개, 자소서 고르기·쓰기 예시 2개, 이력서 쓰기·강조 고르기 예시 2개를 돌려서 기대한
        결과가 나오는지 봅니다. 실제 AI를 21번 부르므로 비용이 듭니다(1달러 미만). 1분쯤 걸릴 수 있습니다
      </p>
      <button
        type="button"
        onClick={run}
        disabled={pending}
        className="rounded-lg border border-foreground/20 px-4 py-2 text-sm font-medium disabled:opacity-50"
      >
        {pending ? "점검 중…" : "점검 실행"}
      </button>
      {message && (
        <p role="alert" className="text-sm text-red-600">
          {message}
        </p>
      )}
      {rows && (
        <div className="space-y-2">
          <p className="font-medium">
            {rows.length}개 중 {passed}개 통과
          </p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[44rem] table-fixed border-collapse text-left text-sm">
              <colgroup>
                <col className="w-[22%]" />
                <col className="w-[20%]" />
                <col className="w-[16%]" />
                <col />
                <col className="w-14" />
              </colgroup>
              <thead>
                <tr className="border-b border-foreground/20 text-foreground/60">
                  <th className="py-2 pr-3 font-normal">예시</th>
                  <th className="py-2 pr-3 font-normal">확인한 것</th>
                  <th className="py-2 pr-3 font-normal">기대</th>
                  <th className="py-2 pr-3 font-normal">실제</th>
                  <th className="py-2 font-normal">결과</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr key={index} className="border-b border-foreground/10 align-top">
                    <td className="py-2 pr-3">{row.sample}</td>
                    <td className="py-2 pr-3">{row.check}</td>
                    <td className="py-2 pr-3">{row.expected}</td>
                    <td className="py-2 pr-3">{row.actual}</td>
                    <td className={`whitespace-nowrap py-2 font-medium ${row.pass ? "text-emerald-700 dark:text-emerald-400" : "text-red-600"}`}>
                      {row.pass ? "통과" : "다름"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
