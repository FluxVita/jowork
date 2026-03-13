import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useBilling } from './hooks/useBilling';

/** Compact credit bar for sidebar bottom. */
export function CreditBar() {
  const { t } = useTranslation('billing');
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
    <div className="px-4 py-2.5">
      <div className="flex justify-between text-[11px] text-text-secondary/60 mb-1.5">
        <span>{t('credits')}</span>
        <span>{t('creditsLeft', { count: credits.remaining })}</span>
      </div>
      <div className="h-[3px] bg-surface-2/60 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${isLow ? 'bg-red-500' : 'bg-accent/70'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      {credits.walletBalance > 0 && (
        <div className="text-[10px] text-text-secondary/40 mt-1">
          {t('walletBalance', { count: credits.walletBalance })}
        </div>
      )}
    </div>
  );
}
