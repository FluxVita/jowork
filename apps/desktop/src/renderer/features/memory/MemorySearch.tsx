import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useMemoryStore } from './hooks/useMemory';

export function MemorySearch() {
  const { t } = useTranslation('memory');
  const { searchQuery, setSearchQuery, search } = useMemoryStore();
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    debounceRef.current = setTimeout(() => {
      search(searchQuery);
    }, 300);
    return () => clearTimeout(debounceRef.current);
  }, [searchQuery, search]);

  return (
    <input
      type="text"
      value={searchQuery}
      onChange={(e) => setSearchQuery(e.target.value)}
      placeholder={t('searchMemories')}
      aria-label={t('searchMemories')}
      className="w-full px-3 py-2 text-sm bg-surface-2 border border-border rounded-md
        text-text-primary placeholder:text-text-secondary focus:outline-none focus:ring-1 focus:ring-accent"
    />
  );
}
