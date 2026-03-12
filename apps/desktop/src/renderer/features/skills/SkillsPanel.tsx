import { useEffect, useState } from 'react';
import { useSkillStore, type SkillInfo } from './hooks/useSkills';
import { SkillCard } from './SkillCard';
import { SkillRunner } from './SkillRunner';

export function SkillsPanel() {
  const { skills, isLoading, loadSkills, activeSkill, selectSkill } = useSkillStore();
  const [filter, setFilter] = useState('');

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

  const handleSelect = (skill: SkillInfo) => {
    selectSkill(skill);
  };

  return (
    <div className="flex-1 p-8 overflow-y-auto">
      <div className="max-w-3xl">
        <h1 className="text-xl font-semibold mb-1">Skills</h1>
        <p className="text-sm text-text-secondary mb-4">
          Reusable prompts and workflows from multiple sources.
        </p>

        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter skills..."
          className="w-full px-3 py-2 text-sm bg-surface-2 border border-border rounded-md mb-4
            text-text-primary placeholder:text-text-secondary focus:outline-none focus:ring-1 focus:ring-accent"
        />

        {activeSkill && (
          <div className="mb-4">
            <SkillRunner skill={activeSkill} onClose={() => selectSkill(null)} />
          </div>
        )}

        {isLoading ? (
          <p className="text-sm text-text-secondary">Loading skills...</p>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12 text-text-secondary text-sm">
            <p>No skills found.</p>
            <p className="text-xs mt-1">
              Add .md files to ~/.claude/commands/ or ~/.claude/skills/
            </p>
          </div>
        ) : (
          Object.entries(bySource).map(
            ([source, items]) =>
              items.length > 0 && (
                <section key={source} className="mb-6">
                  <h2 className="text-sm font-medium text-text-secondary mb-2 capitalize">
                    {source === 'claude-code' ? 'Claude Code' : source}
                  </h2>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {items.map((s) => (
                      <SkillCard key={s.id} skill={s} onSelect={handleSelect} />
                    ))}
                  </div>
                </section>
              ),
          )
        )}
      </div>
    </div>
  );
}
