import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSchedulerStore, type ScheduledTaskInfo } from './hooks/useScheduler';
import { TaskCard } from './TaskCard';
import { TaskEditor } from './TaskEditor';
import { TaskHistory } from './TaskHistory';
import { CalendarClock, Plus } from 'lucide-react';

export function SchedulerPage() {
  const { t } = useTranslation('scheduler');
  const { t: tc } = useTranslation('common');
  const { tasks, isLoading, loadTasks, createTask, updateTask, deleteTask, toggleTask, executions, loadExecutions } = useSchedulerStore();
  const [showEditor, setShowEditor] = useState(false);
  const [editingTask, setEditingTask] = useState<ScheduledTaskInfo | undefined>();
  const [historyTaskId, setHistoryTaskId] = useState<string | null>(null);

  useEffect(() => {
    loadTasks();
  }, [loadTasks]);

  const handleEdit = (id: string) => {
    const task = tasks.find((t) => t.id === id);
    if (task) {
      setEditingTask(task);
      setShowEditor(true);
    }
  };

  const handleSave = async (data: Parameters<typeof createTask>[0]) => {
    if (editingTask) {
      await updateTask(editingTask.id, data);
    } else {
      await createTask(data);
    }
    setShowEditor(false);
    setEditingTask(undefined);
  };

  const handleViewHistory = (taskId: string) => {
    loadExecutions(taskId);
    setHistoryTaskId(taskId);
  };

  return (
    <div className="flex-1 p-10 overflow-y-auto custom-scrollbar animate-in fade-in duration-500">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-primary/10 text-primary">
              <CalendarClock className="w-6 h-6" />
            </div>
            <h1 className="text-3xl font-bold tracking-tight text-foreground">{t('title')}</h1>
          </div>
          <button
            onClick={() => {
              setEditingTask(undefined);
              setShowEditor(true);
            }}
            className="flex items-center gap-2 px-4 py-2.5 text-[14px] font-semibold bg-primary text-primary-foreground rounded-xl shadow-lg shadow-primary/20 hover:opacity-90 transition-all active:scale-95"
          >
            <Plus className="w-4 h-4" />
            {t('newTask')}
          </button>
        </div>
        <p className="text-[15px] text-muted-foreground mb-10 pl-1">
          {t('description')}
        </p>

        {showEditor && (
          <div className="mb-10 p-6 glass-effect border border-border/80 rounded-2xl animate-in slide-in-from-top-4 duration-300 shadow-xl">
            <h2 className="text-[16px] font-semibold text-foreground mb-5">
              {editingTask ? t('editTask') : t('newTask')}
            </h2>
            <TaskEditor
              initial={editingTask}
              onSave={handleSave}
              onCancel={() => {
                setShowEditor(false);
                setEditingTask(undefined);
              }}
            />
          </div>
        )}

        {historyTaskId && executions[historyTaskId] && (
          <div className="mb-10 glass-effect p-6 rounded-2xl border border-border/50 animate-in slide-in-from-bottom-4 duration-300">
            <TaskHistory
              executions={executions[historyTaskId]}
              onClose={() => setHistoryTaskId(null)}
            />
          </div>
        )}

        {isLoading ? (
          <div className="flex items-center gap-3 text-muted-foreground p-4">
            <span className="w-5 h-5 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
            <span className="text-[14px]">{tc('loading')}</span>
          </div>
        ) : tasks.length === 0 ? (
          <div className="text-center py-20 glass-effect rounded-2xl border border-dashed border-border/50">
            <CalendarClock className="w-12 h-12 text-muted-foreground/30 mx-auto mb-4" />
            <p className="text-[15px] text-foreground font-medium mb-1">{t('noTasks')}</p>
            <p className="text-[13px] text-muted-foreground">{t('noTasksHint')}</p>
          </div>
        ) : (
          <div className="space-y-4">
            {tasks.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                onEdit={handleEdit}
                onDelete={deleteTask}
                onToggle={toggleTask}
                onViewHistory={handleViewHistory}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}