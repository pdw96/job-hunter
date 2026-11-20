"use client";

import { useState, useTransition } from "react";
import { startSceneInterviewAction } from "@/modules/experiences/record-actions";

// 이 회사·프로젝트·활동 아래 새 사례를 묻는 AI 인터뷰를 시작한다. 성공하면 서버가 인터뷰 화면으로 보낸다
export function StartSceneInterview({ head }: { head: string }) {
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function start() {
    setMessage(null);
    startTransition(async () => {
      const result = await startSceneInterviewAction({ head });
      if (result && !result.ok) setMessage(result.message);
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={start}
        disabled={pending}
        className="rounded-lg border border-foreground/20 px-3 py-1.5 text-sm font-medium disabled:opacity-50"
      >
        {pending ? "준비 중…" : "AI 인터뷰"}
      </button>
      {message && (
        <p role="alert" className="w-full text-sm text-red-600">
          {message}
        </p>
      )}
    </>
  );
}
