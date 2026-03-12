import { useState } from 'react';

export interface NotificationRuleInfo {
  id: string;
  connectorId: string;
  condition: string;
  customFilter?: string;
  channels: string[];
  silentHours?: { start: string; end: string };
  aiSummary: boolean;
}

const CONDITIONS = [
  { value: 'mention_me', label: 'Mention me' },
  { value: 'p0_issue', label: 'P0 issue created' },
  { value: 'pr_review_requested', label: 'PR review requested' },
  { value: 'custom', label: 'Custom filter' },
];

const CHANNELS = [
  { value: 'system', label: 'System notification' },
  { value: 'app', label: 'In-app notification' },
  { value: 'feishu', label: 'Feishu message' },
];

interface Props {
  initial?: NotificationRuleInfo;
  onSave: (rule: NotificationRuleInfo) => Promise<void>;
  onCancel: () => void;
}

export function RuleEditor({ initial, onSave, onCancel }: Props) {
  const [connectorId, setConnectorId] = useState(initial?.connectorId ?? '');
  const [condition, setCondition] = useState(initial?.condition ?? 'mention_me');
  const [customFilter, setCustomFilter] = useState(initial?.customFilter ?? '');
  const [channels, setChannels] = useState<string[]>(initial?.channels ?? ['app']);
  const [silentEnabled, setSilentEnabled] = useState(!!initial?.silentHours);
  const [silentStart, setSilentStart] = useState(initial?.silentHours?.start ?? '22:00');
  const [silentEnd, setSilentEnd] = useState(initial?.silentHours?.end ?? '08:00');
  const [aiSummary, setAiSummary] = useState(initial?.aiSummary ?? false);
  const [saving, setSaving] = useState(false);

  const toggleChannel = (ch: string) => {
    setChannels((prev) =>
      prev.includes(ch) ? prev.filter((c) => c !== ch) : [...prev, ch],
    );
  };

  const handleSave = async () => {
    if (!connectorId.trim() || channels.length === 0) return;
    setSaving(true);
    try {
      await onSave({
        id: initial?.id ?? `rule_${Date.now()}`,
        connectorId: connectorId.trim(),
        condition,
        customFilter: condition === 'custom' ? customFilter : undefined,
        channels,
        silentHours: silentEnabled ? { start: silentStart, end: silentEnd } : undefined,
        aiSummary,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3 p-4 bg-surface-1 border border-border rounded-lg">
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-sm font-medium text-text-primary">
          {initial ? 'Edit Rule' : 'New Notification Rule'}
        </h3>
        <button onClick={onCancel} className="text-xs text-text-secondary hover:text-text-primary">
          Cancel
        </button>
      </div>

      <div>
        <label className="block text-xs text-text-secondary mb-1">Connector ID</label>
        <input
          type="text"
          value={connectorId}
          onChange={(e) => setConnectorId(e.target.value)}
          placeholder="e.g. github, gitlab, feishu"
          className="w-full px-2 py-1.5 text-sm bg-surface-2 border border-border rounded
            text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
        />
      </div>

      <div>
        <label className="block text-xs text-text-secondary mb-1">Condition</label>
        <select
          value={condition}
          onChange={(e) => setCondition(e.target.value)}
          className="w-full px-2 py-1.5 text-sm bg-surface-2 border border-border rounded
            text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
        >
          {CONDITIONS.map((c) => (
            <option key={c.value} value={c.value}>{c.label}</option>
          ))}
        </select>
      </div>

      {condition === 'custom' && (
        <div>
          <label className="block text-xs text-text-secondary mb-1">Custom Filter Expression</label>
          <input
            type="text"
            value={customFilter}
            onChange={(e) => setCustomFilter(e.target.value)}
            placeholder='e.g. title contains "urgent"'
            className="w-full px-2 py-1.5 text-sm bg-surface-2 border border-border rounded
              text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </div>
      )}

      <div>
        <label className="block text-xs text-text-secondary mb-1.5">Delivery Channels</label>
        <div className="flex items-center gap-4">
          {CHANNELS.map((ch) => (
            <label key={ch.value} className="flex items-center gap-1.5 text-xs text-text-secondary">
              <input
                type="checkbox"
                checked={channels.includes(ch.value)}
                onChange={() => toggleChannel(ch.value)}
                className="accent-accent"
              />
              {ch.label}
            </label>
          ))}
        </div>
      </div>

      <div>
        <label className="flex items-center gap-2 text-xs text-text-secondary">
          <input
            type="checkbox"
            checked={silentEnabled}
            onChange={(e) => setSilentEnabled(e.target.checked)}
            className="accent-accent"
          />
          Silent hours
        </label>
        {silentEnabled && (
          <div className="flex items-center gap-2 mt-1.5 ml-5">
            <input
              type="time"
              value={silentStart}
              onChange={(e) => setSilentStart(e.target.value)}
              className="px-2 py-1 text-xs bg-surface-2 border border-border rounded text-text-primary"
            />
            <span className="text-xs text-text-secondary">to</span>
            <input
              type="time"
              value={silentEnd}
              onChange={(e) => setSilentEnd(e.target.value)}
              className="px-2 py-1 text-xs bg-surface-2 border border-border rounded text-text-primary"
            />
          </div>
        )}
      </div>

      <label className="flex items-center gap-2 text-xs text-text-secondary">
        <input
          type="checkbox"
          checked={aiSummary}
          onChange={(e) => setAiSummary(e.target.checked)}
          className="accent-accent"
        />
        AI-powered summary before delivery
      </label>

      <div className="flex justify-end pt-1">
        <button
          onClick={handleSave}
          disabled={saving || !connectorId.trim() || channels.length === 0}
          className="px-4 py-1.5 text-sm bg-accent text-white rounded-md hover:bg-accent/90
            disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {saving ? 'Saving...' : initial ? 'Update' : 'Create Rule'}
        </button>
      </div>
    </div>
  );
}
