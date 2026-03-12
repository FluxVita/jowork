import { create } from 'zustand';

export interface ScheduledTaskInfo {
  id: string;
  name: string;
  cronExpression: string;
  timezone: string;
  type: 'scan' | 'skill' | 'notify';
  config: Record<string, unknown>;
  enabled: boolean;
  lastRunAt: number | null;
  nextRunAt: number | null;
  cloudSync: boolean;
  createdAt: number;
}

export interface TaskExecution {
  id: string;
  status: string;
  result: string | null;
  error: string | null;
  durationMs: number | null;
  executedAt: number;
}

interface SchedulerStore {
  tasks: ScheduledTaskInfo[];
  isLoading: boolean;
  executions: Record<string, TaskExecution[]>;

  loadTasks: () => Promise<void>;
  createTask: (task: Omit<ScheduledTaskInfo, 'id' | 'lastRunAt' | 'nextRunAt' | 'createdAt'>) => Promise<void>;
  updateTask: (id: string, patch: Partial<ScheduledTaskInfo>) => Promise<void>;
  deleteTask: (id: string) => Promise<void>;
  toggleTask: (id: string, enabled: boolean) => Promise<void>;
  loadExecutions: (taskId: string) => Promise<void>;
}

export const useSchedulerStore = create<SchedulerStore>((set, get) => ({
  tasks: [],
  isLoading: false,
  executions: {},

  loadTasks: async () => {
    set({ isLoading: true });
    try {
      const tasks = await window.jowork.scheduler.list();
      set({ tasks: tasks as ScheduledTaskInfo[], isLoading: false });
    } catch {
      set({ isLoading: false });
    }
  },

  createTask: async (task) => {
    const created = await window.jowork.scheduler.create(task) as ScheduledTaskInfo;
    set((s) => ({ tasks: [created, ...s.tasks] }));
  },

  updateTask: async (id, patch) => {
    const updated = await window.jowork.scheduler.update(id, patch) as ScheduledTaskInfo;
    set((s) => ({
      tasks: s.tasks.map((t) => (t.id === id ? updated : t)),
    }));
  },

  deleteTask: async (id) => {
    await window.jowork.scheduler.delete(id);
    set((s) => ({ tasks: s.tasks.filter((t) => t.id !== id) }));
  },

  toggleTask: async (id, enabled) => {
    await get().updateTask(id, { enabled });
  },

  loadExecutions: async (taskId) => {
    const execs = await window.jowork.scheduler.executions(taskId) as TaskExecution[];
    set((s) => ({
      executions: { ...s.executions, [taskId]: execs },
    }));
  },
}));
