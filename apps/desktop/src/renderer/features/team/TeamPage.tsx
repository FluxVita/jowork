import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useTeam } from './hooks/useTeam';
import { useAuth } from '../auth/hooks/useAuth';
import { MemberList } from './MemberList';
import { InviteDialog } from './InviteDialog';
import { TeamSettings } from './TeamSettings';
import { Users, Plus, ArrowRight, ShieldAlert } from 'lucide-react';
import { GlassCard } from '../../components/ui/glass-card';

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
      <div className="flex-1 p-10 overflow-y-auto custom-scrollbar">
        <div className="max-w-2xl mx-auto text-center py-20">
          <GlassCard className="p-10 flex flex-col items-center">
            <div className="w-16 h-16 bg-primary/10 rounded-2xl flex items-center justify-center text-primary mb-6">
              <Users className="w-8 h-8" />
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

  // No team selected — show team list / create
  if (!team) {
    return (
      <div className="flex-1 p-10 overflow-y-auto custom-scrollbar animate-in fade-in duration-500">
        <div className="max-w-3xl mx-auto">
          <div className="flex items-center gap-3 mb-8">
            <div className="p-2.5 rounded-xl bg-primary/10 text-primary">
              <Users className="w-6 h-6" />
            </div>
            <h1 className="text-3xl font-bold tracking-tight text-foreground">{t('title')}</h1>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {/* Create team */}
            <GlassCard className="p-6 flex flex-col border-primary/20 shadow-[0_8px_32px_rgba(var(--primary),0.05)]">
              <h2 className="text-[18px] font-bold mb-2">{t('createTeam')}</h2>
              <p className="text-[13px] text-muted-foreground mb-6">Create a new workspace for your organization.</p>
              
              <div className="mt-auto space-y-3">
                <input
                  value={newTeamName}
                  onChange={(e) => setNewTeamName(e.target.value)}
                  placeholder={t('teamName')}
                  aria-label={t('teamName')}
                  className="w-full bg-background/50 border border-border/60 rounded-xl px-4 py-3 text-[14px] text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all"
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
                  className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-primary text-primary-foreground font-bold shadow-md shadow-primary/20 hover:opacity-90 transition-all disabled:opacity-50 disabled:shadow-none"
                >
                  <Plus className="w-4 h-4" />
                  {creating ? t('creating') : t('common:create')}
                </button>
              </div>
            </GlassCard>

            {/* Existing teams */}
            {teams.length > 0 && (
              <div className="flex flex-col">
                <h2 className="text-[16px] font-bold text-foreground mb-4">{t('yourTeams')}</h2>
                <div className="space-y-3 flex-1 overflow-y-auto custom-scrollbar pr-2">
                  {teams.map((tm) => (
                    <button
                      key={tm.id}
                      onClick={() => switchToTeam(tm.id, tm.name)}
                      className="w-full flex items-center justify-between glass-effect rounded-xl p-4 border border-border/40 hover:border-primary/40 hover:shadow-lg hover:shadow-primary/5 transition-all group"
                    >
                      <div className="text-left">
                        <div className="font-bold text-[15px] group-hover:text-primary transition-colors">{tm.name}</div>
                        <div className="text-[12px] font-medium text-muted-foreground mt-0.5">{t('memberCount', { count: tm.memberCount })}</div>
                      </div>
                      <div className="w-8 h-8 rounded-full bg-surface-2/50 flex items-center justify-center text-muted-foreground group-hover:bg-primary/10 group-hover:text-primary transition-all">
                        <ArrowRight className="w-4 h-4" />
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Team view
  const isOwner = team.ownerId === user.id;

  return (
    <div className="flex-1 p-10 overflow-y-auto custom-scrollbar animate-in fade-in duration-500">
      <div className="max-w-4xl mx-auto space-y-8">
        
        <GlassCard className="p-6 relative overflow-hidden border-primary/20">
          <div className="absolute top-0 right-0 p-12 opacity-5 pointer-events-none">
            <Users className="w-40 h-40" />
          </div>
          <div className="relative z-10 flex items-center justify-between">
            <div>
              <div className="flex items-center gap-3 mb-1">
                <h1 className="text-3xl font-black tracking-tight">{team.name}</h1>
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold tracking-widest uppercase bg-surface-2/50 border border-border/50 text-muted-foreground">Team</span>
              </div>
              <p className="text-[14px] text-muted-foreground font-medium">{t('memberCount', { count: team.memberCount })}</p>
            </div>
            <button
              onClick={() => setShowInvite(true)}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-primary-foreground font-bold shadow-lg shadow-primary/20 hover:opacity-90 transition-all active:scale-95"
            >
              <Plus className="w-4 h-4" />
              {t('invite')}
            </button>
          </div>
        </GlassCard>

        {/* Members */}
        <div>
          <div className="flex items-center gap-3 mb-5">
            <h2 className="text-xl font-bold tracking-tight text-foreground">{t('members')}</h2>
            <div className="h-[1px] flex-1 bg-border/40" />
          </div>
          <GlassCard className="p-2 border-border/50">
            {loading ? (
              <p className="text-[14px] text-muted-foreground py-8 text-center animate-pulse">{t('common:loading')}</p>
            ) : (
              <MemberList
                teamId={team.id}
                members={team.members}
                currentUserId={user.id}
                isOwner={isOwner}
              />
            )}
          </GlassCard>
        </div>

        {/* Team settings (owner only) */}
        {isOwner && (
          <div className="pt-4">
             <div className="flex items-center gap-3 mb-5">
              <h2 className="text-xl font-bold tracking-tight text-foreground flex items-center gap-2">
                <ShieldAlert className="w-5 h-5 text-muted-foreground" />
                Settings
              </h2>
              <div className="h-[1px] flex-1 bg-border/40" />
            </div>
            <TeamSettings team={team} />
          </div>
        )}

        {/* Invite dialog */}
        {showInvite && (
          <InviteDialog teamId={team.id} onClose={() => setShowInvite(false)} />
        )}
      </div>
    </div>
  );
}