"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { moveNextAction, retryMoveAction } from "@/modules/experiences/move-actions";
import type { KindMove, MoveProgress, MoveSummary } from "@/modules/experiences/move-repo";
import type { Kind } from "@/modules/experiences/options";

// 옛 구분이 새 구조의 어디로 가는가
const TARGETS: Record<Kind, string> = {
  school: "학력",
  training: "학력 메뉴의 교육 과정",
  certificate: "자격",
  gap: "경력 메뉴의 공백",
  job: "경력 + 사례",
  project: "프로젝트 머리 + 사례",
  other: "활동 머리 + 사례",
};
const OLD_LABELS: Record<Kind, string> = {
  school: "학력",
  training: "교육",
  certificate: "자격",
  gap: "공백",
  job: "재직",
  project: "프로젝트",
  other: "기타",
};
const ORDER: Kind[] = ["school", "training", "certificate", "job", "gap", "project", "other"];

const button = "rounded-lg border border-foreground/20 px-3 py-1.5 text-sm font-medium disabled:opacity-50";
const WAIT_MS = 2000;

function statusOf(line: KindMove): string {
  if (line.done === line.total) return "옮김";
  if (line.done + line.failed.length === line.total) return `${line.failed.length}개 옮기지 못함`;
  return `${line.done} / ${line.total}`;
}

