import { useTranslation } from 'react-i18next';
import { GlassCard } from '../../components/ui/glass-card';
import { Sparkles, Terminal, Cpu, Users, Zap } from 'lucide-react';
import type { SkillInfo } from './hooks/useSkills';

interface Props {
  skill: SkillInfo;
  onSelect: (skill: SkillInfo) => void;
}

export function SkillCard({ skill, onSelect }: Props) {
  const { t } = useTranslation('skills');

  const sourceIcon = (source: string) => {
    switch (source) {
      case 'claude-code': return <Terminal className="w-3.5 h-3.5" />;
      case 'jowork': return <Sparkles className="w-3.5 h-3.5" />;
      case 'openclaw': return <Cpu className="w-3.5 h-3.5" />;
      case 'community': return <Users className="w-3.5 h-3.5" />;
      default: return <Zap className="w-3.5 h-3.5" />;
    }
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

  return (
    <button
      onClick={() => onSelect(skill)}
      className="w-full text-left transition-transform duration-200 active:scale-[0.98] group"
    >
      <GlassCard className="p-4 h-full flex flex-col gap-3 group-hover:border-primary/40 group-hover:shadow-primary/5">
        <div className="flex items-center justify-between gap-3">
          <h3 className="font-bold text-[15px] text-foreground tracking-tight group-hover:text-primary transition-colors truncate">
            {skill.name}
          </h3>
          <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20 text-[10px] font-bold uppercase tracking-wider">
            {sourceIcon(skill.skill_source ?? skill.source)}
            {sourceLabel(skill.skill_source ?? skill.source)}
          </div>
        </div>

        <p className="text-[13px] text-muted-foreground/90 line-clamp-2 leading-relaxed flex-1 italic">
          "{skill.description}"
        </p>

        <div className="flex items-center justify-between mt-2 pt-3 border-t border-border/40">
          <div className="flex items-center gap-2">
            <div className="px-2 py-1 rounded-lg bg-surface-2/40 border border-border/50 text-[11px] font-mono text-primary flex items-center gap-1.5">
              <Zap className="w-3 h-3 fill-current" />
              {skill.trigger}
            </div>
          </div>
          {skill.variables && skill.variables.length > 0 && (
            <span className="text-[11px] text-muted-foreground font-medium">
              {t('variableCount', { count: skill.variables.length })}
            </span>
          )}
        </div>
      </GlassCard>
    </button>
  );
}
