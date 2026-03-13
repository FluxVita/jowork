import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useTeam } from './hooks/useTeam';

interface InviteDialogProps {
  teamId: string;
  onClose: () => void;
}

export function InviteDialog({ teamId, onClose }: InviteDialogProps) {
  const { t } = useTranslation('team');
  const { t: tc } = useTranslation('common');
  const { generateInvite } = useTeam();
  const [invite, setInvite] = useState<{ inviteCode: string; inviteUrl: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  // Escape key to close
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const handleGenerate = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await generateInvite(teamId);
      setInvite(result);
    } catch {
      setError(t('inviteError', 'Failed to generate invite link'));
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    if (!invite) return;
    await navigator.clipboard.writeText(invite.inviteUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div ref={dialogRef} className="bg-surface-1 rounded-lg p-6 w-full max-w-md mx-4" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <h2 className="text-lg font-semibold mb-4">{t('inviteTitle')}</h2>

        {!invite ? (
          <div className="text-center py-4">
            <p className="text-sm text-text-secondary mb-4">
              {t('inviteDescription')}
            </p>
            <button
              onClick={handleGenerate}
              disabled={loading}
              className="px-4 py-2 rounded-md bg-accent text-white text-sm font-medium hover:bg-accent/90 transition-colors disabled:opacity-50"
            >
              {loading ? t('generating') : t('generateInviteLink')}
            </button>
            {error && <p className="text-xs text-red-400 mt-2">{error}</p>}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="bg-surface-2 rounded-md p-3">
              <label className="text-xs text-text-secondary block mb-1">{t('inviteUrl')}</label>
              <div className="flex gap-2">
                <input
                  readOnly
                  value={invite.inviteUrl}
                  className="flex-1 bg-transparent text-sm outline-none"
                />
                <button
                  onClick={handleCopy}
                  className="text-xs px-2 py-1 rounded bg-accent/10 text-accent hover:bg-accent/20 transition-colors"
                >
                  {copied ? t('linkCopied') : t('copyLink')}
                </button>
              </div>
            </div>
            <p className="text-xs text-text-secondary">
              {t('inviteExpiry')}
            </p>
          </div>
        )}

        <div className="flex justify-end mt-4">
          <button
            onClick={onClose}
            className="text-sm text-text-secondary hover:text-text px-3 py-1.5"
          >
            {tc('close')}
          </button>
        </div>
      </div>
    </div>
  );
}
