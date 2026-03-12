import { useEffect, useState } from 'react';
import { useSchedulerStore, type ScheduledTaskInfo } from './hooks/useScheduler';
import { TaskCard } from './TaskCard';
import { TaskEditor } from './TaskEditor';
import { TaskHistory } from './TaskHistory';

export function SchedulerPage() {
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
    <div className="flex-1 p-8 overflow-y-auto">
      <div className="max-w-3xl">
        <div className="flex items-center justify-between mb-1">
          <h1 className="text-xl font-semibold">Scheduled Tasks</h1>
          <button
            onClick={() => {
              setEditingTask(undefined);
              setShowEditor(true);
            }}
            className="px-3 py-1.5 text-sm bg-accent text-white rounded-md hover:bg-accent/90 transition-colors"
          >
            + New Task
          </button>
        </div>
        <p className="text-sm text-text-secondary mb-4">
          Automate recurring tasks like data scans, skill execution, and notifications.
        </p>

        {showEditor && (
          <div className="mb-4 p-4 bg-surface-1 border border-border rounded-lg">
            <h2 className="text-sm font-medium mb-3">
              {editingTask ? 'Edit Task' : 'New Task'}
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
          <div className="mb-4">
            <TaskHistory
              executions={executions[historyTaskId]}
              onClose={() => setHistoryTaskId(null)}
            />
          </div>
        )}

        {isLoading ? (
          <p className="text-sm text-text-secondary">Loading...</p>
        ) : tasks.length === 0 ? (
          <div className="text-center py-12 text-text-secondary text-sm">
            <p>No scheduled tasks yet.</p>
            <p className="text-xs mt-1">Create one to automate your workflow.</p>
          </div>
        ) : (
          <div className="space-y-2">
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
