import { create } from 'zustand';

export interface SkillInfo {
  id: string;
  name: string;
  description: string;
  source: 'claude-code' | 'openclaw' | 'jowork' | 'community';
  trigger: string;
  type: 'simple' | 'workflow';
  variables?: Array<{
    name: string;
    label: string;
    type: 'text' | 'select' | 'multiline';
    required?: boolean;
    default?: string;
    options?: string[];
  }>;
}

export type SkillDraft = Omit<SkillInfo, 'id' | 'source'> & { promptTemplate?: string; steps?: Array<{ id: string; prompt: string; condition?: string; outputVar?: string }> };

interface SkillStore {
  skills: SkillInfo[];
  isLoading: boolean;
  activeSkill: SkillInfo | null;
  isRunning: boolean;

  loadSkills: () => Promise<void>;
  selectSkill: (skill: SkillInfo | null) => void;
  runSkill: (skillId: string, vars: Record<string, string>, sessionId?: string) => Promise<void>;
  saveSkill: (draft: SkillDraft) => Promise<void>;
  deleteSkill: (skillId: string) => Promise<void>;
}

export const useSkillStore = create<SkillStore>((set, get) => ({
  skills: [],
  isLoading: false,
  activeSkill: null,
  isRunning: false,

  loadSkills: async () => {
    set({ isLoading: true });
    try {
      const skills = await window.jowork.skill.list();
      set({ skills: skills as SkillInfo[], isLoading: false });
    } catch {
      set({ isLoading: false });
    }
  },

  selectSkill: (skill) => set({ activeSkill: skill }),

  runSkill: async (skillId, vars, sessionId) => {
    set({ isRunning: true });
    try {
      await window.jowork.skill.run(skillId, vars, sessionId);
    } finally {
      set({ isRunning: false });
    }
  },

  saveSkill: async (draft) => {
    await window.jowork.skill.save(draft);
    await get().loadSkills();
  },

  deleteSkill: async (skillId) => {
    await window.jowork.skill.delete(skillId);
    set((s) => ({
      skills: s.skills.filter((sk) => sk.id !== skillId),
      activeSkill: s.activeSkill?.id === skillId ? null : s.activeSkill,
    }));
  },
}));
