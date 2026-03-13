import { useRef, useEffect, useState, useCallback, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useLauncherStore } from './hooks/useLauncher';
import { Search, Terminal, Zap, Loader2 } from 'lucide-react';

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
    <div className="relative z-20">
      <div className="flex items-center gap-4 px-6 py-5 border-b border-white/10 transition-colors duration-300 focus-within:bg-white/5">
        <div className="text-primary animate-in zoom-in duration-500">
          <Search className="w-6 h-6" />
        </div>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t('launcherPlaceholder', { defaultValue: 'Ask JoWork or type / for skills...' })}
          disabled={isStreaming}
          className="flex-1 bg-transparent text-xl font-medium text-foreground placeholder:text-muted-foreground/40
            focus:outline-none disabled:opacity-50"
        />
        {isStreaming && (
          <div className="flex items-center gap-2 text-primary font-bold text-xs bg-primary/10 px-3 py-1.5 rounded-full border border-primary/20 animate-pulse">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            <span>{t('thinking')}</span>
          </div>
        )}
      </div>

      {/* Skill autocomplete dropdown in glass style */}
      {showSkills && filteredSkills.length > 0 && (
        <div className="absolute left-4 right-4 top-[calc(100%+8px)] z-50 glass-effect border border-white/20 rounded-2xl shadow-2xl overflow-hidden animate-in slide-in-from-top-2 duration-200">
          <div className="px-4 py-2 bg-surface-1/40 border-b border-white/5 text-[10px] font-bold text-muted-foreground/70 uppercase tracking-widest flex items-center gap-2">
            <Terminal className="w-3 h-3" />
            {t('skillsLabel', { defaultValue: 'Available Skills' })}
          </div>
          <div className="max-h-[300px] overflow-y-auto custom-scrollbar">
            {filteredSkills.map((skill, i) => (
              <button
                key={skill.id}
                onClick={() => selectSkill(skill)}
                className={`w-full text-left px-4 py-3 text-[14px] flex items-center justify-between gap-4 transition-all duration-200
                  ${i === selectedIdx ? 'bg-primary text-primary-foreground shadow-lg' : 'text-foreground hover:bg-white/5'}`}
              >
                <div className="flex items-center gap-3">
                  <div className={`p-1.5 rounded-lg ${i === selectedIdx ? 'bg-white/20' : 'bg-primary/10 text-primary'}`}>
                    <Zap className="w-3.5 h-3.5 fill-current" />
                  </div>
                  <span className="font-semibold tracking-tight">/{skill.name}</span>
                </div>
                {skill.description && (
                  <span className={`text-xs truncate max-w-[200px] italic ${i === selectedIdx ? 'text-white/70' : 'text-muted-foreground'}`}>
                    {skill.description}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
