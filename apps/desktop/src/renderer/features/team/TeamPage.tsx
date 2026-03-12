import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useTeam } from './hooks/useTeam';
import { useAuth } from '../auth/hooks/useAuth';
import { MemberList } from './MemberList';
import { InviteDialog } from './InviteDialog';
import { TeamSettings } from './TeamSettings';

export function TeamPage() {
  const { t } = useTranslation('team');
  const { team, teams, loading, loadTeam, loadTeams, createTeam } = useTeam();
  const { user, modeState, loginWithGoogle, switchToTeam } = useAuth();
  const [showInvite, setShowInvite] = useState(false);
  const [newTeamName, setNewTeamName] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (user) {
      loadTeams();
    }
  }, [user, loadTeams]);

  useEffect(() => {
    if (modeState?.teamId) {
      loadTeam(modeState.teamId);
    }
  }, [modeState?.teamId, loadTeam]);

  // Not logged in
  if (!user) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <h1 className="text-xl font-bold mb-4">{t('title')}</h1>
        <div className="bg-surface rounded-lg p-8 text-center">
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

  // No team selected — show team list / create
  if (!team) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <h1 className="text-xl font-bold mb-4">{t('title')}</h1>

        {/* Existing teams */}
        {teams.length > 0 && (
          <div className="mb-6">
            <h2 className="text-sm font-medium text-text-secondary mb-2">{t('yourTeams')}</h2>
            <div className="space-y-2">
              {teams.map((tm) => (
                <button
                  key={tm.id}
                  onClick={() => switchToTeam(tm.id, tm.name)}
                  className="w-full flex items-center justify-between bg-surface rounded-lg p-4 hover:bg-surface-2 transition-colors text-left"
                >
                  <div>
                    <div className="font-medium">{tm.name}</div>
                    <div className="text-xs text-text-secondary">{t('memberCount', { count: tm.memberCount })}</div>
                  </div>
                  <span className="text-accent text-sm">{t('switch')}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Create team */}
        <div className="bg-surface rounded-lg p-5">
          <h2 className="font-medium mb-3">{t('createTeam')}</h2>
          <div className="flex gap-2">
            <input
              value={newTeamName}
              onChange={(e) => setNewTeamName(e.target.value)}
              placeholder={t('teamName')}
              className="flex-1 bg-surface-2 border border-border rounded-md px-3 py-2 text-sm outline-none focus:border-accent"
            />
            <button
              onClick={async () => {
                if (!newTeamName.trim()) return;
                setCreating(true);
                try {
                  const created = await createTeam(newTeamName.trim());
                  await switchToTeam(created.id, created.name);
                  setNewTeamName('');
                } finally {
                  setCreating(false);
                }
              }}
              disabled={creating || !newTeamName.trim()}
              className="px-4 py-2 rounded-md bg-accent text-white text-sm font-medium hover:bg-accent/90 transition-colors disabled:opacity-50"
            >
              {creating ? t('creating') : t('common:create')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Team view
  const isOwner = team.ownerId === user.id;

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">{team.name}</h1>
          <p className="text-sm text-text-secondary">{t('memberCount', { count: team.memberCount })}</p>
        </div>
        <button
          onClick={() => setShowInvite(true)}
          className="px-4 py-2 rounded-md bg-accent text-white text-sm font-medium hover:bg-accent/90 transition-colors"
        >
          {t('invite')}
        </button>
      </div>

      {/* Members */}
      <div className="bg-surface rounded-lg p-5">
        <h2 className="font-medium mb-3">{t('members')}</h2>
        {loading ? (
          <p className="text-sm text-text-secondary py-4 text-center">{t('common:loading')}</p>
        ) : (
          <MemberList
            teamId={team.id}
            members={team.members}
            currentUserId={user.id}
            isOwner={isOwner}
          />
        )}
      </div>

      {/* Team settings (owner only) */}
      {isOwner && <TeamSettings team={team} />}

      {/* Invite dialog */}
      {showInvite && (
        <InviteDialog teamId={team.id} onClose={() => setShowInvite(false)} />
      )}
    </div>
  );
}
