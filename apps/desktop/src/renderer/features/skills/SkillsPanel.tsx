import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSkillStore, type SkillInfo } from './hooks/useSkills';
import { SkillCard } from './SkillCard';
import { SkillRunner } from './SkillRunner';
import { SkillEditor } from './SkillEditor';
import { SkillMarketplace } from './SkillMarketplace';
import { Sparkles, ShoppingBag, Plus, Search, ArrowLeft, X } from 'lucide-react';

type View = 'list' | 'editor' | 'marketplace';

export function SkillsPanel() {
  const { t } = useTranslation('skills');
  const { t: tc } = useTranslation('common');
  const { skills, isLoading, loadSkills, activeSkill, selectSkill } = useSkillStore();
  const [filter, setFilter] = useState('');
  const [view, setView] = useState<View>('list');

  useEffect(() => {
    loadSkills();
  }, [loadSkills]);

  const filtered = filter
    ? skills.filter(
        (s) =>
          s.name.toLowerCase().includes(filter.toLowerCase()) ||
          s.trigger.toLowerCase().includes(filter.toLowerCase()),
      )
    : skills;

  const bySource = {
    jowork: filtered.filter((s) => s.source === 'jowork'),
    'claude-code': filtered.filter((s) => s.source === 'claude-code'),
    openclaw: filtered.filter((s) => s.source === 'openclaw'),
    community: filtered.filter((s) => s.source === 'community'),
  };

  const sourceLabel = (source: string) => {
    const map: Record<string, string> = {
      'claude-code': t('sourceClaudeCode'),
      jowork: t('sourceJowork'),
      openclaw: t('sourceOpenclaw'),
      community: t('sourceCommunity'),
    };
    return map[source] ?? source;
  };

  const handleSelect = (skill: SkillInfo) => {
    selectSkill(skill);
  };

  return (
    <div className="flex-1 p-10 overflow-y-auto custom-scrollbar animate-in fade-in duration-500">
      <div className="max-w-5xl mx-auto">
        {/* Header Section */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-10">
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-primary/10 text-primary">
                <Sparkles className="w-6 h-6" />
              </div>
              <h1 className="text-3xl font-bold tracking-tight text-foreground">{t('title')}</h1>
            </div>
            <p className="text-[15px] text-muted-foreground max-w-lg pl-1">
              {t('description')}
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => setView(view === 'marketplace' ? 'list' : 'marketplace')}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-[14px] font-semibold transition-all duration-300 border backdrop-blur-md
                ${view === 'marketplace' 
                  ? 'bg-primary text-primary-foreground border-primary shadow-lg shadow-primary/20' 
                  : 'bg-surface-2/30 text-muted-foreground border-border/40 hover:bg-surface-2/50 hover:text-foreground'}`}
            >
              {view === 'marketplace' ? <ArrowLeft className="w-4 h-4" /> : <ShoppingBag className="w-4 h-4" />}
              {view === 'marketplace' ? tc('back') : t('marketplace')}
            </button>
            <button
              onClick={() => setView(view === 'editor' ? 'list' : 'editor')}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-[14px] font-semibold transition-all duration-300 border
                ${view === 'editor' 
                  ? 'bg-background/80 text-foreground border-border/80' 
                  : 'bg-primary text-primary-foreground border-primary shadow-lg shadow-primary/20 hover:opacity-90'}`}
            >
              {view === 'editor' ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
              {view === 'editor' ? tc('cancel') : t('createSkill')}
            </button>
          </div>
        </div>

        {view === 'editor' && (
          <div className="mb-10 p-6 glass-effect border border-border/80 rounded-2xl animate-in slide-in-from-top-4 duration-300 shadow-xl">
            <SkillEditor onClose={() => setView('list')} />
          </div>
        )}

        {view === 'marketplace' && (
          <div className="mb-10 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <SkillMarketplace onClose={() => setView('list')} />
          </div>
        )}

        {view === 'list' && (
          <div className="animate-in fade-in duration-700">
            {/* Search Input */}
            <div className="relative mb-8 group max-w-md">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground transition-colors group-focus-within:text-primary" />
              <input
                type="text"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder={t('filterPlaceholder')}
                className="w-full pl-10 pr-4 py-2.5 text-[14px] bg-surface-2/30 border border-border/40 rounded-xl
                  text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/20
                  transition-all duration-300 backdrop-blur-sm"
              />
            </div>

            {activeSkill && (
              <div className="mb-10 animate-in zoom-in-95 duration-300">
                <SkillRunner skill={activeSkill} onClose={() => selectSkill(null)} />
              </div>
            )}

            {isLoading ? (
              <div className="flex items-center gap-3 text-muted-foreground p-4">
                <span className="w-5 h-5 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                <span className="text-[14px]">{t('loading')}</span>
              </div>
            ) : filtered.length === 0 ? (
              <div className="text-center py-20 glass-effect rounded-2xl border border-dashed border-border/50">
                <Sparkles className="w-12 h-12 text-muted-foreground/30 mx-auto mb-4" />
                <p className="text-[15px] text-foreground font-medium mb-1">{t('noSkills')}</p>
                <p className="text-[13px] text-muted-foreground">{t('noSkillsHint')}</p>
              </div>
            ) : (
              <div className="space-y-12">
                {Object.entries(bySource).map(
                  ([source, items]) =>
                    items.length > 0 && (
                      <section key={source}>
                        <div className="flex items-center gap-3 mb-5">
                          <h2 className="text-[14px] font-bold text-muted-foreground uppercase tracking-widest pl-1">
                            {sourceLabel(source)}
                          </h2>
                          <div className="h-[1px] flex-1 bg-border/40" />
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                          {items.map((s) => (
                            <SkillCard key={s.id} skill={s} onSelect={handleSelect} />
                          ))}
                        </div>
                      </section>
                    ),
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
