import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useConversationStore } from '../stores/conversation';
import { NAV_ITEMS } from '../constants/navigation';

interface SearchResult {
  type: 'page' | 'session' | 'message' | 'action';
  id: string;
  title: string;
  subtitle?: string;
  path?: string;
  sessionId?: string;
}

export function GlobalSearch({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation('common');
  const { t: tSidebar } = useTranslation('sidebar');
  const { t: tChat } = useTranslation('chat');
  const navigate = useNavigate();
  const sessions = useConversationStore((s) => s.sessions);
  const selectSession = useConversationStore((s) => s.selectSession);

  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [messageResults, setMessageResults] = useState<SearchResult[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  // Debounced message search
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setMessageResults([]);
      return;
    }
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const hits = await window.jowork.session.searchMessages(q, { limit: 8 });
        setMessageResults(hits.map((h) => ({
          type: 'message' as const,
          id: `msg:${h.messageId}`,
          title: h.snippet,
          subtitle: h.sessionTitle,
          sessionId: h.sessionId,
        })));
      } catch {
        setMessageResults([]);
      }
    }, 200);
    return () => clearTimeout(debounceRef.current);
  }, [query]);

  // Build results based on query
  const results: SearchResult[] = [];
  const q = query.toLowerCase().trim();

  // Pages
  NAV_ITEMS.forEach((p) => {
    const label = tSidebar(p.key);
    if (!q || label.toLowerCase().includes(q) || p.key.includes(q)) {
      results.push({ type: 'page', id: `page:${p.path}`, title: `${p.icon} ${label}`, path: p.path });
    }
  });

  // Sessions
  if (q) {
    sessions.filter((s) => s.title.toLowerCase().includes(q)).slice(0, 8).forEach((s) => {
      results.push({ type: 'session', id: `session:${s.id}`, title: s.title, subtitle: tChat('title') });
    });
  }

  // Messages (from async FTS search)
  if (q.length >= 2) {
    results.push(...messageResults);
  }

  // Focus input on open
  useEffect(() => {
    if (open) {
      setQuery('');
      setActiveIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  // Reset active index when results change
  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  const handleSelect = useCallback((result: SearchResult) => {
    onClose();
    if (result.type === 'page' && result.path) {
      navigate(result.path);
    } else if (result.type === 'session') {
      const sessionId = result.id.replace('session:', '');
      navigate('/');
      selectSession(sessionId);
    } else if (result.type === 'message' && result.sessionId) {
      navigate('/');
      selectSession(result.sessionId);
    }
  }, [navigate, selectSession, onClose]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && results[activeIndex]) {
      e.preventDefault();
      handleSelect(results[activeIndex]);
    } else if (e.key === 'Escape') {
      onClose();
    }
  }, [results, activeIndex, handleSelect, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[200] flex items-start justify-center pt-[20vh]" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div
        className="relative w-full max-w-lg bg-surface-1 border border-border rounded-xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search input */}
        <div className="flex items-center px-4 border-b border-border">
          <span className="text-text-secondary mr-2" aria-hidden="true">🔍</span>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('search') + '...'}
            className="flex-1 py-3 bg-transparent text-sm text-text-primary placeholder:text-text-secondary focus:outline-none"
            aria-label={t('search')}
          />
          <kbd className="text-xs font-mono px-1.5 py-0.5 bg-surface-2 border border-border rounded text-text-secondary" aria-label={t('close')}>
            Esc
          </kbd>
        </div>

        {/* Results */}
        <ul className="max-h-[300px] overflow-y-auto py-1" role="listbox">
          {results.length === 0 && (
            <li className="px-4 py-6 text-center text-sm text-text-secondary">{t('noResults')}</li>
          )}
          {results.map((r, i) => (
            <li
              key={r.id}
              role="option"
              aria-selected={i === activeIndex}
              onClick={() => handleSelect(r)}
              onMouseEnter={() => setActiveIndex(i)}
              className={`flex items-center justify-between px-4 py-2 cursor-pointer text-sm transition-colors
                ${i === activeIndex ? 'bg-accent/10 text-accent' : 'text-text-primary hover:bg-surface-2'}`}
            >
              <div className="flex-1 min-w-0">
                <span className={`truncate block ${r.type === 'message' ? 'text-xs' : ''}`}>{r.title}</span>
              </div>
              {r.subtitle && <span className="text-xs text-text-secondary ml-2 flex-shrink-0">{r.subtitle}</span>}
              {r.type === 'page' && <span className="text-xs text-text-secondary ml-2 flex-shrink-0">↵</span>}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