export function Mover({ progress: initial, summary }: { progress: MoveProgress; summary: MoveSummary }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const loop = useRef(false);

  // 한 번에 하나씩, 남은 것이 없을 때까지 부른다. 나란히 부르지 않는다
  const run = useCallback(async () => {
    if (loop.current) return;
    loop.current = true;
    setRunning(true);
    setError(null);
    let last = "";
    try {
      for (;;) {
        const result = await moveNextAction();
        if (!result.ok) {
          setError(result.message);
          break;
        }
        router.refresh();
        if (result.progress.pending === 0) break;
        // 다른 탭이 돌리는 중이라 진행이 그대로면 잠시 기다린다
        const snapshot = `${result.progress.done}/${result.progress.failed.length}/${result.progress.pending}`;
        if (snapshot === last) await new Promise((resolve) => setTimeout(resolve, WAIT_MS));
        last = snapshot;
      }
    } catch {
      setError("연결이 끊겼습니다. 다시 시도해 주세요");
    } finally {
      loop.current = false;
      setRunning(false);
      router.refresh();
    }
  }, [router]);

  useEffect(() => {
    if (initial.pending > 0) setTimeout(() => void run(), 0);
    // 처음 한 번만 시작한다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const failed = [
    ...(summary.classify?.status === "failed" ? [{ id: summary.classify.id }] : []),
    ...summary.kinds.flatMap((line) => line.failed),
    ...(summary.affiliate?.status === "failed" ? [{ id: summary.affiliate.id }] : []),
  ];

  async function retry(ids: string[]) {
    let reset = 0;
    let problem: string | null = null;
    for (const id of ids) {
      const result = await retryMoveAction(id);
      if (!result.ok) {
        problem = result.message;
        break;
      }
      reset += 1;
    }
    // 이미 되돌린 행이 있으면 멈춰 두지 말고 이어서 옮긴다
    if (ids.length === 0 || reset > 0) {
      await run();
    }
    if (problem) setError(problem);
  }

  const affiliate = summary.affiliate;
  const classify = summary.classify;
  // 화면의 개수는 옛 기록만 센다(소속 제안은 따로 한 줄). 서버가 새로 읽어 준 summary를 쓴다
  const percent = summary.recordTotal === 0 ? 100 : Math.round((summary.recordDone / summary.recordTotal) * 100);
  const lines = [...summary.kinds].sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));
  // 서버가 새로 읽어 준 개수로 가린다(한도로 한꺼번에 실패 처리된 뒤에도 맞게 바뀐다)
  const recordsLeft = summary.recordTotal - summary.recordDone - summary.recordFailed > 0;
  // 정리가 실패하면 남은 기록은 다시 시도할 때까지 기다린다(돌지 않지만 끝난 것도 아니다)
  const blocked = classify?.status === "failed" && recordsLeft;
  const waiting =
    (recordsLeft && !blocked) ||
    classify?.status === "pending" ||
    classify?.status === "running" ||
    affiliate?.status === "pending" ||
    affiliate?.status === "running";
  const idle = !running && !waiting && !blocked;
  const finished = idle && !error;
  const affiliateLabel = affiliate?.status === "done" ? "옮김" : affiliate?.status === "failed" ? "옮기지 못함" : "기다림";

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold">{idle ? "기록을 새 구조로 옮겼습니다" : "기록을 새 구조로 옮기는 중"}</h1>
        <p className="text-sm text-foreground/70">개편 뒤 처음 들어왔을 때 한 번만 돕니다. 옮긴 뒤 화면에서 고칠 수 있습니다.</p>
        {idle && summary.recordFailed > 0 && (
          <p className="text-sm font-medium">{summary.recordFailed}개를 옮기지 못했습니다. 아래에서 다시 시도할 수 있습니다</p>
        )}
      </div>

      <div className="space-y-2">
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={summary.recordTotal}
          aria-valuenow={summary.recordDone}
          aria-label="옮기는 진행"
          className="h-2.5 overflow-hidden rounded-full bg-foreground/10"
        >
          <div className="h-full rounded-full bg-foreground transition-all" style={{ width: `${percent}%` }} />
        </div>
        <p className="text-sm">
          {summary.recordTotal}개 중 {summary.recordDone}개 옮김
        </p>
      </div>

      {error && (
        <div role="alert" className="space-y-2 rounded-lg border border-red-500/40 bg-red-500/5 p-4 text-sm">
          <p>{error}</p>
          <button type="button" className={button} disabled={running} onClick={() => retry(failed.map((item) => item.id))}>
            다시 시도
          </button>
          <a href="/records" className={`${button} inline-block`}>
            기록 보기
          </a>
        </div>
      )}

      <ul className="space-y-3">
        {classify && (
          <li className="flex items-start justify-between gap-3 rounded-lg border border-foreground/15 p-4 text-sm">
            <p className="font-medium">
              같은 기록·사례 정리
              {classify.error && <span className="block font-normal text-foreground/60">{classify.error}</span>}
            </p>
            {classify.status === "failed" ? (
              <button type="button" className={button} disabled={running} onClick={() => retry([classify.id])}>
                다시 시도
              </button>
            ) : (
              <span className="shrink-0 text-foreground/70">{classify.status === "done" ? "정리함" : "기다림"}</span>
            )}
          </li>
        )}
        {lines.map((line) => (
          <li key={line.kind} className="space-y-1 rounded-lg border border-foreground/15 p-4 text-sm">
            <div className="flex items-baseline justify-between gap-3">
              <span className="font-medium">
                {OLD_LABELS[line.kind]} {line.total}개 → {TARGETS[line.kind]}
              </span>
              <span className="shrink-0 text-foreground/70">{statusOf(line)}</span>
            </div>
            {[...new Set(line.notes)].map((note, index) => (
              <p key={index} className="text-foreground/60">
                {note}
              </p>
            ))}
            {line.failed.map((item) => (
              <div key={item.id} className="flex items-start justify-between gap-3 pt-1">
                <p className="text-foreground/70">
                  {item.name}
                  {item.error && <span className="block text-foreground/60">{item.error}</span>}
                </p>
                <button type="button" className={button} disabled={running} onClick={() => retry([item.id])}>
                  다시 시도
                </button>
              </div>
            ))}
          </li>
        ))}
        {affiliate && (
          <li className="flex items-start justify-between gap-3 rounded-lg border border-foreground/15 p-4 text-sm">
            <p className="font-medium">
              프로젝트 소속 제안
              {affiliate.status === "failed" && affiliate.error && <span className="block font-normal text-foreground/60">{affiliate.error}</span>}
            </p>
            {affiliate.status === "failed" ? (
              <button type="button" className={button} disabled={running} onClick={() => retry([affiliate.id])}>
                다시 시도
              </button>
            ) : (
              <span className="shrink-0 text-foreground/70">{affiliateLabel}</span>
            )}
          </li>
        )}
      </ul>

      <p className="text-sm text-foreground/60">
        확인됐던 기록은 내용을 그대로 옮겨 확인 상태를 이어 갑니다. 학력·자격은 칸이 바뀌어 `맞음`을 한 번 눌러 주세요
      </p>

      {/* 미리 읽어 두면 옮기는 중에 받은 "되돌려 보내기"가 남을 수 있어, 링크 대신 전체를 새로 불러온다 */}
      {finished && (
        <a href="/records" className="block rounded-lg bg-foreground px-4 py-3 text-center text-sm font-medium text-background">
          기록 보기
        </a>
      )}
    </div>
  );
}
