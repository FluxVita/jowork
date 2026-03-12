import { useState } from 'react';
import { useSkillStore, type SkillDraft } from './hooks/useSkills';

interface Props {
  onClose: () => void;
}

const emptyDraft: SkillDraft = {
  name: '',
  description: '',
  trigger: '/',
  type: 'simple',
  promptTemplate: '',
  variables: [],
};

export function SkillEditor({ onClose }: Props) {
  const { saveSkill } = useSkillStore();
  const [draft, setDraft] = useState<SkillDraft>({ ...emptyDraft });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const canSave = draft.name.trim() && draft.trigger.trim() && draft.promptTemplate?.trim();

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    setError('');
    try {
      await saveSkill(draft);
      onClose();
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  };

  const addVariable = () => {
    setDraft((d) => ({
      ...d,
      variables: [...(d.variables ?? []), { name: '', label: '', type: 'text' as const }],
    }));
  };

  const updateVariable = (idx: number, field: string, value: string | boolean) => {
    setDraft((d) => {
      const vars = [...(d.variables ?? [])];
      vars[idx] = { ...vars[idx], [field]: value };
      return { ...d, variables: vars };
    });
  };

  const removeVariable = (idx: number) => {
    setDraft((d) => ({
      ...d,
      variables: (d.variables ?? []).filter((_, i) => i !== idx),
    }));
  };

  return (
    <div className="p-4 bg-surface-1 border border-border rounded-lg">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-medium text-text-primary">Create Custom Skill</h3>
        <button onClick={onClose} className="text-xs text-text-secondary hover:text-text-primary">
          Cancel
        </button>
      </div>

      {error && (
        <div className="mb-3 p-2 text-xs text-red-400 bg-red-500/10 rounded">{error}</div>
      )}

      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-text-secondary mb-1">Name</label>
            <input
              type="text"
              value={draft.name}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
              placeholder="My Skill"
              className="w-full px-2 py-1.5 text-sm bg-surface-2 border border-border rounded
                text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </div>
          <div>
            <label className="block text-xs text-text-secondary mb-1">Trigger</label>
            <input
              type="text"
              value={draft.trigger}
              onChange={(e) => setDraft((d) => ({ ...d, trigger: e.target.value }))}
              placeholder="/my-skill"
              className="w-full px-2 py-1.5 text-sm bg-surface-2 border border-border rounded
                text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs text-text-secondary mb-1">Description</label>
          <input
            type="text"
            value={draft.description}
            onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
            placeholder="What does this skill do?"
            className="w-full px-2 py-1.5 text-sm bg-surface-2 border border-border rounded
              text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </div>

        <div>
          <label className="block text-xs text-text-secondary mb-1">Prompt Template</label>
          <textarea
            value={draft.promptTemplate ?? ''}
            onChange={(e) => setDraft((d) => ({ ...d, promptTemplate: e.target.value }))}
            rows={6}
            placeholder="Use {{variable_name}} for dynamic values..."
            className="w-full px-2 py-1.5 text-sm bg-surface-2 border border-border rounded
              text-text-primary font-mono focus:outline-none focus:ring-1 focus:ring-accent resize-none"
          />
        </div>

        {/* Variables */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs text-text-secondary">Variables</label>
            <button
              onClick={addVariable}
              className="text-xs text-accent hover:text-accent/80"
            >
              + Add Variable
            </button>
          </div>
          {(draft.variables ?? []).map((v, idx) => (
            <div key={idx} className="flex items-center gap-2 mb-2">
              <input
                type="text"
                value={v.name}
                onChange={(e) => updateVariable(idx, 'name', e.target.value)}
                placeholder="var_name"
                className="flex-1 px-2 py-1 text-xs bg-surface-2 border border-border rounded
                  text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
              />
              <input
                type="text"
                value={v.label}
                onChange={(e) => updateVariable(idx, 'label', e.target.value)}
                placeholder="Label"
                className="flex-1 px-2 py-1 text-xs bg-surface-2 border border-border rounded
                  text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
              />
              <select
                value={v.type}
                onChange={(e) => updateVariable(idx, 'type', e.target.value)}
                className="px-2 py-1 text-xs bg-surface-2 border border-border rounded
                  text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
              >
                <option value="text">Text</option>
                <option value="multiline">Multiline</option>
                <option value="select">Select</option>
              </select>
              <label className="flex items-center gap-1 text-xs text-text-secondary">
                <input
                  type="checkbox"
                  checked={v.required ?? false}
                  onChange={(e) => updateVariable(idx, 'required', e.target.checked)}
                  className="rounded"
                />
                Req
              </label>
              <button
                onClick={() => removeVariable(idx)}
                className="text-xs text-red-400 hover:text-red-300"
              >
                X
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="flex justify-end mt-4">
        <button
          onClick={handleSave}
          disabled={saving || !canSave}
          className="px-4 py-1.5 text-sm bg-accent text-white rounded-md hover:bg-accent/90
            disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {saving ? 'Saving...' : 'Save Skill'}
        </button>
      </div>
    </div>
  );
}
