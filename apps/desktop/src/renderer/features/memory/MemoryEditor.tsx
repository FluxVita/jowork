import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { NewMemory, MemoryRecord } from './hooks/useMemory';

interface Props {
  initial?: MemoryRecord;
  onSave: (data: NewMemory) => Promise<void>;
  onCancel: () => void;
}

export function MemoryEditor({ initial, onSave, onCancel }: Props) {
  const { t } = useTranslation('memory');
  const { t: tc } = useTranslation('common');
  const [title, setTitle] = useState(initial?.title ?? '');
  const [content, setContent] = useState(initial?.content ?? '');
  const [tagsInput, setTagsInput] = useState(initial?.tags.join(', ') ?? '');
  const [scope, setScope] = useState<'personal' | 'team'>(
    (initial?.scope as 'personal' | 'team') ?? 'personal',
  );
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!title.trim() || !content.trim()) return;
    setSaving(true);
    try {
      await onSave({
        title: title.trim(),
        content: content.trim(),
        tags: tagsInput
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
        scope,
        source: 'user',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      <input
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder={t('titlePlaceholder')}
        className="w-full px-3 py-2 text-sm bg-surface-2 border border-border rounded-md
          text-text-primary placeholder:text-text-secondary focus:outline-none focus:ring-1 focus:ring-accent"
      />

      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder={t('contentPlaceholder')}
        rows={4}
        className="w-full px-3 py-2 text-sm bg-surface-2 border border-border rounded-md
          text-text-primary placeholder:text-text-secondary focus:outline-none focus:ring-1 focus:ring-accent resize-none"
      />

      <input
        type="text"
        value={tagsInput}
        onChange={(e) => setTagsInput(e.target.value)}
        placeholder={t('tagsPlaceholder')}
        className="w-full px-3 py-2 text-sm bg-surface-2 border border-border rounded-md
          text-text-primary placeholder:text-text-secondary focus:outline-none focus:ring-1 focus:ring-accent"
      />

      <div className="flex items-center gap-4">
        <label className="flex items-center gap-1.5 text-xs text-text-secondary">
          <input
            type="radio"
            name="scope"
            checked={scope === 'personal'}
            onChange={() => setScope('personal')}
            className="accent-accent"
          />
          {t('scopePersonal')}
        </label>
        <label className="flex items-center gap-1.5 text-xs text-text-secondary">
          <input
            type="radio"
            name="scope"
            checked={scope === 'team'}
            onChange={() => setScope('team')}
            className="accent-accent"
          />
          {t('scopeTeam')}
        </label>
      </div>

      <div className="flex justify-end gap-2 pt-1">
        <button
          onClick={onCancel}
          className="px-3 py-1.5 text-sm text-text-secondary hover:text-text-primary transition-colors"
        >
          {tc('cancel')}
        </button>
        <button
          onClick={handleSave}
          disabled={saving || !title.trim() || !content.trim()}
          className="px-3 py-1.5 text-sm bg-accent text-white rounded-md hover:bg-accent/90
            disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {saving ? tc('saving') : initial ? tc('update') : tc('create')}
        </button>
      </div>
    </div>
  );
}
