import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useConnectorStore } from '../features/connectors/hooks/useConnectors';
import { useMemoryStore } from '../features/memory/hooks/useMemory';

export function ContextPanel() {
  const { t } = useTranslation();
  const connectors = useConnectorStore((s) => s.connectors);
  const loadConnectors = useConnectorStore((s) => s.loadConnectors);
  const memories = useMemoryStore((s) => s.memories);
  const loadMemories = useMemoryStore((s) => s.loadMemories);

  useEffect(() => {
    loadConnectors();
    loadMemories({ pinned: true, limit: 5 });
  }, [loadConnectors, loadMemories]);

  const activeConnectors = connectors.filter((c) => c.status === 'connected');
  const pinnedMemories = memories.filter((m) => m.pinned);

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* Connectors */}
      <section className="p-4 border-b border-border">
        <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-2">
          {t('context.connectors', { defaultValue: 'Connectors' })}
        </h3>
        {activeConnectors.length === 0 ? (
          <p className="text-xs text-text-secondary">
            {t('context.noConnectors', { defaultValue: 'No active connectors' })}
          </p>
        ) : (
          <ul className="space-y-1.5">
            {activeConnectors.map((c) => (
              <li key={c.id} className="flex items-center gap-2 text-xs">
                <span className="w-1.5 h-1.5 rounded-full bg-green-400 flex-shrink-0" />
                <span className="text-text-primary truncate">{c.name}</span>
                <span className="text-text-secondary ml-auto text-[10px]">{c.category}</span>
              </li>
            ))}
          </ul>
        )}
        {connectors.length > activeConnectors.length && (
          <p className="text-[10px] text-text-secondary mt-1.5">
            +{connectors.length - activeConnectors.length} {t('context.inactive', { defaultValue: 'inactive' })}
          </p>
        )}
      </section>

      {/* Pinned Memories */}
      <section className="p-4 border-b border-border">
        <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-2">
          {t('context.pinnedMemories', { defaultValue: 'Pinned Memories' })}
        </h3>
        {pinnedMemories.length === 0 ? (
          <p className="text-xs text-text-secondary">
            {t('context.noMemories', { defaultValue: 'No pinned memories' })}
          </p>
        ) : (
          <ul className="space-y-2">
            {pinnedMemories.slice(0, 5).map((m) => (
              <li key={m.id} className="text-xs">
                <div className="font-medium text-text-primary truncate">{m.title}</div>
                <div className="text-text-secondary line-clamp-2 mt-0.5">{m.content}</div>
                {m.tags.length > 0 && (
                  <div className="flex gap-1 mt-1 flex-wrap">
                    {m.tags.slice(0, 3).map((tag) => (
                      <span key={tag} className="px-1.5 py-0.5 rounded bg-surface-2 text-[10px] text-text-secondary">
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Recent Memories */}
      {memories.filter((m) => !m.pinned).length > 0 && (
        <section className="p-4">
          <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-2">
            {t('context.recentMemories', { defaultValue: 'Recent' })}
          </h3>
          <ul className="space-y-1.5">
            {memories.filter((m) => !m.pinned).slice(0, 5).map((m) => (
              <li key={m.id} className="text-xs text-text-secondary truncate">
                {m.title}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
