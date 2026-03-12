import { useState } from 'react';
import { useTeam } from './hooks/useTeam';

interface InviteDialogProps {
  teamId: string;
  onClose: () => void;
}

export function InviteDialog({ teamId, onClose }: InviteDialogProps) {
  const { generateInvite } = useTeam();
  const [invite, setInvite] = useState<{ inviteCode: string; inviteUrl: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleGenerate = async () => {
    setLoading(true);
    try {
      const result = await generateInvite(teamId);
      setInvite(result);
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
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-surface rounded-lg p-6 w-full max-w-md mx-4">
        <h2 className="text-lg font-semibold mb-4">Invite Team Members</h2>

        {!invite ? (
          <div className="text-center py-4">
            <p className="text-sm text-text-secondary mb-4">
              Generate an invite link to share with your team members.
            </p>
            <button
              onClick={handleGenerate}
              disabled={loading}
              className="px-4 py-2 rounded-md bg-accent text-white text-sm font-medium hover:bg-accent/90 transition-colors disabled:opacity-50"
            >
              {loading ? 'Generating...' : 'Generate Invite Link'}
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="bg-surface-2 rounded-md p-3">
              <label className="text-xs text-text-secondary block mb-1">Invite URL</label>
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
                  {copied ? 'Copied!' : 'Copy'}
                </button>
              </div>
            </div>
            <p className="text-xs text-text-secondary">
              This link expires in 7 days. Anyone with this link can join the team.
            </p>
          </div>
        )}

        <div className="flex justify-end mt-4">
          <button
            onClick={onClose}
            className="text-sm text-text-secondary hover:text-text px-3 py-1.5"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
