import { create } from 'zustand';

export interface TeamMember {
  userId: string;
  name?: string;
  email: string;
  role: 'owner' | 'admin' | 'member';
  joinedAt: string;
}

export interface Team {
  id: string;
  name: string;
  ownerId: string;
  inviteCode?: string;
  memberCount: number;
  members: TeamMember[];
}

interface TeamState {
  team: Team | null;
  teams: Team[];
  loading: boolean;
  loadTeam: (teamId: string) => Promise<void>;
  loadTeams: () => Promise<void>;
  createTeam: (name: string) => Promise<Team>;
  generateInvite: (teamId: string) => Promise<{ inviteCode: string; inviteUrl: string }>;
  removeMember: (teamId: string, userId: string) => Promise<void>;
  updateRole: (teamId: string, userId: string, role: string) => Promise<void>;
}

export const useTeam = create<TeamState>((set, get) => ({
  team: null,
  teams: [],
  loading: false,

  loadTeam: async (teamId: string) => {
    set({ loading: true });
    try {
      const team = await window.jowork.invoke('team:get', teamId) as Team;
      set({ team });
    } finally {
      set({ loading: false });
    }
  },

  loadTeams: async () => {
    set({ loading: true });
    try {
      const teams = await window.jowork.invoke('team:list') as Team[];
      set({ teams });
    } catch {
      set({ teams: [] });
    } finally {
      set({ loading: false });
    }
  },

  createTeam: async (name: string) => {
    const team = await window.jowork.invoke('team:create', name) as Team;
    set((s) => ({ teams: [...s.teams, team] }));
    return team;
  },

  generateInvite: async (teamId: string) => {
    return await window.jowork.invoke('team:invite', teamId) as { inviteCode: string; inviteUrl: string };
  },

  removeMember: async (teamId: string, userId: string) => {
    await window.jowork.invoke('team:remove-member', teamId, userId);
    const { team } = get();
    if (team?.id === teamId) {
      set({
        team: {
          ...team,
          members: team.members.filter((m) => m.userId !== userId),
          memberCount: team.memberCount - 1,
        },
      });
    }
  },

  updateRole: async (teamId: string, userId: string, role: string) => {
    await window.jowork.invoke('team:update-role', teamId, userId, role);
    const { team } = get();
    if (team?.id === teamId) {
      set({
        team: {
          ...team,
          members: team.members.map((m) =>
            m.userId === userId ? { ...m, role: role as TeamMember['role'] } : m,
          ),
        },
      });
    }
  },
}));
