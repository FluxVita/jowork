import type { MemoryRecord } from './hooks/useMemory';

interface Props {
  memory: MemoryRecord;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  onTogglePin: (id: string, pinned: boolean) => void;
}

export function MemoryCard({ memory, onEdit, onDelete, onTogglePin }: Props) {
  return (
    <div className="group p-3 bg-surface-2 border border-border rounded-lg hover:border-accent/30 transition-colors">
      <div className="flex items-start justify-between gap-2 mb-1">
        <h3 className="text-sm font-medium text-text-primary truncate flex-1">{memory.title}</h3>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={() => onTogglePin(memory.id, !memory.pinned)}
            className="p-1 text-xs text-text-secondary hover:text-accent"
            title={memory.pinned ? 'Unpin' : 'Pin'}
          >
            {memory.pinned ? '📌' : '📍'}
          </button>
          <button
            onClick={() => onEdit(memory.id)}
            className="p-1 text-xs text-text-secondary hover:text-accent"
          >
            Edit
          </button>
          <button
            onClick={() => onDelete(memory.id)}
            className="p-1 text-xs text-text-secondary hover:text-red-400"
          >
            Del
          </button>
        </div>
      </div>

      <p className="text-xs text-text-secondary line-clamp-2 mb-2">{memory.content}</p>

      <div className="flex items-center gap-2 flex-wrap">
        {memory.tags.map((tag) => (
          <span key={tag} className="text-[10px] px-1.5 py-0.5 bg-accent/10 text-accent rounded">
            {tag}
          </span>
        ))}
        <span className="text-[10px] text-text-secondary ml-auto">
          {memory.source === 'auto' ? 'Auto' : 'Manual'}
        </span>
      </div>
    </div>
  );
}
