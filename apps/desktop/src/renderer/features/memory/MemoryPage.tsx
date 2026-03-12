import { useEffect, useState } from 'react';
import { useMemoryStore } from './hooks/useMemory';
import { MemorySearch } from './MemorySearch';
import { MemoryCard } from './MemoryCard';
import { MemoryEditor } from './MemoryEditor';
import type { NewMemory, MemoryRecord } from './hooks/useMemory';

export function MemoryPage() {
  const { memories, isLoading, loadMemories, create, update, remove, togglePin } = useMemoryStore();
  const [showEditor, setShowEditor] = useState(false);
  const [editingMemory, setEditingMemory] = useState<MemoryRecord | undefined>();

  useEffect(() => {
    loadMemories();
  }, [loadMemories]);

  const handleEdit = (id: string) => {
    const mem = memories.find((m) => m.id === id);
    if (mem) {
      setEditingMemory(mem);
      setShowEditor(true);
    }
  };

  const handleSave = async (data: NewMemory) => {
    if (editingMemory) {
      await update(editingMemory.id, data);
    } else {
      await create(data);
    }
    setShowEditor(false);
    setEditingMemory(undefined);
  };

  const handleCancel = () => {
    setShowEditor(false);
    setEditingMemory(undefined);
  };

  const pinned = memories.filter((m) => m.pinned);
  const unpinned = memories.filter((m) => !m.pinned);

  return (
    <div className="flex-1 p-8 overflow-y-auto">
      <div className="max-w-3xl">
        <div className="flex items-center justify-between mb-1">
          <h1 className="text-xl font-semibold">Memories</h1>
          <button
            onClick={() => {
              setEditingMemory(undefined);
              setShowEditor(true);
            }}
            className="px-3 py-1.5 text-sm bg-accent text-white rounded-md hover:bg-accent/90 transition-colors"
          >
            + New
          </button>
        </div>
        <p className="text-sm text-text-secondary mb-4">
          Things the AI remembers about you across conversations.
        </p>

        <div className="mb-4">
          <MemorySearch />
        </div>

        {showEditor && (
          <div className="mb-4 p-4 bg-surface-1 border border-border rounded-lg">
            <h2 className="text-sm font-medium mb-3">
              {editingMemory ? 'Edit Memory' : 'New Memory'}
            </h2>
            <MemoryEditor
              initial={editingMemory}
              onSave={handleSave}
              onCancel={handleCancel}
            />
          </div>
        )}

        {isLoading ? (
          <p className="text-sm text-text-secondary">Loading...</p>
        ) : (
          <>
            {pinned.length > 0 && (
              <section className="mb-6">
                <h2 className="text-sm font-medium text-text-secondary mb-2">Pinned</h2>
                <div className="space-y-2">
                  {pinned.map((m) => (
                    <MemoryCard
                      key={m.id}
                      memory={m}
                      onEdit={handleEdit}
                      onDelete={remove}
                      onTogglePin={togglePin}
                    />
                  ))}
                </div>
              </section>
            )}

            <section>
              {pinned.length > 0 && (
                <h2 className="text-sm font-medium text-text-secondary mb-2">All Memories</h2>
              )}
              {unpinned.length === 0 && pinned.length === 0 ? (
                <div className="text-center py-12 text-text-secondary text-sm">
                  <p>No memories yet.</p>
                  <p className="text-xs mt-1">Create one manually or let AI learn from conversations.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {unpinned.map((m) => (
                    <MemoryCard
                      key={m.id}
                      memory={m}
                      onEdit={handleEdit}
                      onDelete={remove}
                      onTogglePin={togglePin}
                    />
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}
