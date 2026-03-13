import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useBilling } from './hooks/useBilling';
import { PlanSelector } from './PlanSelector';
import { CreditBar } from './CreditBar';
import { UsageChart } from './UsageChart';
import { useAuth } from '../auth/hooks/useAuth';

const TOPUP_OPTIONS = [100, 500, 1000, 5000];

export function BillingPage() {
  const { t } = useTranslation('billing');
  const { credits, loadCredits, openPortal, buyCredits, loading } = useBilling();
  const { user, loginWithGoogle } = useAuth();
  const [topUpAmount, setTopUpAmount] = useState(500);

  const { loadPlans } = useBilling();
  useEffect(() => {
    loadCredits();
    loadPlans();
  }, [loadCredits, loadPlans]);

  // Placeholder usage data (7 days) — memoized to prevent re-render flicker
  const usageData = useMemo(() => Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    return {
      date: d.toISOString().split('T')[0],
      credits: Math.floor((i + 1) * 4.3), // deterministic placeholder
    };
  }), []);

  if (!user) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <h1 className="text-xl font-bold mb-4">{t('title')}</h1>
        <div className="bg-surface-1 rounded-lg p-8 text-center">
          <p className="text-text-secondary mb-4">
            {t('signInRequired')}
          </p>
          <button
            onClick={loginWithGoogle}
            className="px-6 py-2 rounded-md bg-accent text-white font-medium hover:bg-accent/90 transition-colors"
          >
            {t('auth:signIn', { ns: 'auth' })}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">{t('title')}</h1>
        <button
          onClick={openPortal}
          className="text-sm text-accent hover:underline"
        >
          {t('manageSubscription')}
        </button>
      </div>

      {/* Credit overview */}
      <div className="bg-surface-1 rounded-lg p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-medium">{t('credits')}</h2>
          {loading && <span className="text-xs text-text-secondary">{t('common:loading')}</span>}
        </div>
        <CreditBar />
        {credits && (
          <div className="grid grid-cols-3 gap-4 mt-4 text-center">
            <div>
              <div className="text-2xl font-bold">{credits.remaining}</div>
              <div className="text-xs text-text-secondary">{t('remaining')}</div>
            </div>
            <div>
              <div className="text-2xl font-bold">{credits.used}</div>
              <div className="text-xs text-text-secondary">{t('used')}</div>
            </div>
            <div>
              <div className="text-2xl font-bold">{credits.walletBalance}</div>
              <div className="text-xs text-text-secondary">{t('wallet')}</div>
            </div>
          </div>
        )}
      </div>

      {/* Top-up */}
      <div className="bg-surface-1 rounded-lg p-5">
        <h2 className="font-medium mb-3">{t('buyCredits')}</h2>
        <div className="flex items-center gap-2 mb-3">
          {TOPUP_OPTIONS.map((amt) => (
            <button
              key={amt}
              onClick={() => setTopUpAmount(amt)}
              className={`px-3 py-1.5 rounded-md text-sm transition-colors ${
                topUpAmount === amt
                  ? 'bg-accent text-white'
                  : 'bg-surface-2 text-text-secondary hover:bg-surface-2/80'
              }`}
            >
              {amt}
            </button>
          ))}
        </div>
        <button
          onClick={() => buyCredits(topUpAmount)}
          className="px-4 py-2 rounded-md bg-accent text-white text-sm font-medium hover:bg-accent/90 transition-colors"
        >
          {t('buyAmount', { amount: topUpAmount })}
        </button>
      </div>

      {/* Usage chart */}
      <UsageChart data={usageData} limit={credits?.dailyFreeLimit ?? 50} />

      {/* Plan selector */}
      <div>
        <h2 className="font-medium mb-3">{t('plans')}</h2>
        <PlanSelector />
      </div>
    </div>
  );
}
