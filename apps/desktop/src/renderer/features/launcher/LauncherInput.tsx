import { useRef, useEffect, useState, useCallback, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useLauncherStore } from './hooks/useLauncher';

interface SkillItem {
  id: string;
  name: string;
  description?: string;
  trigger?: string;
}

export function LauncherInput() {
  const { t } = useTranslation('chat');
  const { query, setQuery, submit, isStreaming } = useLauncherStore();
  const inputRef = useRef<HTMLInputElement>(null);
  const [skills, setSkills] = useState<SkillItem[]>([]);
  const [showSkills, setShowSkills] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState(0);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Fetch skills when user types '/'
  useEffect(() => {
    if (query.startsWith('/') && query.length <= 30) {
      window.jowork.skill.list()
        .then((list: unknown) => {
          if (Array.isArray(list)) setSkills(list as SkillItem[]);
        })
        .catch(() => {});
      setShowSkills(true);
      setSelectedIdx(0);
    } else {
      setShowSkills(false);
    }
  }, [query]);

  // Filter skills by partial input after '/'
  const filterText = query.startsWith('/') ? query.slice(1).toLowerCase() : '';
  const filteredSkills = showSkills
    ? skills.filter((s) =>
        s.name.toLowerCase().includes(filterText)
        || (s.trigger && s.trigger.toLowerCase().includes(filterText))
        || (s.description && s.description.toLowerCase().includes(filterText))
      ).slice(0, 8)
    : [];

  const selectSkill = useCallback((skill: SkillItem) => {
    const trigger = skill.trigger || `/${skill.name}`;
    setQuery(trigger.startsWith('/') ? trigger : `/${trigger}`);
    setShowSkills(false);
    inputRef.current?.focus();
  }, [setQuery]);

  const handleKeyDown = (e: KeyboardEvent) => {
    // Skill autocomplete navigation
    if (showSkills && filteredSkills.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIdx((i) => Math.min(i + 1, filteredSkills.length - 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIdx((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
        e.preventDefault();
        selectSkill(filteredSkills[selectedIdx]);
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey && !isStreaming) {
      e.preventDefault();
      submit();
    }
    if (e.key === 'Escape') {
      if (showSkills) {
        setShowSkills(false);
      } else {
        window.jowork.launcher.hide();
      }
    }
  };

  return (
    <div className="relative">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-white/10">
        <span className="text-text-secondary text-lg">🔍</span>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t('launcherPlaceholder')}
          disabled={isStreaming}
          className="flex-1 bg-transparent text-sm text-text-primary placeholder:text-text-secondary
            focus:outline-none disabled:opacity-50"
        />
        {isStreaming && (
          <span className="text-xs text-accent animate-pulse">{t('thinking')}</span>
        )}
      </div>

      {/* Skill autocomplete dropdown */}
      {showSkills && filteredSkills.length > 0 && (
        <div className="absolute left-0 right-0 top-full z-50 bg-surface-0 border border-white/10 rounded-b-lg shadow-lg max-h-60 overflow-y-auto">
          <p className="px-3 py-1.5 text-xs text-text-secondary">{t('skillsLabel')}</p>
          {filteredSkills.map((skill, i) => (
            <button
              key={skill.id}
              onClick={() => selectSkill(skill)}
              className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 transition-colors
                ${i === selectedIdx ? 'bg-accent/15 text-text-primary' : 'text-text-secondary hover:bg-white/5'}`}
            >
              <span className="text-accent font-mono text-xs">/{skill.name}</span>
              {skill.description && (
                <span className="truncate text-xs text-text-secondary">{skill.description}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
