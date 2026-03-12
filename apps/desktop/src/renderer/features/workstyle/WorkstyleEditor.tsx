import { useEffect, useState } from 'react';

const DEFAULT_TEMPLATE = `# My Work Style

## Role
[Your title and responsibilities]

## Communication Preferences
- Reply style: [concise/detailed]
- Language: [Chinese/English/bilingual]

## Work Habits
[Your daily workflow]

## Important Rules
[Rules the AI must follow]
`;

export function WorkstyleEditor() {
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    window.jowork.invoke('settings:get', 'workstyle').then((val) => {
      setContent((val as string) || DEFAULT_TEMPLATE);
    });
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      await window.jowork.invoke('settings:set', 'workstyle', content);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex-1 p-8 overflow-y-auto">
      <div className="max-w-3xl">
        <div className="flex items-center justify-between mb-1">
          <h1 className="text-xl font-semibold">Work Style</h1>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-3 py-1.5 text-sm bg-accent text-white rounded-md hover:bg-accent/90
              disabled:opacity-50 transition-colors"
          >
            {saved ? 'Saved!' : saving ? 'Saving...' : 'Save'}
          </button>
        </div>
        <p className="text-sm text-text-secondary mb-4">
          Define how the AI should work with you. This is injected into every conversation.
        </p>

        <textarea
          value={content}
          onChange={(e) => {
            setContent(e.target.value);
            setSaved(false);
          }}
          rows={20}
          className="w-full px-4 py-3 text-sm font-mono bg-surface-2 border border-border rounded-lg
            text-text-primary placeholder:text-text-secondary focus:outline-none focus:ring-1
            focus:ring-accent resize-y leading-relaxed"
          placeholder="Write your work style guide in Markdown..."
        />

        <p className="text-xs text-text-secondary mt-2">
          Supports Markdown. This document is included in every AI conversation as context.
        </p>
      </div>
    </div>
  );
}
