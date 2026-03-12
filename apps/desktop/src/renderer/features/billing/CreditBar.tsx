import { useEffect } from 'react';
import { useBilling } from './hooks/useBilling';

/** Compact credit bar for sidebar bottom. */
export function CreditBar() {
  const { credits, loadCredits } = useBilling();

  useEffect(() => {
    loadCredits();
  }, [loadCredits]);

  if (!credits) return null;

  const total = credits.monthlyLimit ?? credits.dailyFreeLimit;
  const used = credits.monthlyLimit ? credits.used : credits.dailyFreeUsed;
  const pct = total > 0 ? Math.min((used / total) * 100, 100) : 0;
  const isLow = pct > 80;

  return (
    <div className="px-4 py-2">
      <div className="flex justify-between text-xs text-text-secondary mb-1">
        <span>Credits</span>
        <span>{credits.remaining} left</span>
      </div>
      <div className="h-1.5 bg-surface-2 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${isLow ? 'bg-red-500' : 'bg-accent'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      {credits.walletBalance > 0 && (
        <div className="text-[10px] text-text-secondary mt-0.5">
          +{credits.walletBalance} wallet
        </div>
      )}
    </div>
  );
}
