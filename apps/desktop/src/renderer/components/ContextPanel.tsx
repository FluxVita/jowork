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
      <section className="p-4 border-b border-border/30">
        <h3 className="text-[11px] font-semibold text-text-secondary/60 uppercase tracking-wider mb-2.5">
          {t('contextConnectors')}
        </h3>
        {activeConnectors.length === 0 ? (
          <p className="text-[12px] text-text-secondary/50">
            {t('contextNoConnectors')}
          </p>
        ) : (
          <ul className="space-y-2">
            {activeConnectors.map((c) => (
              <li key={c.id} className="flex items-center gap-2.5 text-[12px]">
                <span className="w-[6px] h-[6px] rounded-full bg-green-500 flex-shrink-0" />
                <span className="text-text-primary truncate">{c.name}</span>
                <span className="text-text-secondary/50 ml-auto text-[10px]">{c.category}</span>
              </li>
            ))}
          </ul>
        )}
        {connectors.length > activeConnectors.length && (
          <p className="text-[10px] text-text-secondary/40 mt-2">
            +{connectors.length - activeConnectors.length} {t('contextInactive')}
          </p>
        )}
      </section>

      {/* Pinned Memories */}
      <section className="p-4 border-b border-border/30">
        <h3 className="text-[11px] font-semibold text-text-secondary/60 uppercase tracking-wider mb-2.5">
          {t('contextPinnedMemories')}
        </h3>
        {pinnedMemories.length === 0 ? (
          <p className="text-[12px] text-text-secondary/50">
            {t('contextNoMemories')}
          </p>
        ) : (
          <ul className="space-y-2.5">
            {pinnedMemories.slice(0, 5).map((m) => (
              <li key={m.id} className="text-[12px]">
                <div className="font-medium text-text-primary truncate">{m.title}</div>
                <div className="text-text-secondary/60 line-clamp-2 mt-0.5 leading-relaxed">{m.content}</div>
                {m.tags.length > 0 && (
                  <div className="flex gap-1 mt-1.5 flex-wrap">
                    {m.tags.slice(0, 3).map((tag) => (
                      <span key={tag} className="px-1.5 py-0.5 rounded-md bg-surface-2/60 text-[10px] text-text-secondary/60">
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
      {(() => {
        const unpinned = memories.filter((m) => !m.pinned);
        if (unpinned.length === 0) return null;
        return (
          <section className="p-4">
            <h3 className="text-[11px] font-semibold text-text-secondary/60 uppercase tracking-wider mb-2.5">
              {t('contextRecent')}
            </h3>
            <ul className="space-y-2">
              {unpinned.slice(0, 5).map((m) => (
                <li key={m.id} className="text-[12px] text-text-secondary/60 truncate">
                  {m.title}
                </li>
              ))}
            </ul>
          </section>
        );
      })()}
    </div>
  );
}
