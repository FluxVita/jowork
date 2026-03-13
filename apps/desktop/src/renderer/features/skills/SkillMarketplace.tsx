import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSkillStore } from './hooks/useSkills';

/** Placeholder marketplace — shows community skill directory with install action */

interface MarketplaceSkill {
  id: string;
  name: string;
  description: string;
  author: string;
  downloads: number;
  trigger: string;
}

// Static directory — in production this would fetch from a registry API
const FEATURED_SKILLS: MarketplaceSkill[] = [
  {
    id: 'marketplace:git-changelog',
    name: 'Git Changelog',
    description: 'Generate a changelog from git history between two tags or dates',
    author: 'jowork-community',
    downloads: 1240,
    trigger: '/changelog',
  },
  {
    id: 'marketplace:code-review',
    name: 'Code Review',
    description: 'Review code changes with security, performance, and best practice checks',
    author: 'jowork-community',
    downloads: 980,
    trigger: '/code-review',
  },
  {
    id: 'marketplace:meeting-notes',
    name: 'Meeting Notes',
    description: 'Summarize meeting transcripts into actionable notes with follow-ups',
    author: 'jowork-community',
    downloads: 870,
    trigger: '/meeting-notes',
  },
  {
    id: 'marketplace:api-docs',
    name: 'API Documentation',
    description: 'Generate OpenAPI docs from source code annotations and route definitions',
    author: 'jowork-community',
    downloads: 650,
    trigger: '/api-docs',
  },
  {
    id: 'marketplace:refactor-suggest',
    name: 'Refactor Suggestions',
    description: 'Analyze code for refactoring opportunities using SOLID principles',
    author: 'jowork-community',
    downloads: 520,
    trigger: '/refactor',
  },
];

interface Props {
  onClose: () => void;
}

export function SkillMarketplace({ onClose }: Props) {
  const { t } = useTranslation('skills');
  const { t: tc } = useTranslation('common');
  const { saveSkill, loadSkills } = useSkillStore();
  const [installing, setInstalling] = useState<string | null>(null);
  const [installed, setInstalled] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');

  const filtered = search
    ? FEATURED_SKILLS.filter(
        (s) =>
          s.name.toLowerCase().includes(search.toLowerCase()) ||
          s.description.toLowerCase().includes(search.toLowerCase()),
      )
    : FEATURED_SKILLS;

  const handleInstall = async (skill: MarketplaceSkill) => {
    setInstalling(skill.id);
    try {
      await saveSkill({
        name: skill.name,
        description: skill.description,
        trigger: skill.trigger,
        type: 'simple',
        promptTemplate: `[Community skill: ${skill.name}]\n\n${skill.description}\n\nPlease execute this skill based on the context provided.`,
      });
      setInstalled((prev) => new Set(prev).add(skill.id));
      await loadSkills();
    } catch {
      // silently fail
    } finally {
      setInstalling(null);
    }
  };

  return (
    <div className="p-4 bg-surface-1 border border-border rounded-lg">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-medium text-text-primary">{t('skillMarketplace')}</h3>
          <p className="text-xs text-text-secondary mt-0.5">
            {t('browseSkills')}
          </p>
        </div>
        <button onClick={onClose} className="text-xs text-text-secondary hover:text-text-primary">
          {tc('close')}
        </button>
      </div>

      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={t('searchSkills')}
        className="w-full px-2 py-1.5 text-sm bg-surface-2 border border-border rounded mb-3
          text-text-primary placeholder:text-text-secondary focus:outline-none focus:ring-1 focus:ring-accent"
      />

      <div className="space-y-2">
        {filtered.map((skill) => (
          <div
            key={skill.id}
            className="flex items-start justify-between p-3 bg-surface-2 border border-border rounded-lg"
          >
            <div className="flex-1 min-w-0 mr-3">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-sm font-medium text-text-primary">{skill.name}</span>
                <code className="text-[10px] text-text-secondary bg-surface-1 px-1.5 py-0.5 rounded">
                  {skill.trigger}
                </code>
              </div>
              <p className="text-xs text-text-secondary line-clamp-2">{skill.description}</p>
              <div className="flex items-center gap-3 mt-1.5 text-[10px] text-text-secondary">
                <span>{skill.author}</span>
                <span>{t('installCount', { count: skill.downloads })}</span>
              </div>
            </div>
            <button
              onClick={() => handleInstall(skill)}
              disabled={installing === skill.id || installed.has(skill.id)}
              className="shrink-0 px-3 py-1 text-xs bg-accent text-white rounded hover:bg-accent/90
                disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {installed.has(skill.id) ? t('installed') : installing === skill.id ? '...' : t('install')}
            </button>
          </div>
        ))}
      </div>

      {filtered.length === 0 && (
        <p className="text-xs text-text-secondary text-center py-6">
          {t('noSkillsMatch')}
        </p>
      )}
    </div>
  );
}
