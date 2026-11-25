// 기록의 확인 표시. 이력·경험 사례 탭과 기록 카드가 같이 쓴다. pendingLabel: 미확인일 때의 문구
export function ConfirmBadge({ confirmed, pendingLabel = "미확인" }: { confirmed: boolean; pendingLabel?: string }) {
  return (
    <span
      className={`shrink-0 rounded-full border px-2 py-0.5 text-xs ${
        confirmed ? "border-emerald-600/50 text-emerald-700 dark:text-emerald-400" : "border-amber-600/50 text-amber-700 dark:text-amber-400"
      }`}
    >
      {confirmed ? "확인됨" : pendingLabel}
    </span>
  );
}
