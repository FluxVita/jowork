import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMemoryStore } from './hooks/useMemory';
import { MemorySearch } from './MemorySearch';
import { MemoryCard } from './MemoryCard';
import { MemoryEditor } from './MemoryEditor';
import { BrainCircuit, Plus } from 'lucide-react';
import type { NewMemory, MemoryRecord } from './hooks/useMemory';

export function MemoryPage() {
  const { t } = useTranslation('memory');
  const { t: tc } = useTranslation('common');
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
    <div className="flex-1 p-10 overflow-y-auto custom-scrollbar animate-in fade-in duration-500">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-primary/10 text-primary">
              <BrainCircuit className="w-6 h-6" />
            </div>
            <h1 className="text-3xl font-bold tracking-tight text-foreground">{t('title')}</h1>
          </div>
          <button
            onClick={() => {
              setEditingMemory(undefined);
              setShowEditor(true);
            }}
            className="flex items-center gap-1.5 px-4 py-2 text-[14px] font-medium bg-primary text-primary-foreground rounded-xl shadow-md shadow-primary/20 hover:opacity-90 transition-all active:scale-95"
          >
            <Plus className="w-4 h-4" />
            {t('new')}
          </button>
        </div>
        <p className="text-[15px] text-muted-foreground mb-8 pl-1">
          {t('description')}
        </p>

        <div className="mb-8">
          <MemorySearch />
        </div>

        {showEditor && (
          <div className="mb-8 p-5 glass-effect border border-border/80 rounded-2xl animate-in slide-in-from-top-4 duration-300 shadow-xl">
            <h2 className="text-[15px] font-semibold text-foreground mb-4">
              {editingMemory ? t('editMemory') : t('newMemory')}
            </h2>
            <MemoryEditor
              initial={editingMemory}
              onSave={handleSave}
              onCancel={handleCancel}
            />
          </div>
        )}

        {isLoading ? (
          <div className="flex items-center gap-3 text-muted-foreground p-4">
            <span className="w-5 h-5 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
            <span className="text-[14px]">{tc('loading')}</span>
          </div>
        ) : (
          <div className="space-y-10">
            {pinned.length > 0 && (
              <section>
                <div className="flex items-center gap-3 mb-5">
                  <h2 className="text-lg font-semibold text-foreground tracking-tight">{t('pinned')}</h2>
                  <div className="h-[1px] flex-1 bg-border/40" />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
                <div className="flex items-center gap-3 mb-5">
                  <h2 className="text-lg font-semibold text-foreground tracking-tight">{t('allMemories')}</h2>
                  <div className="h-[1px] flex-1 bg-border/40" />
                </div>
              )}
              {unpinned.length === 0 && pinned.length === 0 ? (
                <div className="text-center py-16 px-4 glass-effect rounded-2xl border border-dashed border-border/50">
                  <BrainCircuit className="w-12 h-12 text-muted-foreground/30 mx-auto mb-4" />
                  <p className="text-[15px] text-foreground font-medium mb-1">{t('noMemories')}</p>
                  <p className="text-[13px] text-muted-foreground">{t('noMemoriesHint')}</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 opacity-90 hover:opacity-100 transition-opacity">
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
          </div>
        )}
      </div>
    </div>
  );
}
