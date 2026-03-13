import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { GlassCard } from '../../components/ui/glass-card';
import { Settings2, Unplug, Zap } from 'lucide-react';

interface ConnectorCardProps {
  id: string;
  name: string;
  description: string;
  category: string;
  tier: string;
  status: 'connected' | 'disconnected' | 'error';
  hasCredential: boolean;
  onConnect: (id: string, credential?: Record<string, string>) => void;
  onDisconnect: (id: string) => void;
}

const STATUS_COLORS = {
  connected: 'bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.4)]',
  disconnected: 'bg-muted-foreground/40',
  error: 'bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.4)]',
} as const;

export function ConnectorCard({
  id, name, description, category, tier, status, hasCredential,
  onConnect, onDisconnect,
}: ConnectorCardProps) {
  const { t } = useTranslation('connectors');
  const [tokenInput, setTokenInput] = useState('');
  const [showConfig, setShowConfig] = useState(false);

  const tierBadge = (t: string) => {
    const map: Record<string, string | null> = { ga: null, beta: 'tierBeta', planned: 'tierPlanned' };
    return map[t] ?? null;
  };

  const badgeKey = tierBadge(tier);

  const handleConnect = () => {
    if (!hasCredential && showConfig) {
      if (!tokenInput.trim()) return;
      onConnect(id, { accessToken: tokenInput.trim() });
      setTokenInput('');
      setShowConfig(false);
    } else {
      onConnect(id);
    }
  };

  return (
    <GlassCard className="p-5 flex flex-col h-full group">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className="relative flex items-center justify-center">
            <span className={`w-2.5 h-2.5 rounded-full ${STATUS_COLORS[status]} transition-all duration-300`} />
            {status === 'connected' && (
              <span className="absolute w-2.5 h-2.5 rounded-full bg-emerald-500 animate-ping opacity-75" />
            )}
          </div>
          <h3 className="font-semibold text-[15px] text-foreground tracking-tight group-hover:text-primary transition-colors">{name}</h3>
          {badgeKey && (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium border border-primary/20">
              {t(badgeKey)}
            </span>
          )}
        </div>
        <span className="text-[10px] text-muted-foreground uppercase font-medium tracking-wider bg-surface-2/30 px-2 py-1 rounded-md">{category}</span>
      </div>

      <p className="text-[13px] text-muted-foreground/90 leading-relaxed mb-5 flex-1">{description}</p>

      {showConfig && !hasCredential && (
        <div className="mb-4 animate-in fade-in slide-in-from-top-2 duration-200">
          <input
            type="password"
            value={tokenInput}
            onChange={(e) => setTokenInput(e.target.value)}
            placeholder={t('tokenPlaceholder')}
            aria-label={t('tokenPlaceholder')}
            className="w-full bg-background/50 border border-border rounded-xl px-3 py-2 text-[13px] text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all"
          />
        </div>
      )}

      <div className="flex gap-2.5 mt-auto pt-4 border-t border-border/40">
        {status === 'disconnected' ? (
          <>
            {!hasCredential && !showConfig ? (
              <button
                onClick={() => setShowConfig(true)}
                className="flex-1 flex items-center justify-center gap-1.5 text-[13px] px-4 py-2 rounded-xl bg-surface-2/50 text-foreground hover:bg-surface-2 hover:text-primary transition-all duration-200 border border-transparent hover:border-border/50"
              >
                <Settings2 className="w-3.5 h-3.5" />
                {t('configure')}
              </button>
            ) : (
              <button
                onClick={handleConnect}
                className="flex-1 flex items-center justify-center gap-1.5 text-[13px] px-4 py-2 rounded-xl bg-primary text-primary-foreground font-medium shadow-md shadow-primary/20 hover:opacity-90 active:scale-[0.98] transition-all duration-200"
              >
                <Zap className="w-3.5 h-3.5" />
                {t('connect')}
              </button>
            )}
          </>
        ) : (
          <button
            onClick={() => onDisconnect(id)}
            className="flex-1 flex items-center justify-center gap-1.5 text-[13px] px-4 py-2 rounded-xl bg-surface-2/40 text-muted-foreground hover:bg-red-500/10 hover:text-red-500 transition-all duration-200"
          >
            <Unplug className="w-3.5 h-3.5" />
            {t('disconnect')}
          </button>
        )}
      </div>
    </GlassCard>
  );
}
