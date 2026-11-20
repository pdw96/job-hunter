import { VERIFICATION_LABELS } from "@/modules/experiences/options";
import type { VerificationState } from "@/modules/experiences/verification";

const STYLES: Record<VerificationState, string> = {
  unconfirmed: "border-foreground/20 text-foreground/60",
  partial: "border-amber-600/50 text-amber-700 dark:text-amber-400",
  confirmed: "border-emerald-600/50 text-emerald-700 dark:text-emerald-400",
};

export function StateBadge({ state }: { state: VerificationState }) {
  return (
    <span className={`shrink-0 rounded-full border px-2 py-0.5 text-xs ${STYLES[state]}`}>
      {VERIFICATION_LABELS[state]}
    </span>
  );
}
