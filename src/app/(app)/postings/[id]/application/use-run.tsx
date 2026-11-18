import { useState, useTransition } from "react";

export type ActionResult = { ok: true } | { ok: false; message: string };

// 서버 액션 하나를 돌리고 기다리는 동안 pending, 실패하면 message를 남긴다
export function useRun() {
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run(action: () => Promise<ActionResult>, onOk?: () => void) {
    setMessage(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) setMessage(result.message);
      else onOk?.();
    });
  }

  return { message, pending, run };
}

export function ErrorLine({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="text-sm text-red-600">
      {message}
    </p>
  );
}
