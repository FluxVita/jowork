import { useTranslation } from 'react-i18next';
import type { SkillInfo } from './hooks/useSkills';

interface Props {
  skill: SkillInfo;
  onSelect: (skill: SkillInfo) => void;
}

export function SkillCard({ skill, onSelect }: Props) {
  const { t } = useTranslation('skills');

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
      className="w-full text-left p-3 bg-surface-2 border border-border rounded-lg
        hover:border-accent/30 transition-colors group"
    >
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm font-medium text-text-primary">{skill.name}</span>
        <span className="text-[10px] px-1.5 py-0.5 bg-accent/10 text-accent rounded">
          {sourceLabel(skill.source)}
        </span>
      </div>
      <p className="text-xs text-text-secondary line-clamp-2">{skill.description}</p>
      <div className="flex items-center gap-2 mt-2">
        <code className="text-[10px] text-text-secondary bg-surface-1 px-1.5 py-0.5 rounded">
          {skill.trigger}
        </code>
        {skill.variables && skill.variables.length > 0 && (
          <span className="text-[10px] text-text-secondary">
            {t('variableCount', { count: skill.variables.length })}
          </span>
        )}
      </div>
    </button>
  );
}
