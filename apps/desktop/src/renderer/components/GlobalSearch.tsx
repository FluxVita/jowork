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
    <div
      className="fixed inset-0 z-[200] flex items-start justify-center pt-[18vh] animate-[fadeIn_0.15s_ease-out]"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />

      {/* Modal */}
      <div
        className="glass relative w-full max-w-lg rounded-2xl overflow-hidden animate-[fadeScale_0.2s_cubic-bezier(0.2,0.8,0.2,1)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search input */}
        <div className="flex items-center px-4 border-b border-border/30">
          <svg className="w-4 h-4 text-text-secondary mr-2.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('search') + '...'}
            className="flex-1 py-3.5 bg-transparent text-[14px] text-text-primary placeholder:text-text-secondary/60 focus:outline-none"
            aria-label={t('search')}
          />
          <kbd className="text-[10px] font-medium px-1.5 py-0.5 bg-surface-2/60 border border-border/30 rounded-md text-text-secondary" aria-label={t('close')}>
            Esc
          </kbd>
        </div>

        {/* Results */}
        <ul className="max-h-[320px] overflow-y-auto py-1.5" role="listbox">
          {results.length === 0 && (
            <li className="px-4 py-8 text-center text-sm text-text-secondary">{t('noResults')}</li>
          )}
          {results.map((r, i) => (
            <li
              key={r.id}
              role="option"
              aria-selected={i === activeIndex}
              onClick={() => handleSelect(r)}
              onMouseEnter={() => setActiveIndex(i)}
              className={`flex items-center justify-between mx-1.5 px-3 py-2 cursor-pointer text-[13px] rounded-lg transition-all duration-150
                ${i === activeIndex
                  ? 'bg-accent/12 text-accent'
                  : 'text-text-primary hover:bg-surface-2/50'}`}
            >
              <div className="flex-1 min-w-0">
                <span className={`truncate block ${r.type === 'message' ? 'text-xs' : ''}`}>{r.title}</span>
              </div>
              {r.subtitle && <span className="text-[11px] text-text-secondary ml-2 flex-shrink-0">{r.subtitle}</span>}
              {r.type === 'page' && (
                <span className="text-[11px] text-text-secondary/50 ml-2 flex-shrink-0">↵</span>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
