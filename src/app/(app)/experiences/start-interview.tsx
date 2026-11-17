"use client";

import { useState, useTransition } from "react";
import { startInterviewAction } from "@/modules/experiences/actions";

// 새 기록을 만드는 AI 인터뷰를 시작한다. 트랙이 여럿이면 어느 직무에 맞춰 물을지 고른다
export function StartInterview({ tracks }: { tracks: { id: string; name: string }[] }) {
  const [trackId, setTrackId] = useState(tracks[0]?.id ?? "");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function start() {
    setMessage(null);
    startTransition(async () => {
      const result = await startInterviewAction({ trackId });
      // 성공하면 서버가 인터뷰 화면으로 보낸다
      if (result && !result.ok) setMessage(result.message);
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {tracks.length > 1 && (
        <select
          value={trackId}
          onChange={(e) => setTrackId(e.target.value)}
          aria-label="인터뷰할 트랙"
          className="rounded-lg border border-foreground/20 bg-transparent px-2 py-2 text-sm"
        >
          {tracks.map((track) => (
            <option key={track.id} value={track.id}>
              {track.name}
            </option>
          ))}
        </select>
      )}
      <button
        type="button"
        onClick={start}
        disabled={pending}
        className="rounded-lg border border-foreground/20 px-4 py-2 text-sm font-medium disabled:opacity-50"
      >
        {pending ? "준비 중…" : "AI 인터뷰로 추가"}
      </button>
      {message && (
        <p role="alert" className="w-full text-sm text-red-600">
          {message}
        </p>
      )}
    </div>
  );
}
