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
        준비한 예시 기록 6개를 판정시키고 예시 대화 2개를 정리시켜, 기대한 결과가 나오는지 봅니다. 실제 AI를 8번
        부르므로 비용이 듭니다(1달러 미만). 1분쯤 걸릴 수 있습니다
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
            <table className="w-full min-w-[36rem] border-collapse text-left text-sm">
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
                    <td className={`py-2 font-medium ${row.pass ? "text-emerald-700 dark:text-emerald-400" : "text-red-600"}`}>
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
