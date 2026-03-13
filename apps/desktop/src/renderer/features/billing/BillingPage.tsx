import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useBilling } from './hooks/useBilling';
import { PlanSelector } from './PlanSelector';
import { CreditBar } from './CreditBar';
import { UsageChart } from './UsageChart';
import { useAuth } from '../auth/hooks/useAuth';
import { CreditCard, ExternalLink, Wallet, Coins, Activity } from 'lucide-react';
import { GlassCard } from '../../components/ui/glass-card';

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
      <div className="flex-1 p-10 overflow-y-auto custom-scrollbar">
        <div className="max-w-2xl mx-auto text-center py-20">
          <GlassCard className="p-10 flex flex-col items-center">
            <div className="w-16 h-16 bg-primary/10 rounded-2xl flex items-center justify-center text-primary mb-6">
              <CreditCard className="w-8 h-8" />
            </div>
            <h1 className="text-2xl font-bold mb-3">{t('title')}</h1>
            <p className="text-muted-foreground mb-8">{t('signInRequired')}</p>
            <button
              onClick={loginWithGoogle}
              className="px-8 py-3 rounded-xl bg-primary text-primary-foreground font-semibold hover:opacity-90 transition-all shadow-lg shadow-primary/20 active:scale-95"
            >
              {t('auth:signIn', { ns: 'auth' })}
            </button>
          </GlassCard>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 p-10 overflow-y-auto custom-scrollbar animate-in fade-in duration-500">
      <div className="max-w-4xl mx-auto space-y-8">
        
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-primary/10 text-primary">
              <CreditCard className="w-6 h-6" />
            </div>
            <h1 className="text-3xl font-bold tracking-tight text-foreground">{t('title')}</h1>
          </div>
          <button
            onClick={openPortal}
            className="flex items-center gap-2 text-[14px] font-medium text-muted-foreground hover:text-primary transition-colors bg-surface-2/30 px-4 py-2 rounded-xl border border-border/40 backdrop-blur-sm"
          >
            {t('manageSubscription')}
            <ExternalLink className="w-4 h-4" />
          </button>
        </div>

        {/* Credit overview */}
        <GlassCard className="p-6 border-primary/10 shadow-[0_8px_32px_rgba(var(--primary),0.05)]">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-[16px] font-bold text-foreground flex items-center gap-2">
              <Coins className="w-5 h-5 text-primary" />
              {t('credits')}
            </h2>
            {loading && <span className="text-xs font-medium text-primary bg-primary/10 px-2 py-1 rounded-md animate-pulse">{t('common:loading')}</span>}
          </div>
          
          <CreditBar />
          
          {credits && (
            <div className="grid grid-cols-3 gap-6 mt-8">
              <div className="bg-surface-2/30 rounded-xl p-4 border border-border/40 text-center">
                <div className="text-3xl font-black text-foreground mb-1 font-mono tracking-tight">{credits.remaining}</div>
                <div className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">{t('remaining')}</div>
              </div>
              <div className="bg-surface-2/30 rounded-xl p-4 border border-border/40 text-center">
                <div className="text-3xl font-black text-foreground mb-1 font-mono tracking-tight">{credits.used}</div>
                <div className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">{t('used')}</div>
              </div>
              <div className="bg-surface-2/30 rounded-xl p-4 border border-border/40 text-center">
                <div className="text-3xl font-black text-foreground mb-1 font-mono tracking-tight">{credits.walletBalance}</div>
                <div className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">{t('wallet')}</div>
              </div>
            </div>
          )}
        </GlassCard>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {/* Top-up */}
          <GlassCard className="p-6 flex flex-col">
            <h2 className="text-[16px] font-bold text-foreground mb-5 flex items-center gap-2">
              <Wallet className="w-5 h-5 text-primary" />
              {t('buyCredits')}
            </h2>
            
            <div className="grid grid-cols-4 gap-2 mb-6">
              {TOPUP_OPTIONS.map((amt) => (
                <button
                  key={amt}
                  onClick={() => setTopUpAmount(amt)}
                  className={`py-2.5 rounded-xl text-[14px] font-bold transition-all border
                    ${topUpAmount === amt
                      ? 'bg-primary text-primary-foreground border-primary shadow-md shadow-primary/20 scale-[1.02]'
                      : 'bg-surface-2/40 text-muted-foreground border-transparent hover:bg-surface-2 hover:text-foreground'}`}
                >
                  {amt}
                </button>
              ))}
            </div>
            
            <button
              onClick={() => buyCredits(topUpAmount)}
              className="mt-auto w-full py-3 rounded-xl bg-foreground text-background font-bold text-[14px] hover:opacity-90 active:scale-[0.98] transition-all"
            >
              {t('buyAmount', { amount: topUpAmount })}
            </button>
          </GlassCard>

          {/* Usage chart */}
          <GlassCard className="p-6">
             <h2 className="text-[16px] font-bold text-foreground mb-5 flex items-center gap-2">
              <Activity className="w-5 h-5 text-primary" />
              {t('usageHistory')}
            </h2>
            <div className="h-[140px] opacity-90">
              <UsageChart data={usageData} limit={credits?.dailyFreeLimit ?? 50} />
            </div>
          </GlassCard>
        </div>

        {/* Plan selector */}
        <div className="pt-4">
          <div className="flex items-center gap-3 mb-6">
            <h2 className="text-xl font-bold text-foreground tracking-tight">{t('plans')}</h2>
            <div className="h-[1px] flex-1 bg-border/40" />
          </div>
          <PlanSelector />
        </div>
      </div>
    </div>
  );
}