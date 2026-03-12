import { useState } from 'react';
import type { SkillInfo } from './hooks/useSkills';
import { useSkillStore } from './hooks/useSkills';

interface Props {
  skill: SkillInfo;
  onClose: () => void;
}

export function SkillRunner({ skill, onClose }: Props) {
  const { runSkill, isRunning } = useSkillStore();
  const [vars, setVars] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const v of skill.variables ?? []) {
      initial[v.name] = v.default ?? '';
    }
    return initial;
  });

  const handleRun = async () => {
    await runSkill(skill.id, vars);
    onClose();
  };

  const hasVars = skill.variables && skill.variables.length > 0;
  const requiredMet =
    !hasVars ||
    skill.variables!.every((v) => !v.required || vars[v.name]?.trim());

  return (
    <div className="p-4 bg-surface-1 border border-border rounded-lg">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-text-primary">{skill.name}</h3>
        <button onClick={onClose} className="text-xs text-text-secondary hover:text-text-primary">
          Close
        </button>
      </div>

      <p className="text-xs text-text-secondary mb-3">{skill.description}</p>

      {hasVars && (
        <div className="space-y-2 mb-4">
          {skill.variables!.map((v) => (
            <div key={v.name}>
              <label className="block text-xs text-text-secondary mb-1">
                {v.label}
                {v.required && <span className="text-red-400 ml-0.5">*</span>}
              </label>
              {v.type === 'multiline' ? (
                <textarea
                  value={vars[v.name] ?? ''}
                  onChange={(e) => setVars((p) => ({ ...p, [v.name]: e.target.value }))}
                  rows={3}
                  className="w-full px-2 py-1.5 text-sm bg-surface-2 border border-border rounded
                    text-text-primary focus:outline-none focus:ring-1 focus:ring-accent resize-none"
                />
              ) : v.type === 'select' ? (
                <select
                  value={vars[v.name] ?? ''}
                  onChange={(e) => setVars((p) => ({ ...p, [v.name]: e.target.value }))}
                  className="w-full px-2 py-1.5 text-sm bg-surface-2 border border-border rounded
                    text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
                >
                  <option value="">Select...</option>
                  {v.options?.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  value={vars[v.name] ?? ''}
                  onChange={(e) => setVars((p) => ({ ...p, [v.name]: e.target.value }))}
                  className="w-full px-2 py-1.5 text-sm bg-surface-2 border border-border rounded
                    text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
                />
              )}
            </div>
          ))}
        </div>
      )}

      <div className="flex justify-end">
        <button
          onClick={handleRun}
          disabled={isRunning || !requiredMet}
          className="px-4 py-1.5 text-sm bg-accent text-white rounded-md hover:bg-accent/90
            disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {isRunning ? 'Running...' : 'Run Skill'}
        </button>
      </div>
    </div>
  );
}
