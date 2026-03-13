import { useTranslation } from 'react-i18next';
import { GlassCard } from '../../components/ui/glass-card';
import { Pin, PinOff, Edit2, Trash2, Bot, User } from 'lucide-react';
import type { MemoryRecord } from './hooks/useMemory';

interface Props {
  memory: MemoryRecord;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  onTogglePin: (id: string, pinned: boolean) => void;
}

export function MemoryCard({ memory, onEdit, onDelete, onTogglePin }: Props) {
  const { t } = useTranslation('memory');
  const { t: tc } = useTranslation('common');

  return (
    <GlassCard className="group p-4 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-4">
        <h3 className="text-[15px] font-semibold text-foreground leading-snug line-clamp-1">{memory.title}</h3>
        <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
          <button
            onClick={() => onTogglePin(memory.id, !memory.pinned)}
            className={`p-1.5 rounded-lg transition-colors ${memory.pinned ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-surface-2 hover:text-primary'}`}
            aria-label={memory.pinned ? t('unpin') : t('pin')}
          >
            {memory.pinned ? <PinOff className="w-3.5 h-3.5" /> : <Pin className="w-3.5 h-3.5" />}
          </button>
          <button
            onClick={() => onEdit(memory.id)}
            className="p-1.5 text-muted-foreground hover:bg-surface-2 hover:text-foreground rounded-lg transition-colors"
            aria-label={tc('edit')}
          >
            <Edit2 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => onDelete(memory.id)}
            className="p-1.5 text-muted-foreground hover:bg-red-500/10 hover:text-red-500 rounded-lg transition-colors"
            aria-label={tc('delete')}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <p className="text-[13px] text-muted-foreground/90 line-clamp-2 leading-relaxed flex-1">{memory.content}</p>

      <div className="flex items-center justify-between pt-3 border-t border-border/40">
        <div className="flex items-center gap-2 flex-wrap">
          {memory.tags.map((tag) => (
            <span key={tag} className="text-[10px] px-2 py-0.5 bg-primary/10 text-primary border border-primary/20 rounded-full font-medium">
              {tag}
            </span>
          ))}
        </div>
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground bg-surface-2/40 px-2 py-1 rounded-md">
          {memory.source === 'auto' ? <Bot className="w-3 h-3" /> : <User className="w-3 h-3" />}
          {memory.source === 'auto' ? t('sourceAuto') : t('sourceManual')}
        </div>
      </div>
    </GlassCard>
  );
}
