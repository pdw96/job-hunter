"use client";

import { useState } from "react";
import { resetMovesAction } from "@/modules/experiences/move-actions";

// 옮겨서 만든 기록을 지우고 옮기기를 처음부터 다시 한다. 성공하면 옮기기 화면을 전체로 불러온다
export function ResetMovesButton({ count }: { count: number }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reset() {
    if (!window.confirm(`옮겨서 만든 기록 ${count}개를 지우고 예전 기록에서 다시 옮깁니다. 직접 넣은 기록은 지우지 않습니다.`)) return;
    setBusy(true);
    setError(null);
    try {
      const result = await resetMovesAction();
      if (result.ok) {
        // 옮기는 중에 받은 이전 화면이 남지 않게 전체를 새로 불러온다
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination
        window.location.href = "/moving";
        return;
      }
      setError(result.message);
    } catch {
      setError("연결이 끊겼습니다. 다시 시도해 주세요");
    }
    setBusy(false);
  }

  return (
    <div className="space-y-2 border-t border-foreground/10 pt-6">
      <button type="button" disabled={busy} onClick={reset} className="rounded-lg border border-foreground/20 px-3 py-1.5 text-sm font-medium disabled:opacity-50">
        옮기기를 처음부터 다시 하기
      </button>
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
