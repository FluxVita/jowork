import { useTranslation } from 'react-i18next';
import { useTeam, type TeamMember } from './hooks/useTeam';

interface MemberListProps {
  teamId: string;
  members: TeamMember[];
  currentUserId?: string;
  isOwner: boolean;
}

export function MemberList({ teamId, members, currentUserId, isOwner }: MemberListProps) {
  const { t } = useTranslation('team');
  const { removeMember, updateRole } = useTeam();

  const roleLabel = (role: string) => {
    switch (role) {
      case 'owner': return t('owner');
      case 'admin': return t('admin');
      default: return t('member');
    }
  };

  return (
    <div className="space-y-1">
      {members.map((m) => (
        <div
          key={m.userId}
          className="flex items-center justify-between px-3 py-2 rounded-md hover:bg-surface-2 transition-colors"
        >
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-accent/10 text-accent flex items-center justify-center text-sm font-medium">
              {(m.name || m.email)[0].toUpperCase()}
            </div>
            <div>
              <div className="text-sm font-medium">{m.name || m.email}</div>
              <div className="text-xs text-text-secondary">{m.email}</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span
              className={`text-xs px-2 py-0.5 rounded ${
                m.role === 'owner'
                  ? 'bg-accent/10 text-accent'
                  : 'bg-surface-2 text-text-secondary'
              }`}
            >
              {roleLabel(m.role)}
            </span>
            {isOwner && m.userId !== currentUserId && m.role !== 'owner' && (
              <div className="flex items-center gap-1">
                <select
                  value={m.role}
                  onChange={(e) => updateRole(teamId, m.userId, e.target.value)}
                  className="text-xs bg-surface-2 border border-border rounded px-1 py-0.5"
                >
                  <option value="member">{t('member')}</option>
                  <option value="admin">{t('admin')}</option>
                </select>
                <button
                  onClick={() => removeMember(teamId, m.userId)}
                  className="text-xs text-red-500 hover:text-red-400 ml-1"
                >
                  {t('remove')}
                </button>
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
